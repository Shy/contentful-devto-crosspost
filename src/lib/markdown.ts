import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';

type FrontMatterParts = {
  raw: string;
  body: string;
};

type MarkdownNormalizeResult = {
  markdown: string;
  warnings: string[];
};

const MANAGED_FRONT_MATTER_KEYS = new Set([
  'title',
  'published',
  'tags',
  'date',
  'canonical_url',
  'cover_image',
  'description',
]);

export type DevtoFrontMatter = {
  title: string;
  published: false;
  tags: string[];
  date: string;
  canonical_url: string;
  cover_image?: string;
  description: string;
};

export function buildDevtoMarkdown(
  source: string,
  frontMatter: DevtoFrontMatter,
): MarkdownNormalizeResult {
  const warnings: string[] = [];
  const parts = splitFrontMatter(source);
  const normalized = normalizeMarkdownBody(parts.body);
  warnings.push(...normalized.warnings);

  const mergedFrontMatter = mergeFrontMatter(parts.raw, frontMatter);
  return {
    markdown: `${mergedFrontMatter}\n\n${normalized.markdown.trim()}\n`,
    warnings,
  };
}

function normalizeMarkdownBody(source: string): MarkdownNormalizeResult {
  ensureProcessCwd();

  const warnings: string[] = [];
  let htmlImageCount = 0;
  let htmlTableCount = 0;

  let markdown = source.replace(/<img\b([^>]*)>/gi, (_match, attrs: string) => {
    const src = getHtmlAttribute(attrs, 'src');
    if (!src) {
      warnings.push('Found an HTML image without a src attribute.');
      return '';
    }
    htmlImageCount += 1;
    const alt = getHtmlAttribute(attrs, 'alt') ?? '';
    return `![${escapeMarkdownAlt(alt)}](${absoluteUrl(src)})`;
  });

  markdown = markdown.replace(/<table\b[\s\S]*?<\/table>/gi, (table: string) => {
    htmlTableCount += 1;
    return htmlTableToMarkdown(table);
  });

  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter)
    .use(remarkGfm)
    .use(() => (tree) => {
      visit(tree, 'image', (node: { url?: string }) => {
        if (node.url?.startsWith('//')) {
          node.url = absoluteUrl(node.url);
        }
      });
    })
    .use(remarkStringify, {
      bullet: '-',
      fences: true,
      rule: '-',
      ruleSpaces: false,
    });

  const file = processor.processSync(markdown);
  const captionTables = collapseCaptionTables(String(file).trim());
  const output = captionTables.markdown;

  if (htmlImageCount > 0) {
    warnings.push(`Converted ${htmlImageCount} raw HTML image${htmlImageCount === 1 ? '' : 's'} to Markdown.`);
  }
  if (htmlTableCount > 0) {
    warnings.push(`Converted ${htmlTableCount} raw HTML table${htmlTableCount === 1 ? '' : 's'} to Markdown text.`);
  }
  if (captionTables.count > 0) {
    warnings.push(`Converted ${captionTables.count} image caption table${captionTables.count === 1 ? '' : 's'} to Markdown captions.`);
  }

  const remainingHtml = output.match(/<(?!(?:https?:\/\/|\/?br\b))[a-z][\s\S]*?>/gi);
  if (remainingHtml?.length) {
    warnings.push(`Markdown still contains ${remainingHtml.length} raw HTML tag${remainingHtml.length === 1 ? '' : 's'}; review in DEV.`);
  }

  return {
    markdown: output,
    warnings,
  };
}

function ensureProcessCwd(): void {
  const globalWithProcess = globalThis as unknown as {
    process?: Record<string, unknown>;
  };

  if (!globalWithProcess.process) {
    globalWithProcess.process = { cwd: () => '/' };
    return;
  }

  if (typeof globalWithProcess.process.cwd !== 'function') {
    globalWithProcess.process.cwd = () => '/';
  }
}

function collapseCaptionTables(markdown: string): { markdown: string; count: number } {
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let count = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isPipeTableLine(line)) {
      output.push(line);
      continue;
    }

    const tableLines: string[] = [];
    while (index < lines.length && isPipeTableLine(lines[index])) {
      tableLines.push(lines[index]);
      index += 1;
    }
    index -= 1;

    const caption = captionFromSingleColumnTable(tableLines);
    if (!caption) {
      output.push(...tableLines);
      continue;
    }

    output.push(`_${escapeMarkdownEmphasis(caption)}_`);
    count += 1;
  }

  return {
    markdown: output.join('\n'),
    count,
  };
}

function isPipeTableLine(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function captionFromSingleColumnTable(lines: string[]): string | undefined {
  const rows = lines.map(parsePipeRow);
  if (rows.some((row) => !row || row.length !== 1)) return undefined;

  const separatorIndex = rows.findIndex((row) => Boolean(row?.every(isSeparatorCell)));
  if (separatorIndex < 1) return undefined;

  const headerCells = rows
    .slice(0, separatorIndex)
    .flatMap((row) => row ?? [])
    .map((cell) => cell.trim())
    .filter(Boolean);
  if (headerCells.length > 0) return undefined;

  const bodyCells = rows
    .slice(separatorIndex + 1)
    .flatMap((row) => row ?? [])
    .map((cell) => cell.trim())
    .filter(Boolean);
  if (bodyCells.length !== 1) return undefined;

  return bodyCells[0];
}

function parsePipeRow(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return undefined;
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.replace(/\\\|/g, '|').trim());
}

function isSeparatorCell(cell: string): boolean {
  return /^:?-{3,}:?$/.test(cell.trim());
}

function splitFrontMatter(source: string): FrontMatterParts {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { raw: '', body: source };

  return {
    raw: match[1],
    body: source.slice(match[0].length),
  };
}

function mergeFrontMatter(existingRaw: string, next: DevtoFrontMatter): string {
  const preservedLines = existingRaw
    .split(/\r?\n/)
    .filter((line) => {
      const key = line.match(/^\s*([A-Za-z0-9_-]+)\s*:/)?.[1]?.toLowerCase();
      return key ? !MANAGED_FRONT_MATTER_KEYS.has(key) : line.trim() !== '';
    });

  const managedLines = [
    `title: ${yamlScalar(next.title)}`,
    'published: false',
    `tags: ${next.tags.join(', ')}`,
    `date: ${next.date}`,
    `canonical_url: ${yamlScalar(next.canonical_url)}`,
    next.cover_image ? `cover_image: ${yamlScalar(next.cover_image)}` : undefined,
    `description: ${yamlScalar(next.description)}`,
  ].filter(Boolean);

  return ['---', ...preservedLines, ...managedLines, '---'].join('\n');
}

function htmlTableToMarkdown(table: string): string {
  let text = table
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p\b[^>]*>/gi, '')
    .replace(/<strong\b[^>]*>/gi, '**')
    .replace(/<\/strong>/gi, '**')
    .replace(/<em\b[^>]*>/gi, '_')
    .replace(/<\/em>/gi, '_')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<\/?(?:table|tbody|thead|tr|td|th|ul|ol)\b[^>]*>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) text = '[Table omitted during DEV markdown conversion.]';
  return `\n\n> ${text.replace(/\n/g, '\n> ')}\n\n`;
}

function getHtmlAttribute(attrs: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function absoluteUrl(url: string): string {
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

function escapeMarkdownAlt(value: string): string {
  return value.replace(/]/g, '\\]');
}

function escapeMarkdownEmphasis(value: string): string {
  return value.replace(/_/g, '\\_');
}

function yamlScalar(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}
