import type { AppConfig, DevtoActionRequest, DevtoActionResponse } from './types';
import { credentialFingerprint, errorToDebug, logDebug, messageFromUnknown } from './debug';

type AnySdk = any;

export class DevtoActionClientError extends Error {
  details: unknown;

  constructor(message: string, details: unknown) {
    super(message);
    this.name = 'DevtoActionClientError';
    this.details = details;
  }
}

export async function invokeDevtoAction(
  sdk: AnySdk,
  config: AppConfig,
  request: DevtoActionRequest,
): Promise<DevtoActionResponse> {
  const cma = sdk.cma;
  const appDefinitionId = sdk.ids?.appDefinition ?? sdk.ids?.app;
  if (!cma?.appActionCall || !appDefinitionId) {
    throw new Error('Contentful App Action calls are not available in this app context.');
  }

  const params = {
    spaceId: sdk.ids.space,
    environmentId: sdk.ids.environment,
    appDefinitionId,
    appActionId: config.appActionId,
  };
  const payload = {
    parameters: buildActionParameters(request),
  };

  logDebug('Calling Contentful App Action', {
    params,
    credential: credentialFingerprint(request.devtoApiKey),
    payload,
  });

  let call: unknown;
  try {
    call = cma.appActionCall.createWithResult
      ? await cma.appActionCall.createWithResult(params, payload)
      : await cma.appActionCall.create(params, payload);
  } catch (error) {
    const details = errorToDebug(error);
    logDebug('Contentful App Action exception', details, 'error');
    throw new DevtoActionClientError(messageFromUnknown(error, 'Contentful App Action call failed.'), details);
  }

  const response = extractActionResponse(call, request.mode);
  logDebug('Contentful App Action result', {
    response,
    raw: call,
  }, response.ok ? 'debug' : 'error');

  return response;
}

function buildActionParameters(request: DevtoActionRequest): Record<string, string> {
  return {
    mode: request.mode,
    devtoApiKey: request.devtoApiKey,
    ...(request.mode === 'createDraft' || request.mode === 'lookupDraft'
      ? {
          entryId: request.entryId,
          locale: request.locale ?? '',
        }
      : {}),
  };
}

function extractActionResponse(value: unknown, mode: DevtoActionRequest['mode']): DevtoActionResponse {
  const candidate = value as any;

  if (candidate?.status === 'failed' || candidate?.sys?.status === 'failed') {
    return {
      ok: false,
      mode,
      status: 'error',
      message: messageFromUnknown(
        candidate.error ?? candidate.sys?.error ?? value,
        'The Contentful App Action failed.',
      ),
      raw: candidate.error ?? candidate.sys?.error ?? value,
    };
  }

  const response =
    candidate?.sys?.result ??
    candidate?.result ??
    candidate?.response ??
    candidate?.body ??
    candidate?.data ??
    candidate;

  if (response && typeof response === 'object' && 'ok' in response) {
    return response as DevtoActionResponse;
  }

  return {
    ok: false,
    mode,
    status: 'error',
    message: 'The Contentful App Action returned an unexpected response shape.',
    raw: value,
  };
}
