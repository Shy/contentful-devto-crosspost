import type { DevtoArticlePayload, DevtoArticleSummary, DevtoUser } from '../src/lib/types';
import { credentialFingerprint, sanitizeForDebug } from '../src/lib/debug';

const DEVTO_API_BASE = 'https://dev.to/api';
const ACCEPT = 'application/vnd.forem.api-v1+json';
const USER_AGENT = 'Temporal DEV Crosspost Contentful App/0.1 (+https://temporal.io)';
const MAX_PAGES = 5;
const PER_PAGE = 1000;

export type DuplicateResult = {
  article: DevtoArticleSummary;
  scope: 'user' | 'org';
};

export class DevtoApiError extends Error {
  status: number;
  details: unknown;

  constructor(status: number, message: string, details: unknown) {
    super(message);
    this.name = 'DevtoApiError';
    this.status = status;
    this.details = details;
  }
}

export async function verifyDevtoKey(apiKey: string): Promise<DevtoUser> {
  return devtoFetch<DevtoUser>('/users/me', apiKey);
}

export async function verifyOrgMembership(orgUsername: string, user: DevtoUser, apiKey: string): Promise<boolean> {
  if (!orgUsername) return true;

  const wantedUserId = user.id ?? user.user_id;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const users = await devtoFetch<DevtoUser[]>(
      `/organizations/${encodeURIComponent(orgUsername)}/users?page=${page}&per_page=${PER_PAGE}`,
      apiKey,
    );
    if (
      users.some((member) => {
        const memberId = member.id ?? member.user_id;
        return member.username === user.username || (wantedUserId && memberId === wantedUserId);
      })
    ) {
      return true;
    }
    if (users.length < PER_PAGE) return false;
  }

  return false;
}

export async function findDuplicateArticle(
  canonicalUrl: string,
  apiKey: string,
  orgUsername?: string,
): Promise<DuplicateResult | undefined> {
  const userDuplicate = await findInPagedArticles({
    path: '/articles/me/all',
    apiKey,
    canonicalUrl,
    scope: 'user',
  });
  if (userDuplicate) return userDuplicate;

  if (!orgUsername) return undefined;

  return findInPagedArticles({
    path: `/organizations/${encodeURIComponent(orgUsername)}/articles`,
    canonicalUrl,
    scope: 'org',
  });
}

export async function createDevtoDraft(
  apiKey: string,
  payload: DevtoArticlePayload,
): Promise<DevtoArticleSummary> {
  return devtoFetch<DevtoArticleSummary>('/articles', apiKey, {
    method: 'POST',
    body: JSON.stringify({
      article: {
        ...payload,
        published: false,
      },
    }),
  });
}

export function editUrlForArticle(article: DevtoArticleSummary, scope: 'user' | 'org' = 'user'): string | undefined {
  if (!article.url) return undefined;
  const clean = article.url.replace(/\/+$/, '');
  return scope === 'user' ? `${clean}/edit` : clean;
}

async function findInPagedArticles({
  path,
  apiKey,
  canonicalUrl,
  scope,
}: {
  path: string;
  apiKey?: string;
  canonicalUrl: string;
  scope: 'user' | 'org';
}): Promise<DuplicateResult | undefined> {
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const articles = await devtoFetch<DevtoArticleSummary[]>(
      `${path}${separator}page=${page}&per_page=${PER_PAGE}`,
      apiKey,
    );
    const duplicate = articles.find((article) => article.canonical_url === canonicalUrl);
    if (duplicate) return { article: duplicate, scope };
    if (articles.length < PER_PAGE) return undefined;
  }
  return undefined;
}

async function devtoFetch<T>(path: string, apiKey?: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const response = await fetch(`${DEVTO_API_BASE}${path}`, {
    ...init,
    headers: {
      accept: ACCEPT,
      'user-agent': USER_AGENT,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(apiKey ? { 'api-key': apiKey } : {}),
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const data = text ? safeJson(text) : undefined;
  const requestDetails = {
    method,
    path,
    status: response.status,
    headers: {
      accept: ACCEPT,
      userAgent: USER_AGENT,
      hasCredential: Boolean(apiKey),
    },
    credential: apiKey ? credentialFingerprint(apiKey) : undefined,
  };

  if (!response.ok) {
    const details = {
      request: requestDetails,
      response: data ?? null,
    };
    const safeDetails = sanitizeForDebug(details);
    console.error('[DEV Crosspost] DEV API error', safeDetails);
    throw new DevtoApiError(response.status, friendlyErrorMessage(response.status, data, requestDetails), safeDetails);
  }

  console.info('[DEV Crosspost] DEV API ok', requestDetails);
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function friendlyErrorMessage(
  status: number,
  data: unknown,
  request: { method: string; path: string; status: number },
): string {
  const detail = devtoMessage(data);
  const suffix = detail ? `: ${detail}` : '.';
  if (status === 401) return `DEV returned 401 on ${request.method} ${request.path}${suffix}`;
  if (status === 403) return `DEV returned 403 on ${request.method} ${request.path}${suffix}`;
  if (status === 404) return `DEV returned 404 on ${request.method} ${request.path}${suffix}`;
  if (status === 422) return validationMessage(data);
  return `DEV returned ${status} on ${request.method} ${request.path}${suffix}`;
}

function validationMessage(data: unknown): string {
  const error = devtoMessage(data);
  if (typeof error === 'string' && /organization/i.test(error)) {
    return 'Your DEV account may not be allowed to post under this organization.';
  }
  return error ? `DEV rejected the draft payload: ${error}` : 'DEV rejected the draft payload. Review the generated markdown and metadata.';
}

function devtoMessage(data: unknown): string | undefined {
  if (typeof data === 'string') return data;
  if (typeof data !== 'object' || data === null) return undefined;

  const record = data as Record<string, unknown>;
  const direct = record.error ?? record.message;
  if (typeof direct === 'string') return direct;

  if (Array.isArray(record.errors)) {
    return record.errors.map((item) => String(item)).join(', ');
  }

  return undefined;
}
