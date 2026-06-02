import { buildDevtoMarkdown } from './markdown';
import type { AppConfig, BuildPayloadResult, ContentfulPostInput } from './types';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PUBLISH_HOUR_EASTERN = 10;
const DEFAULT_PUBLISH_MINUTE_EASTERN = 0;
const DEFAULT_PUBLISH_TIME_ZONE = 'America/New_York';
const DEV_COVER_IMAGE_WIDTH = '1000';
const DEV_COVER_IMAGE_HEIGHT = '420';
const CONTENTFUL_IMAGE_HOSTS = new Set(['images.ctfassets.net', 'images.contentful.com']);
const CONTENTFUL_DATE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:\s*(Z|UTC|[+-]\d{2}:?\d{2}))?)?$/i;

export function buildDevtoArticlePayload(input: ContentfulPostInput, config: AppConfig): BuildPayloadResult {
  const missing = requiredFields(input);
  if (missing.length > 0) {
    throw new Error(`Missing required Contentful fields: ${missing.join(', ')}`);
  }

  const canonicalUrl = joinUrl(config.siteBlogBaseUrl, input.slug);
  const defaultDate = addDaysAsDevtoDateTime(input.publishDate, config.publishDelayDays);
  const coverImage = normalizeCoverImageUrl(input.coverImagePrimaryUrl) ?? normalizeCoverImageUrl(input.coverImageFallbackUrl);
  const tags = normalizeTags({
    forcedFirstTag: config.forcedFirstTag,
    contentfulTags: input.tags ?? [],
    category: input.category,
  });
  const description = cleanDescription(input.description) || excerptFromMarkdown(input.bodyMarkdown);

  const markdown = buildDevtoMarkdown(input.bodyMarkdown, {
    title: input.title.trim(),
    published: false,
    tags,
    date: defaultDate,
    canonical_url: canonicalUrl,
    cover_image: coverImage,
    description,
  });

  const organizationId = Number(config.devtoOrgId);

  return {
    payload: {
      title: input.title.trim(),
      body_markdown: markdown.markdown,
      published: false,
      main_image: coverImage,
      canonical_url: canonicalUrl,
      description,
      tags: tags.join(', '),
      ...(Number.isFinite(organizationId) && organizationId > 0 ? { organization_id: organizationId } : {}),
    },
    canonicalUrl,
    defaultDate,
    tags,
    warnings: markdown.warnings,
  };
}

function requiredFields(input: ContentfulPostInput): string[] {
  const missing: string[] = [];
  if (!input.title?.trim()) missing.push('title');
  if (!input.slug?.trim()) missing.push('slug');
  if (!input.bodyMarkdown?.trim()) missing.push('content');
  if (!input.publishDate?.trim()) missing.push('publishDate');
  return missing;
}

export function normalizeTags({
  forcedFirstTag,
  contentfulTags,
  category,
}: {
  forcedFirstTag?: string;
  contentfulTags: string[];
  category?: string;
}): string[] {
  const output: string[] = [];

  const add = (tag: string | undefined) => {
    const normalized = normalizeTag(tag);
    if (!normalized || output.includes(normalized) || output.length >= 4) return;
    output.push(normalized);
  };

  add(forcedFirstTag);
  for (const tag of contentfulTags) add(tag);
  add(category);

  return output;
}

export function normalizeTag(tag: string | undefined): string {
  return String(tag ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 30);
}

function joinUrl(base: string, slug: string): string {
  const cleanBase = parseHttpsBaseUrl(base);
  const cleanSlug = slug.trim().replace(/^\/+|\/+$/g, '');
  if (!cleanSlug) throw new Error('Slug must contain at least one URL path segment.');
  const cleanBasePath = cleanBase.pathname.replace(/\/+$/, '');
  cleanBase.pathname = [cleanBasePath, cleanSlug].filter(Boolean).join('/');
  cleanBase.search = '';
  cleanBase.hash = '';
  return cleanBase.toString();
}

