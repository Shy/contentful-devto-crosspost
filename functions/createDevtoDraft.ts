import type { FunctionEventHandler } from '@contentful/node-apps-toolkit';
import { FunctionTypeEnum } from '@contentful/node-apps-toolkit';
import { resolveAppConfig } from '../src/lib/config';
import { errorToDebug, messageFromUnknown } from '../src/lib/debug';
import { buildDevtoArticlePayload } from '../src/lib/devtoPayload';
import type {
  AppConfig,
  BuildPayloadResult,
  ContentfulPostInput,
  DevtoActionRequest,
  DevtoActionResponse,
  DevtoArticlePayload,
} from '../src/lib/types';
import {
  createDevtoDraft,
  DevtoApiError,
  editUrlForArticle,
  findDuplicateArticle,
  verifyDevtoKey,
  verifyOrgMembership,
} from './devtoApi';

export const handler: FunctionEventHandler<typeof FunctionTypeEnum.AppActionCall, AppConfig> = async (
  event,
  context,
) => {
  let mode: DevtoActionResponse['mode'] = 'verify';

  try {
    const request = normalizeActionRequest(event.body);
    mode = request.mode;
    const config = resolveAppConfig(context.appInstallationParameters);

    if (!request.devtoApiKey?.trim()) {
      return errorResponse(request.mode, 'DEV API key is required.');
    }

    const user = await verifyDevtoKey(request.devtoApiKey);
    const orgVerified =
      request.mode === 'lookupDraft'
        ? false
        : await verifyOrgMembership(config.devtoOrgUsername, user, request.devtoApiKey);

    if (request.mode !== 'lookupDraft' && config.devtoOrgUsername && !orgVerified) {
      return {
        ok: false,
        mode: request.mode,
        status: 'error',
        user,
        org: { username: config.devtoOrgUsername, verified: false },
        message: `Your DEV account is not a member of ${config.devtoOrgUsername}.`,
      } satisfies DevtoActionResponse;
    }

    if (request.mode === 'verify') {
      return {
        ok: true,
        mode: 'verify',
        status: 'verified',
        user,
        org: { username: config.devtoOrgUsername, verified: orgVerified },
      } satisfies DevtoActionResponse;
    }

    const built = await buildPayloadForRequest(context.cma, request, config, {
      spaceId: context.spaceId,
      environmentId: context.environmentId,
    });
    const payload = enforceDraftPayload(built.payload, config);
    const canonicalValidation = validateCanonicalUrl(payload.canonical_url, config.siteBlogBaseUrl);
    if (canonicalValidation) {
      return errorResponse(request.mode, canonicalValidation);
    }

    const duplicate = await findDuplicateArticle(payload.canonical_url, request.devtoApiKey, config.devtoOrgUsername);
    if (duplicate) {
      const editUrl = editUrlForArticle(duplicate.article, duplicate.scope);
      const rewriteWarnings = request.mode === 'createDraft' ? built.warnings : [];
      const warnings = [
        ...rewriteWarnings,
        duplicate.scope === 'org'
          ? 'Found an existing published organization article with the same canonical URL.'
          : 'Found an existing article in this DEV account with the same canonical URL.',
      ];
      return {
        ok: true,
        mode: request.mode,
        status: 'duplicate',
        user,
        org: { username: config.devtoOrgUsername, verified: orgVerified },
        article: duplicate.article,
        editUrl,
        warnings,
      } satisfies DevtoActionResponse;
    }

    if (request.mode === 'lookupDraft') {
      return {
        ok: true,
        mode: 'lookupDraft',
        status: 'notFound',
        user,
        org: { username: config.devtoOrgUsername, verified: orgVerified },
      } satisfies DevtoActionResponse;
    }

    const article = await createDevtoDraft(request.devtoApiKey, payload);
    return {
      ok: true,
      mode: 'createDraft',
      status: 'created',
      user,
      org: { username: config.devtoOrgUsername, verified: orgVerified },
      article,
      editUrl: editUrlForArticle(article, 'user'),
      warnings: built.warnings,
    } satisfies DevtoActionResponse;
  } catch (error) {
    if (error instanceof DevtoApiError) {
      return {
        ok: false,
        mode,
        status: 'error',
        message: error.message,
        raw: {
          status: error.status,
          message: error.message,
        },
      } satisfies DevtoActionResponse;
    }

    const raw = errorToDebug(error);
    console.error('[DEV Crosspost] Function error', raw);
    return {
      ...errorResponse(mode, messageFromUnknown(error, 'Unknown DEV crosspost error.')),
      raw,
    } satisfies DevtoActionResponse;
  }
};

