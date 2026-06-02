type StorageValue = {
  apiKey: string;
  username?: string;
  verifiedAt?: string;
  expiresAt?: string;
};

const STORAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function storageKey(ids: { space?: string; environment?: string; app?: string }): string {
  return ['devtoCrosspost', ids.space, ids.environment, ids.app].filter(Boolean).join(':');
}

export function readStoredDevtoKey(key: string): StorageValue | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!isStorageValue(parsed)) return undefined;
    if (isExpired(parsed.expiresAt)) {
      window.localStorage.removeItem(key);
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeStoredDevtoKey(key: string, value: StorageValue): void {
  window.localStorage.setItem(
    key,
    JSON.stringify({
      ...value,
      expiresAt: value.expiresAt ?? new Date(Date.now() + STORAGE_TTL_MS).toISOString(),
    }),
  );
}

export function forgetStoredDevtoKey(key: string): void {
  window.localStorage.removeItem(key);
}

function isStorageValue(value: unknown): value is StorageValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.apiKey === 'string' &&
    record.apiKey.length > 0 &&
    (record.username === undefined || typeof record.username === 'string') &&
    (record.verifiedAt === undefined || typeof record.verifiedAt === 'string') &&
    (record.expiresAt === undefined || typeof record.expiresAt === 'string')
  );
}

function isExpired(expiresAt: string | undefined): boolean {
  if (!expiresAt) return false;
  const parsed = Date.parse(expiresAt);
  return Number.isFinite(parsed) && parsed <= Date.now();
}
