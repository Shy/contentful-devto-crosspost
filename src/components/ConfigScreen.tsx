import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConfigAppSDK } from '@contentful/app-sdk';
import { useCMA, useSDK } from '@contentful/react-apps-toolkit';
import { DEFAULT_APP_CONFIG, resolveAppConfig } from '../lib/config';
import type { AppConfig, FieldMapping } from '../lib/types';

const REQUIRED_FIELDS: (keyof FieldMapping)[] = ['titleField', 'slugField', 'bodyField', 'publishDateField'];
const OPTIONAL_FIELDS: (keyof FieldMapping)[] = [
  'descriptionField',
  'tagsField',
  'categoryField',
  'coverImagePrimaryField',
  'coverImageFallbackField',
];

export default function ConfigScreen() {
  const sdk = useSDK<ConfigAppSDK>();
  const cma = useCMA();
  const initial = useMemo(() => resolveAppConfig(sdk.parameters.installation), [sdk.parameters.installation]);
  const [config, setConfig] = useState<AppConfig>(initial);
  const [validation, setValidation] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const validationRequestRef = useRef(0);

  useEffect(() => {
    sdk.app.onConfigure(async () => {
      const result = await validateContentType(cma, config);
      setValidation(result.errors);
      setWarnings(result.warnings);
      if (result.errors.length > 0) return false;

      return {
        parameters: config,
        targetState: {
          EditorInterface: {
            [config.contentTypeId]: {
              sidebar: {
                position: 0,
              },
            },
          },
        },
      };
    });
    sdk.app.setReady();
  }, [cma, config, sdk.app]);

  useEffect(() => {
    const requestId = (validationRequestRef.current += 1);
    const timeout = window.setTimeout(() => {
      void validateContentType(cma, config).then((result) => {
        if (validationRequestRef.current !== requestId) return;
        setValidation(result.errors);
        setWarnings(result.warnings);
      });
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [cma, config]);

  function update<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function updateField(key: keyof FieldMapping, value: string) {
    setConfig((current) => ({
      ...current,
      fieldMapping: {
        ...current.fieldMapping,
        [key]: value,
      },
    }));
  }

  return (
    <main className="config-shell">
      <header>
        <h1>DEV Crosspost Configuration</h1>
        <p className="muted">Configure the content type, field mapping, canonical URL, and DEV organization target.</p>
      </header>

      <section className="config-grid">
        <ConfigInput label="Content type ID" value={config.contentTypeId} onChange={(value) => update('contentTypeId', value)} />
        <ConfigInput label="Canonical base URL" value={config.siteBlogBaseUrl} onChange={(value) => update('siteBlogBaseUrl', value)} />
        <ConfigInput label="DEV org username" value={config.devtoOrgUsername} onChange={(value) => update('devtoOrgUsername', value)} />
        <ConfigInput label="DEV org ID" value={config.devtoOrgId} onChange={(value) => update('devtoOrgId', value)} />
        <ConfigInput label="Forced first tag" value={config.forcedFirstTag} onChange={(value) => update('forcedFirstTag', value)} />
        <ConfigInput
          label="Publish delay days"
          value={String(config.publishDelayDays)}
          onChange={(value) => update('publishDelayDays', Number(value) || DEFAULT_APP_CONFIG.publishDelayDays)}
        />
        <ConfigInput label="App Action ID" value={config.appActionId} onChange={(value) => update('appActionId', value)} />
      </section>

      <h2>Field Mapping</h2>
      <section className="config-grid">
        {(Object.keys(config.fieldMapping) as (keyof FieldMapping)[]).map((key) => (
          <ConfigInput key={key} label={labelForField(key)} value={config.fieldMapping[key]} onChange={(value) => updateField(key, value)} />
        ))}
      </section>

      {validation.length > 0 ? (
        <div className="status warning">
          <strong>Required setup issues</strong>
          <ul>
            {validation.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="status success">Required fields look good.</p>
      )}

      {warnings.length > 0 ? (
        <div className="status subtle">
          <strong>Optional warnings</strong>
          <ul>
            {warnings.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </main>
  );
}

function ConfigInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="config-field">
      <span>{label}</span>
      <input className="text-input" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

async function validateContentType(cma: any, config: AppConfig): Promise<{ errors: string[]; warnings: string[] }> {
  const configErrors = validateConfigShape(config);
  if (configErrors.length > 0) {
    return { errors: configErrors, warnings: [] };
  }

  if (!config.contentTypeId.trim()) {
    return { errors: ['Content type ID is required.'], warnings: [] };
  }

  try {
    const contentType = await cma.contentType.get({ contentTypeId: config.contentTypeId });
    const fieldIds = new Set((contentType.fields ?? []).map((field: { id: string }) => field.id));
    const errors = REQUIRED_FIELDS
      .filter((key) => !fieldIds.has(config.fieldMapping[key]))
      .map((key) => `Missing required field "${config.fieldMapping[key]}" for ${labelForField(key)}.`);
    const warnings = OPTIONAL_FIELDS
      .filter((key) => config.fieldMapping[key] && !fieldIds.has(config.fieldMapping[key]))
      .map((key) => `Optional field "${config.fieldMapping[key]}" for ${labelForField(key)} was not found.`);
    return { errors, warnings };
  } catch (error) {
    return {
      errors: [`Could not load content type "${config.contentTypeId}".`],
      warnings: [error instanceof Error ? error.message : 'Unknown CMA validation error.'],
    };
  }
}

function validateConfigShape(config: AppConfig): string[] {
  const errors: string[] = [];
  if (!isHttpsUrl(config.siteBlogBaseUrl)) {
    errors.push('Canonical base URL must be a valid HTTPS URL.');
  }
  if (config.publishDelayDays < 0 || !Number.isFinite(config.publishDelayDays)) {
    errors.push('Publish delay days must be zero or greater.');
  }
  return errors;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function labelForField(key: keyof FieldMapping): string {
  return key
    .replace(/Field$/, '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (char) => char.toUpperCase());
}
