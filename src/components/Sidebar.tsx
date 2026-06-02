import { useEffect, useMemo, useRef, useState } from 'react';
import type { SidebarAppSDK } from '@contentful/app-sdk';
import { useSDK } from '@contentful/react-apps-toolkit';
import { resolveAppConfig } from '../lib/config';
import { getCurrentContentTypeId, getPublishState } from '../lib/contentfulEntry';
import { forgetStoredDevtoKey, readStoredDevtoKey, storageKey, writeStoredDevtoKey } from '../lib/localDevtoKey';
import { invokeDevtoAction } from '../lib/devtoActionClient';
import { credentialFingerprint, errorToDebug, logDebug, stringifyDebug } from '../lib/debug';
import type { DevtoActionResponse } from '../lib/types';

type DraftLink = {
  url: string;
  actionLabel: string;
};

export default function Sidebar() {
  const sdk = useSDK<SidebarAppSDK>();
  const config = useMemo(() => resolveAppConfig(sdk.parameters.installation), [sdk.parameters.installation]);
  const keyScope = storageKey({
    space: sdk.ids.space,
    environment: sdk.ids.environment,
    app: (sdk.ids as any).appDefinition ?? sdk.ids.app,
  });
  const stored = useMemo(() => readStoredDevtoKey(keyScope), [keyScope]);

  const [apiKey, setApiKey] = useState(stored?.apiKey ?? '');
  const [rememberKey, setRememberKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<DevtoActionResponse | undefined>(
    stored?.username
      ? {
          ok: true,
          mode: 'verify',
          status: 'verified',
          user: { username: stored.username },
          org: { username: config.devtoOrgUsername, verified: false },
        }
      : undefined,
  );
  const [message, setMessage] = useState<string | undefined>();
  const [debugDetails, setDebugDetails] = useState<unknown>();
  const [draftLink, setDraftLink] = useState<DraftLink | undefined>();
  const [lookupBusy, setLookupBusy] = useState(false);
  const [verifiedFingerprint, setVerifiedFingerprint] = useState<string | undefined>(
    stored?.apiKey ? credentialFingerprint(stored.apiKey).fingerprint : undefined,
  );
  const lastLookupKeyRef = useRef<string | undefined>(undefined);
  const lookupInFlightRef = useRef(false);

  useEffect(() => {
    sdk.window.startAutoResizer();
  }, [sdk.window]);

  const contentTypeId = getCurrentContentTypeId(sdk);
  const publishState = getPublishState(sdk);
  const wrongContentType = contentTypeId !== config.contentTypeId;
  const currentFingerprint = apiKey.trim() ? String(credentialFingerprint(apiKey.trim()).fingerprint) : undefined;
  const isConnected = Boolean(apiKey.trim()) && Boolean(response?.ok) && currentFingerprint === verifiedFingerprint;

  const waitingState =
    wrongContentType
      ? 'Not available for this content type'
      : !publishState.isPublished
        ? 'Waiting for publish'
        : publishState.hasUnpublishedChanges
          ? 'Waiting for latest publish'
          : undefined;

  useEffect(() => {
    if (
      !isConnected ||
      !apiKey.trim() ||
      busy ||
      lookupInFlightRef.current ||
      draftLink ||
      wrongContentType ||
      !publishState.isPublished ||
      publishState.hasUnpublishedChanges
    ) {
      return;
    }

    const entrySys = sdk.entry.getSys();
    const lookupKey = [
      entrySys.id,
      entrySys.version,
      entrySys.publishedVersion,
      response?.user?.username,
      currentFingerprint,
    ].join(':');
    if (lastLookupKeyRef.current === lookupKey) return;
    lastLookupKeyRef.current = lookupKey;

    let cancelled = false;

    async function lookupExistingDraft() {
      lookupInFlightRef.current = true;
      setLookupBusy(true);
      setMessage(undefined);
      setDebugDetails(undefined);
      try {
        const result = await invokeDevtoAction(sdk, config, {
          mode: 'lookupDraft',
          devtoApiKey: apiKey.trim(),
          entryId: entrySys.id,
          locale: sdk.locales?.default,
        });

        if (cancelled) return;

        recordDebug('Lookup draft response', result, result.ok ? 'debug' : 'error');
        setResponse(result);

        if (!result.ok) {
          setMessage(result.message ?? 'DEV draft lookup failed.');
          return;
        }

        const nextDraftLink = draftLinkFromResponse(result);
        if (nextDraftLink) {
          setDraftLink(nextDraftLink);
        }
      } catch (error) {
        if (!cancelled) {
          recordDebug('Lookup draft exception', errorToDebug(error), 'error');
          setMessage(error instanceof Error ? error.message : 'Could not check DEV for an existing draft.');
        }
      } finally {
        lookupInFlightRef.current = false;
        if (!cancelled) setLookupBusy(false);
      }
    }

    lookupExistingDraft();
    return () => {
      cancelled = true;
    };
  }, [
    apiKey,
    busy,
    config,
    draftLink,
    isConnected,
    publishState.hasUnpublishedChanges,
    publishState.isPublished,
    response?.user?.username,
    sdk,
    currentFingerprint,
    wrongContentType,
  ]);

  async function verifyKey() {
    setBusy(true);
    setMessage(undefined);
    setDebugDetails(undefined);
    setDraftLink(undefined);
    try {
      const result = await invokeDevtoAction(sdk, config, {
        mode: 'verify',
        devtoApiKey: apiKey.trim(),
      });
      recordDebug('Verify response', result, result.ok ? 'debug' : 'error');
      setResponse(result);
      if (!result.ok) {
        setVerifiedFingerprint(undefined);
        setMessage(result.message ?? 'DEV verification failed.');
        return;
      }
      setVerifiedFingerprint(currentFingerprint);
      if (rememberKey && result.user?.username) {
        writeStoredDevtoKey(keyScope, {
          apiKey: apiKey.trim(),
          username: result.user.username,
          verifiedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      recordDebug('Verify exception', errorToDebug(error), 'error');
      setResponse(undefined);
      setVerifiedFingerprint(undefined);
      setMessage(error instanceof Error ? error.message : 'DEV verification failed.');
    } finally {
      setBusy(false);
    }
  }

  async function createDraft() {
    setBusy(true);
    setMessage(undefined);
    setDebugDetails(undefined);
    try {
      const entrySys = sdk.entry.getSys();
      recordDebug('Create draft request', {
        entryId: entrySys.id,
        version: entrySys.version,
        publishedVersion: entrySys.publishedVersion,
      });
      const result = await invokeDevtoAction(sdk, config, {
        mode: 'createDraft',
        devtoApiKey: apiKey.trim(),
        entryId: entrySys.id,
        locale: sdk.locales?.default,
      });
      recordDebug('Create draft response', result, result.ok ? 'debug' : 'error');
      setResponse(result);

      if (!result.ok) {
        setMessage(result.message ?? 'DEV draft creation failed.');
        return;
      }

      const nextDraftLink = draftLinkFromResponse(result);
      setDraftLink(nextDraftLink);
      if (nextDraftLink?.url) {
        openExternal(nextDraftLink.url);
      } else {
        setMessage('DEV created the draft but did not return a safe edit link.');
      }
    } catch (error) {
      recordDebug('Create draft exception', errorToDebug(error), 'error');
      setMessage(error instanceof Error ? error.message : 'DEV draft creation failed.');
    } finally {
      setBusy(false);
    }
  }

  function forgetKey() {
    forgetStoredDevtoKey(keyScope);
    setApiKey('');
    setResponse(undefined);
    setVerifiedFingerprint(undefined);
    setDebugDetails(undefined);
    setDraftLink(undefined);
    setMessage(undefined);
  }

  function handleApiKeyChange(value: string) {
    setApiKey(value);
    setResponse(undefined);
    setVerifiedFingerprint(undefined);
    setDebugDetails(undefined);
    setDraftLink(undefined);
    setMessage(undefined);
  }

  function draftLinkFromResponse(result: DevtoActionResponse): DraftLink | undefined {
    const url = safeDevtoUrl(result.editUrl ?? result.article?.url);
    if (!url) return undefined;

    if (result.status === 'created') {
      return {
        url,
        actionLabel: 'Finalize on DEV',
      };
    }

    const published = Boolean(result.article?.published);
    return {
      url,
      actionLabel: published ? 'Open on DEV' : 'Finalize on DEV',
    };
  }

  function recordDebug(label: string, value: unknown, level: 'debug' | 'error' = 'debug') {
    const details = {
      label,
      at: new Date().toISOString(),
      value,
    };
    logDebug(label, details, level);
    if (level === 'error') {
      setDebugDetails(details);
    }
  }

  function openExternal(url: string) {
    const safeUrl = safeDevtoUrl(url);
    if (!safeUrl) {
      setMessage('DEV returned a link this app will not open.');
      return;
    }
    const navigator = (sdk as any).navigator;
    if (navigator?.openExternal) {
      navigator.openExternal(safeUrl);
      return;
    }
    window.open(safeUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <main className="sidebar-shell">
      {waitingState ? (
        <section className="state-panel">
          <strong>{waitingState}</strong>
        </section>
      ) : draftLink ? (
        <section className="draft-link-panel">
          <button className="ghost-button" onClick={() => openExternal(draftLink.url)} type="button">
            {draftLink.actionLabel}
          </button>
        </section>
      ) : lookupBusy && isConnected ? (
        <section className="lookup-panel" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span>Checking DEV...</span>
        </section>
      ) : isConnected ? (
        <section className="state-panel">
          <button className="primary-button" disabled={busy || lookupBusy} onClick={createDraft}>
            {busy ? (
              <>
                <span className="spinner spinner-on-primary" aria-hidden="true" />
                Creating draft
              </>
            ) : (
              'Create DEV draft'
            )}
          </button>
        </section>
      ) : null}

      {isConnected ? (
        <div className="account-row">
          <span>{response?.user?.username ? `Connected as @${response.user.username}` : 'DEV connected'}</span>
          <button
            type="button"
            className="account-link"
            onClick={forgetKey}
            title="Disconnect DEV account"
            aria-label="Disconnect DEV account"
          >
            Disconnect
          </button>
        </div>
      ) : null}

      {!waitingState && !isConnected ? (
        <section className="stack">
          <strong className="state-title">Connect DEV account</strong>
          <input
            id="devto-key"
            className="text-input"
            type="password"
            value={apiKey}
            onChange={(event) => handleApiKeyChange(event.target.value)}
            placeholder="DEV API key"
          />
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={rememberKey}
              onChange={(event) => setRememberKey(event.target.checked)}
            />
            Remember this browser
          </label>
          <a className="text-link" href="https://dev.to/settings/extensions" target="_blank" rel="noreferrer">
            Get a DEV API key
          </a>
          <button className="primary-button" disabled={!apiKey.trim() || busy || wrongContentType} onClick={verifyKey}>
            {busy ? (
              <>
                <span className="spinner spinner-on-primary" aria-hidden="true" />
                Checking
              </>
            ) : (
              'Connect DEV'
            )}
          </button>
        </section>
      ) : null}

      {message ? <ErrorPanel message={message} details={debugDetails} /> : null}
    </main>
  );
}

function safeDevtoUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'dev.to') return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function ErrorPanel({ message, details }: { message: string; details: unknown }) {
  return (
    <section className="error-panel">
      <strong>Something went wrong</strong>
      <p>{message}</p>
      {details ? (
        <details className="error-details">
          <summary>Details to send Shy</summary>
          <pre>{stringifyDebug(details)}</pre>
        </details>
      ) : null}
    </section>
  );
}
