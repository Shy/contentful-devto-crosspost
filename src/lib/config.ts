import type { AppConfig, FieldMapping } from './types';

export const DEFAULT_FIELD_MAPPING: FieldMapping = {
  titleField: 'title',
  slugField: 'slug',
  bodyField: 'content',
  publishDateField: 'publishDate',
  descriptionField: 'metaDescription',
  tagsField: 'tags',
  categoryField: 'category',
  coverImagePrimaryField: 'socialCard',
  coverImageFallbackField: 'featureImage',
};

export const DEFAULT_APP_CONFIG: AppConfig = {
  contentTypeId: 'blogPost',
  siteBlogBaseUrl: 'https://temporal.io/blog',
  devtoOrgUsername: 'temporalio',
  devtoOrgId: '3146',
  forcedFirstTag: 'temporal',
  publishDelayDays: 7,
  sidebarPosition: 2,
  appActionId: 'createDevtoDraft',
  fieldMapping: DEFAULT_FIELD_MAPPING,
};

export function resolveAppConfig(parameters: unknown): AppConfig {
  const input = isRecord(parameters) ? parameters : {};
  const mapping = isRecord(input.fieldMapping) ? input.fieldMapping : {};

  return {
    ...DEFAULT_APP_CONFIG,
    ...pickStringNumberConfig(input),
    fieldMapping: {
      ...DEFAULT_FIELD_MAPPING,
      ...pickStringConfig(mapping),
    },
  };
}

function pickStringNumberConfig(input: Record<string, unknown>): Partial<AppConfig> {
  return {
    contentTypeId: stringOr(input.contentTypeId, DEFAULT_APP_CONFIG.contentTypeId),
    siteBlogBaseUrl: stringOr(input.siteBlogBaseUrl, DEFAULT_APP_CONFIG.siteBlogBaseUrl),
    devtoOrgUsername: stringOr(input.devtoOrgUsername, DEFAULT_APP_CONFIG.devtoOrgUsername),
    devtoOrgId: stringOr(input.devtoOrgId, DEFAULT_APP_CONFIG.devtoOrgId),
    forcedFirstTag: stringOr(input.forcedFirstTag, DEFAULT_APP_CONFIG.forcedFirstTag),
    publishDelayDays: numberOr(input.publishDelayDays, DEFAULT_APP_CONFIG.publishDelayDays),
    sidebarPosition: numberOr(input.sidebarPosition, DEFAULT_APP_CONFIG.sidebarPosition),
    appActionId: stringOr(input.appActionId, DEFAULT_APP_CONFIG.appActionId),
  };
}

function pickStringConfig(input: Record<string, unknown>): Partial<FieldMapping> {
  const out: Partial<FieldMapping> = {};
  for (const key of Object.keys(DEFAULT_FIELD_MAPPING) as (keyof FieldMapping)[]) {
    out[key] = stringOr(input[key], DEFAULT_FIELD_MAPPING[key]);
  }
  return out;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