function normalizeActionRequest(body: unknown): DevtoActionRequest {
  const input = unwrapParameters(body);
  const mode = stringValue(input.mode);
  const devtoApiKey = stringValue(input.devtoApiKey);

  if (mode === 'verify') {
    return {
      mode,
      devtoApiKey,
    };
  }

  if (mode === 'createDraft' || mode === 'lookupDraft') {
    return {
      mode,
      devtoApiKey,
      entryId: stringValue(input.entryId),
      locale: stringValue(input.locale) || undefined,
    };
  }

  throw new Error('Unsupported DEV crosspost action mode.');
}

function unwrapParameters(body: unknown): Record<string, unknown> {
  const input = recordValue(body);
  if (!input) return {};
  return recordValue(input.parameters) ?? input;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function enforceDraftPayload(payload: DevtoArticlePayload, config: AppConfig): DevtoArticlePayload {
  const organizationId = Number(config.devtoOrgId);
  return {
    ...payload,
    published: false,
    ...(Number.isFinite(organizationId) && organizationId > 0 ? { organization_id: organizationId } : {}),
  };
}

async function buildPayloadForRequest(
  cma: CmaClient | undefined,
  request: Extract<DevtoActionRequest, { mode: 'createDraft' | 'lookupDraft' }>,
  config: AppConfig,
  scope: CmaScope,
): Promise<BuildPayloadResult> {
  if (!cma?.entry?.get) {
    throw new Error('Contentful CMA is not available to the App Action Function.');
  }

  if (!request.entryId.trim()) {
    throw new Error('Contentful entry ID is required.');
  }

  const entry = await getEntry(cma, request.entryId.trim(), scope);
  const contentTypeId = entry?.sys?.contentType?.sys?.id;
  if (contentTypeId !== config.contentTypeId) {
    throw new Error(`DEV crosspost is only available for ${config.contentTypeId}.`);
  }

  const publishState = getEntryPublishState(entry);
  if (!publishState.isPublished) {
    throw new Error('Waiting for publish.');
  }
  if (publishState.hasUnpublishedChanges) {
    throw new Error('Waiting for latest publish.');
  }

  const locale = request.locale || await defaultLocale(cma, scope) || firstEntryLocale(entry);
  if (!locale) {
    throw new Error('Could not determine a Contentful locale for this entry.');
  }

  const input = await readPostInputFromCmaEntry(cma, entry, config, locale, scope);
  return buildDevtoArticlePayload(input, config);
}

async function readPostInputFromCmaEntry(
  cma: CmaClient,
  entry: CmaEntry,
  config: AppConfig,
  locale: string,
  scope: CmaScope,
): Promise<ContentfulPostInput> {
  const fields = config.fieldMapping;
  const [coverImagePrimaryUrl, coverImageFallbackUrl] = await Promise.all([
    assetUrlField(cma, entry, fields.coverImagePrimaryField, locale, scope),
    assetUrlField(cma, entry, fields.coverImageFallbackField, locale, scope),
  ]);

  return {
    title: stringField(entry, fields.titleField, locale),
    slug: stringField(entry, fields.slugField, locale),
    bodyMarkdown: stringField(entry, fields.bodyField, locale),
    publishDate: stringField(entry, fields.publishDateField, locale),
    description: optionalStringField(entry, fields.descriptionField, locale),
    tags: stringArrayField(entry, fields.tagsField, locale),
    category: optionalStringField(entry, fields.categoryField, locale),
    coverImagePrimaryUrl,
    coverImageFallbackUrl,
  };
}

function getEntryPublishState(entry: CmaEntry): { isPublished: boolean; hasUnpublishedChanges: boolean } {
  const publishedVersion = entry?.sys?.publishedVersion;
  const version = entry?.sys?.version;
  const isPublished = typeof publishedVersion === 'number';
  const hasUnpublishedChanges =
    isPublished && typeof version === 'number' ? version > publishedVersion + 1 : false;
  return { isPublished, hasUnpublishedChanges };
}

function stringField(entry: CmaEntry, fieldId: string, locale: string): string {
  return String(localizedFieldValue(entry, fieldId, locale) ?? '').trim();
}

function optionalStringField(entry: CmaEntry, fieldId: string, locale: string): string | undefined {
  const value = stringField(entry, fieldId, locale);
  return value || undefined;
}

function stringArrayField(entry: CmaEntry, fieldId: string, locale: string): string[] {
  const value = localizedFieldValue(entry, fieldId, locale);
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

async function assetUrlField(
  cma: CmaClient,
  entry: CmaEntry,
  fieldId: string,
  locale: string,
  scope: CmaScope,
): Promise<string | undefined> {
  const value = localizedFieldValue(entry, fieldId, locale);
  if (!value) return undefined;

  if (typeof value === 'object' && value !== null && 'fields' in value) {
    return absoluteAssetUrl(fileUrl((value as CmaAsset).fields?.file, locale));
  }

  const assetId = (value as CmaLink)?.sys?.id;
  if (!assetId || !cma.asset?.get) return undefined;

  try {
    const asset = await cma.asset.get(scopedParams(scope, { assetId }));
    return absoluteAssetUrl(fileUrl(asset?.fields?.file, locale));
  } catch {
    return undefined;
  }
}

function localizedFieldValue(entry: CmaEntry, fieldId: string, locale: string): unknown {
  const field = entry?.fields?.[fieldId];
  if (!field || typeof field !== 'object' || Array.isArray(field)) return undefined;
  const localized = field as Record<string, unknown>;
  if (locale && localized[locale] !== undefined) return localized[locale];
  return Object.values(localized)[0];
}

async function defaultLocale(cma: CmaClient, scope: CmaScope): Promise<string | undefined> {
  try {
    const result = await cma.locale?.getMany?.(scopedParams(scope, {}));
    const locales = Array.isArray(result?.items) ? result.items : [];
    return locales.find((locale: { default?: boolean }) => locale.default)?.code ?? locales[0]?.code;
  } catch {
    return undefined;
  }
}

function firstEntryLocale(entry: CmaEntry): string | undefined {
  for (const value of Object.values(entry.fields ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const locale = Object.keys(value)[0];
      if (locale) return locale;
    }
  }
  return undefined;
}

function fileUrl(file: CmaAssetFile | undefined, locale: string): string | undefined {
  if (!file || typeof file !== 'object' || Array.isArray(file)) return undefined;
  if ('url' in file && typeof file.url === 'string') return file.url;
  const localizedFile = file as Record<string, { url?: string }>;
  return localizedFile[locale]?.url ?? localizedFile[Object.keys(localizedFile)[0]]?.url;
}

function absoluteAssetUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return trimmed;
}

function validateCanonicalUrl(canonicalUrl: string, baseUrl: string): string | undefined {
  const parsedBase = parseHttpsUrl(baseUrl);
  if (!parsedBase) return 'Canonical base URL must be a valid HTTPS URL.';

  const parsedCanonical = parseHttpsUrl(canonicalUrl);
  if (!parsedCanonical) return 'Canonical URL must be a valid HTTPS URL.';

  const basePath = parsedBase.pathname.replace(/\/+$/, '');
  const canonicalPath = parsedCanonical.pathname.replace(/\/+$/, '');
  const pathMatches =
    basePath === '' || canonicalPath === basePath || canonicalPath.startsWith(`${basePath}/`);

  if (parsedCanonical.origin !== parsedBase.origin || !pathMatches) {
    return `Canonical URL must be under ${parsedBase.origin}${basePath}/.`;
  }

  return undefined;
}

function parseHttpsUrl(value: string): URL | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function errorResponse(mode: DevtoActionResponse['mode'], message: string): DevtoActionResponse {
  return {
    ok: false,
    mode,
    status: 'error',
    message,
  };
}

type CmaClient = {
  entry?: {
    get?: (query: CmaScopedParams<{ entryId: string }>) => Promise<CmaEntry>;
  };
  asset?: {
    get?: (query: CmaScopedParams<{ assetId: string }>) => Promise<CmaAsset>;
  };
  locale?: {
    getMany?: (query: CmaScopedParams<Record<string, unknown>>) => Promise<{
      items?: Array<{ code?: string; default?: boolean }>;
    }>;
  };
};

type CmaScope = {
  spaceId?: string;
  environmentId?: string;
};

type CmaScopedParams<T extends Record<string, unknown>> = T & Partial<CmaScope>;

async function getEntry(cma: CmaClient, entryId: string, scope: CmaScope): Promise<CmaEntry> {
  try {
    return await cma.entry!.get!(scopedParams(scope, { entryId }));
  } catch (error) {
    throw new Error(`Could not fetch Contentful entry ${entryId}: ${messageFromUnknown(error)}`);
  }
}

function scopedParams<T extends Record<string, unknown>>(scope: CmaScope, params: T): CmaScopedParams<T> {
  if (!scope.spaceId || !scope.environmentId) return params;
  return {
    spaceId: scope.spaceId,
    environmentId: scope.environmentId,
    ...params,
  };
}

type CmaEntry = {
  sys?: {
    version?: number;
    publishedVersion?: number;
    contentType?: {
      sys?: {
        id?: string;
      };
    };
  };
  fields?: Record<string, Record<string, unknown>>;
};

type CmaAsset = {
  fields?: {
    file?: CmaAssetFile;
  };
};

type CmaAssetFile = Record<string, { url?: string }> | { url?: string };

type CmaLink = {
  sys?: {
    id?: string;
  };
};
