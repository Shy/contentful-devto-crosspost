const SECRET_KEY_PATTERN = /api[-_]?key|token|authorization|secret|password/i;
const LONG_TEXT_LIMIT = 1200;

export function sanitizeForDebug(value: unknown): unknown {
  return sanitizeValue(value, new WeakSet<object>());
}

export function stringifyDebug(value: unknown): string {
  try {
    return JSON.stringify(sanitizeForDebug(value), null, 2);
  } catch {
    return String(value);
  }
}

export function logDebug(label: string, value: unknown, level: 'debug' | 'error' = 'debug'): void {
  const safe = sanitizeForDebug(value);
  const logger = level === 'error' ? console.error : console.debug;
  logger(`[DEV Crosspost] ${label}`, safe);
}

export function errorToDebug(error: unknown): Record<string, unknown> {
  const message = messageFromUnknown(error, 'Non-Error exception thrown.');

  if (error instanceof Error) {
    const out: Record<string, unknown> = {
      name: error.name,
      message,
      stack: error.stack,
    };

    const extra = sanitizeForDebug(errorExtras(error));
    if (isNonEmptyObject(extra)) out.details = extra;
    if ('cause' in error) out.cause = sanitizeForDebug(error.cause);

    return out;
  }

  if (typeof error === 'object' && error !== null) {
    return {
      message,
      value: sanitizeForDebug(error),
    };
  }

  return { message };
}

export function messageFromUnknown(error: unknown, fallback = 'Unknown error.'): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();

  const record = recordValue(error);
  if (!record) return fallback;

  const directMessage = stringValue(record.message);
  const nestedError = recordValue(record.error);
  const nestedData = recordValue(record.data) ?? recordValue(record.response);
  const nestedMessage =
    stringValue(nestedError?.message) ??
    stringValue(recordValue(nestedError?.error)?.message) ??
    stringValue(nestedData?.message) ??
    stringValue(recordValue(nestedData?.error)?.message);
  const message = directMessage ?? nestedMessage;
  const validationDetails = validationMessage(record.details ?? nestedError?.details ?? nestedData?.details);

  if (message && validationDetails) return `${message}: ${validationDetails}`;
  if (message) return message;
  if (validationDetails) return validationDetails;

  const errorId = stringValue(recordValue(record.sys)?.id) ?? stringValue(record.id);
  const status = numberOrString(record.statusCode) ?? numberOrString(record.status);
  if (errorId && status) return `${errorId} (${status})`;
  if (errorId) return errorId;
  if (status) return `Request failed with status ${status}`;

  return fallback;
}

export function credentialFingerprint(value: string): { length: number; fingerprint: string } {
  return {
    length: value.length,
    fingerprint: hashString(value),
  };
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sanitizeValue(value: unknown, seen: WeakSet<object>, key = ''): unknown {
  if (SECRET_KEY_PATTERN.test(key)) return '[redacted]';

  if (typeof value === 'string') {
    if (value.length > LONG_TEXT_LIMIT) return `${value.slice(0, LONG_TEXT_LIMIT)}... [truncated]`;
    return value;
  }

  if (typeof value !== 'object' || value === null) return value;

  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    out[childKey] = sanitizeValue(childValue, seen, childKey);
  }
  return out;
}

function errorExtras(error: Error): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(error)) {
    if (key === 'name' || key === 'message' || key === 'stack') continue;
    out[key] = value;
  }
  return out;
}

function validationMessage(value: unknown): string | undefined {
  const details = recordValue(value);
  const errors = Array.isArray(details?.errors) ? details.errors : undefined;
  if (!errors?.length) return undefined;

  return errors
    .map((error) => {
      const item = recordValue(error);
      if (!item) return undefined;

      const path = Array.isArray(item.path) ? item.path.map(String).join('.') : undefined;
      const details = stringValue(item.details) ?? stringValue(item.message) ?? stringValue(item.name);
      if (path && details) return `${path}: ${details}`;
      return path ?? details;
    })
    .filter(Boolean)
    .join('; ');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberOrString(value: unknown): string | undefined {
  if (typeof value === 'number') return String(value);
  return stringValue(value);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length);
}