function addDaysAsDevtoDateTime(value: string, days: number): string {
  const parsed = parseContentfulPublishDate(value);
  if (!parsed) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) throw new Error(`Invalid publish date: ${value}`);
    return formatUtcDateTime(new Date(timestamp + days * ONE_DAY_MS));
  }

  if (parsed.offset) {
    const timestamp = Date.parse(
      `${datePart(parsed)}T${timePart(parsed)}${parsed.offset}`,
    );
    if (!Number.isFinite(timestamp)) throw new Error(`Invalid publish date: ${value}`);
    return formatUtcDateTime(new Date(timestamp + days * ONE_DAY_MS));
  }

  const shiftedDate = addCalendarDays(parsed, days);
  const hour = parsed.hasTime ? parsed.hour : DEFAULT_PUBLISH_HOUR_EASTERN;
  const minute = parsed.hasTime ? parsed.minute : DEFAULT_PUBLISH_MINUTE_EASTERN;
  return formatUtcDateTime(
    zonedTimeToUtc({
      ...shiftedDate,
      hour,
      minute,
      second: parsed.hasTime ? parsed.second : 0,
      timeZone: DEFAULT_PUBLISH_TIME_ZONE,
    }),
  );
}

function normalizeCoverImageUrl(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalUrl(value);
  if (!normalized) return undefined;

  try {
    const url = new URL(normalized);
    if (!CONTENTFUL_IMAGE_HOSTS.has(url.hostname)) return normalized;

    url.searchParams.set('w', DEV_COVER_IMAGE_WIDTH);
    url.searchParams.set('h', DEV_COVER_IMAGE_HEIGHT);
    url.searchParams.set('fit', 'fill');
    return url.toString();
  } catch {
    return normalized;
  }
}

function normalizeOptionalUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return trimmed;
}

function parseHttpsBaseUrl(value: string): URL {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') throw new Error('Expected HTTPS.');
    return parsed;
  } catch {
    throw new Error('Canonical base URL must be a valid HTTPS URL.');
  }
}

function cleanDescription(value: string | undefined): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

type ParsedPublishDate = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  hasTime: boolean;
  offset?: string;
};

function parseContentfulPublishDate(value: string): ParsedPublishDate | undefined {
  const match = CONTENTFUL_DATE_PATTERN.exec(value.trim());
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hasTime = match[4] !== undefined;
  const hour = hasTime ? Number(match[4]) : DEFAULT_PUBLISH_HOUR_EASTERN;
  const minute = hasTime ? Number(match[5]) : DEFAULT_PUBLISH_MINUTE_EASTERN;
  const second = hasTime && match[6] !== undefined ? Number(match[6]) : 0;
  const offset = normalizeOffset(match[7]);
  const midnightUtcDateOnly = hasTime && offset === 'Z' && hour === 0 && minute === 0 && second === 0;

  if (!isValidDateOnly(year, month, day) || !isValidTime(hour, minute, second)) {
    throw new Error(`Invalid publish date: ${value}`);
  }

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    hasTime: hasTime && !midnightUtcDateOnly,
    offset: midnightUtcDateOnly ? undefined : offset,
  };
}

function addCalendarDays(
  value: Pick<ParsedPublishDate, 'year' | 'month' | 'day'>,
  days: number,
): Pick<ParsedPublishDate, 'year' | 'month' | 'day'> {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function zonedTimeToUtc({
  year,
  month,
  day,
  hour,
  minute,
  second,
  timeZone,
}: Pick<ParsedPublishDate, 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second'> & {
  timeZone: string;
}): Date {
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let timestamp = targetAsUtc;

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const parts = zonedDateParts(new Date(timestamp), timeZone);
    const currentAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const delta = currentAsUtc - targetAsUtc;
    if (delta === 0) break;
    timestamp -= delta;
  }

  return new Date(timestamp);
}

function zonedDateParts(date: Date, timeZone: string): Required<Omit<ParsedPublishDate, 'hasTime' | 'offset'>> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function formatUtcDateTime(date: Date): string {
  return [
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`,
    'UTC',
  ].join(' ');
}

function datePart(value: Pick<ParsedPublishDate, 'year' | 'month' | 'day'>): string {
  return `${value.year}-${pad(value.month)}-${pad(value.day)}`;
}

function timePart(value: Pick<ParsedPublishDate, 'hour' | 'minute' | 'second'>): string {
  return `${pad(value.hour)}:${pad(value.minute)}:${pad(value.second)}`;
}

function normalizeOffset(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^(?:z|utc)$/i.test(value)) return 'Z';
  return value.includes(':') ? value : `${value.slice(0, 3)}:${value.slice(3)}`;
}

function isValidDateOnly(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidTime(hour: number, minute: number, second: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function excerptFromMarkdown(markdown: string): string {
  return markdown
    .replace(/^---[\s\S]*?---/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
