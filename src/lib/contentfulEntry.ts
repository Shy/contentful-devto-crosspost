import type { AppConfig, ContentfulPostInput } from './types';

type AnySdk = any;

export type PublishState = {
  isPublished: boolean;
  hasUnpublishedChanges: boolean;
  publishedVersion?: number;
  version?: number;
};

export function getPublishState(sdk: AnySdk): PublishState {
  const sys = sdk.entry.getSys();
  const publishedVersion = sys.publishedVersion as number | undefined;
  const version = sys.version as number | undefined;
  const isPublished = typeof publishedVersion === 'number';
  const hasUnpublishedChanges =
    isPublished && typeof version === 'number' && typeof publishedVersion === 'number'
      ? version > publishedVersion + 1
      : false;

  return {
    isPublished,
    hasUnpublishedChanges,
    publishedVersion,
    version,
  };
}

export function getCurrentContentTypeId(sdk: AnySdk): string {
  return sdk.contentType?.sys?.id ?? sdk.entry?.getSys?.().contentType?.sys?.id ?? '';
}

export async function readPostInputFromEntry(sdk: AnySdk, config: AppConfig): Promise<ContentfulPostInput> {
  const locale = sdk.locales?.default ?? sdk.locales?.available?.[0];
  const fields = config.fieldMapping;
  const [coverImagePrimaryUrl, coverImageFallbackUrl] = await Promise.all([
    assetUrlField(sdk, fields.coverImagePrimaryField, locale),
    assetUrlField(sdk, fields.coverImageFallbackField, locale),
  ]);

  return {
    title: stringField(sdk, fields.titleField, locale),
    slug: stringField(sdk, fields.slugField, locale),
    bodyMarkdown: stringField(sdk, fields.bodyField, locale),
    publishDate: stringField(sdk, fields.publishDateField, locale),
    description: optionalStringField(sdk, fields.descriptionField, locale),
    tags: stringArrayField(sdk, fields.tagsField, locale),
    category: optionalStringField(sdk, fields.categoryField, locale),
    coverImagePrimaryUrl,
    coverImageFallbackUrl,
  };
}

function stringField(sdk: AnySdk, fieldId: string, locale: string): string {
  return String(getFieldValue(sdk, fieldId, locale) ?? '').trim();
}

function optionalStringField(sdk: AnySdk, fieldId: string, locale: string): string | undefined {
  const value = stringField(sdk, fieldId, locale);
  return value || undefined;
}

function stringArrayField(sdk: AnySdk, fieldId: string, locale: string): string[] {
  const value = getFieldValue(sdk, fieldId, locale);
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function getFieldValue(sdk: AnySdk, fieldId: string, locale: string): unknown {
  const field = sdk.entry.fields[fieldId];
  if (!field) return undefined;
  try {
    return field.getValue(locale);
  } catch {
    return field.getValue();
  }
}

async function assetUrlField(sdk: AnySdk, fieldId: string, locale: string): Promise<string | undefined> {
  const value = getFieldValue(sdk, fieldId, locale);
  if (!value) return undefined;

  if (typeof value === 'object' && value !== null && 'fields' in value) {
    const maybeUrl = (value as any).fields?.file?.[locale]?.url ?? (value as any).fields?.file?.url;
    return absoluteAssetUrl(maybeUrl);
  }

  const assetId = (value as any)?.sys?.id;
  if (!assetId) return undefined;

  try {
    const asset =
      (await sdk.cma?.asset?.get?.({ assetId })) ??
      (await sdk.space?.getAsset?.(assetId));
    const file = asset?.fields?.file?.[locale] ?? asset?.fields?.file?.[sdk.locales?.default];
    return absoluteAssetUrl(file?.url);
  } catch {
    return undefined;
  }
}

function absoluteAssetUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return trimmed;
}
