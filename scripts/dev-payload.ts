import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveAppConfig } from '../src/lib/config';
import { buildDevtoArticlePayload } from '../src/lib/devtoPayload';
import type { ContentfulPostInput } from '../src/lib/types';

type Env = Record<string, string>;

async function main() {
  const env = {
    ...(await readEnvFile('.env')),
    ...pickProcessEnv([
      'CONTENTFUL_SPACE_ID',
      'CONTENTFUL_ENVIRONMENT_ID',
      'CONTENTFUL_DELIVERY_TOKEN',
      'CONTENTFUL_PREVIEW_TOKEN',
      'SITE_BLOG_BASE_URL',
      'DEVTO_ORG_USERNAME',
      'DEVTO_ORG_ID',
    ]),
  };
  const entryId = argValue('--entry');
  const slug = argValue('--slug');
  const config = resolveAppConfig({
    contentTypeId: 'blogPost',
    siteBlogBaseUrl: env.SITE_BLOG_BASE_URL || 'https://temporal.io/blog',
    devtoOrgUsername: env.DEVTO_ORG_USERNAME || 'temporalio',
    devtoOrgId: env.DEVTO_ORG_ID || '3146',
  });

  const post = await fetchBlogPost(env, { entryId, slug });
  const result = buildDevtoArticlePayload(post, config);
  const outDir = path.join(process.cwd(), 'tmp');
  const outPath = path.join(outDir, `${safeFileName(post.slug)}.devto.md`);
  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, result.payload.body_markdown, 'utf8');

  const summary = {
    title: result.payload.title,
    canonical_url: result.payload.canonical_url,
    published: result.payload.published,
    date: result.defaultDate,
    tags: result.tags,
    description: result.payload.description,
    main_image: result.payload.main_image ?? null,
    organization_id: result.payload.organization_id ?? null,
    markdownFile: outPath,
    warnings: result.warnings,
  };

  console.log(JSON.stringify(summary, null, 2));
}

async function readEnvFile(filePath: string): Promise<Env> {
  const raw = await readFile(filePath, 'utf8');
  const env: Env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    env[line.slice(0, index)] = line.slice(index + 1);
  }
  return env;
}

async function fetchBlogPost(
  env: Env,
  options: { entryId?: string; slug?: string },
): Promise<ContentfulPostInput> {
  const spaceId = requiredEnv(env, 'CONTENTFUL_SPACE_ID');
  const environmentId = env.CONTENTFUL_ENVIRONMENT_ID || 'master';
  const token = env.CONTENTFUL_PREVIEW_TOKEN || env.CONTENTFUL_DELIVERY_TOKEN;
  if (!token) throw new Error('Set CONTENTFUL_PREVIEW_TOKEN or CONTENTFUL_DELIVERY_TOKEN in .env.');

  const endpoint = `https://graphql.contentful.com/content/v1/spaces/${spaceId}/environments/${environmentId}`;
  const selector = options.entryId
    ? `blogPost(id: ${JSON.stringify(options.entryId)}, preview: true)`
    : `blogPostCollection(limit: 1, preview: true, order: [publishDate_DESC]${
        options.slug ? `, where: { slug: ${JSON.stringify(options.slug)} }` : ''
      })`;
  const isCollection = !options.entryId;
  const query = `
    query DryRunBlogPost {
      result: ${selector} {
        ${
          isCollection
            ? `items {
                ...BlogPostFields
              }`
            : `...BlogPostFields`
        }
      }
    }

    fragment BlogPostFields on BlogPost {
      title
      slug
      publishDate
      metaDescription
      tags
      category
      content
      socialCard { url }
      featureImage { url }
    }
  `;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
  });

  const data = (await response.json()) as any;
  if (!response.ok || data.errors) {
    throw new Error(JSON.stringify(data.errors ?? data, null, 2));
  }

  const item = isCollection ? data.data.result?.items?.[0] : data.data.result;
  if (!item) throw new Error('No blogPost entry found for dry run.');

  return {
    title: item.title,
    slug: item.slug,
    publishDate: item.publishDate,
    bodyMarkdown: item.content,
    description: item.metaDescription,
    tags: item.tags ?? [],
    category: item.category,
    coverImagePrimaryUrl: item.socialCard?.url,
    coverImageFallbackUrl: item.featureImage?.url,
  };
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function requiredEnv(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Set ${name} in .env.`);
  return value;
}

function pickProcessEnv(names: string[]): Env {
  const env: Env = {};
  for (const name of names) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  return env;
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'devto-draft';
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
