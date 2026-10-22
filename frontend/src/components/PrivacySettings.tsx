import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  loadPrivacySettings,
  savePrivacySettings,
  type PrivacySettings as PrivacySettingsModel,
  type VisibilityOption,
  type AttributePrivacy,
  type TrustedVerifier,
  type PrivacyPolicyTemplate,
} from '../services/offlineStorage';
import {
  logPrivacyEvent,
  getPrivacyAuditLog,
  type PrivacyAuditEntry,
} from '../services/privacyAudit';

const VISIBILITY_OPTIONS: { value: VisibilityOption; label: string; description: string }[] = [
  {
    value: 'public',
    label: 'Public',
    description: 'Anyone with your credential identifier can view all disclosed attributes.',
  },
  {
    value: 'private',
    label: 'Private',
    description: 'Only you can view this credential. Nothing is shared.',
  },
  {
    value: 'custom',
    label: 'Custom',
    description: 'Choose exactly which attributes are shared and with whom.',
  },
];

const POLICY_TEMPLATES: { value: PrivacyPolicyTemplate; label: string; description: string }[] = [
  {
    value: 'strict',
    label: 'Strict',
    description: 'Share nothing by default. Every attribute must be explicitly disclosed.',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'Share non-sensitive attributes; keep personal identifiers private.',
  },
  {
    value: 'open',
    label: 'Open',
    description: 'Share all attributes with trusted verifiers by default.',
  },
];

const DEFAULT_ATTRIBUTES: string[] = [
  'name',
  'dateOfBirth',
  'email',
  'address',
  'nationality',
  'credentialId',
];

const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

interface AttributeRow {
  key: string;
  label: string;
}

function formatAttributeLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function createDefaultSettings(): PrivacySettingsModel {
  return {
    visibility: 'private',
    policyTemplate: 'balanced',
    attributes: DEFAULT_ATTRIBUTES.map((key) => ({
      key,
      disclosed: false,
      sensitive: key === 'email' || key === 'address' || key === 'dateOfBirth',
    })),
    trustedVerifiers: [],
    sharingLinks: [],
  };
}

export interface PrivacySettingsProps {
  credentialId?: string;
  attributeKeys?: string[];
  onSaved?: (settings: PrivacySettingsModel) => void;
}

const PrivacySettings: React.FC<PrivacySettingsProps> = ({
  credentialId,
  attributeKeys,
  onSaved,
}) => {
  const [settings, setSettings] = useState<PrivacySettingsModel>(createDefaultSettings);
  const [auditLog, setAuditLog] = useState<PrivacyAuditEntry[]>([]);
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [verifierInput, setVerifierInput] = useState<string>('');
  const [verifierLabel, setVerifierLabel] = useState<string>('');
  const [verifierError, setVerifierError] = useState<string>('');

  const attributeRows: AttributeRow[] = useMemo(() => {
    const keys = attributeKeys && attributeKeys.length > 0 ? attributeKeys : DEFAULT_ATTRIBUTES;
    return keys.map((key) => ({ key, label: formatAttributeLabel(key) }));
  }, [attributeKeys]);

  const refreshAuditLog = useCallback(async () => {
    try {
      const entries = await getPrivacyAuditLog(credentialId);
      setAuditLog(entries);
    } catch (err) {
      setError('Unable to load privacy audit log.');
    }
  }, [credentialId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const stored = await loadPrivacySettings(credentialId);
        if (cancelled) return;
        if (stored) {
          const mergedAttributes = attributeRows.map((row) => {
            const existing = stored.attributes?.find((a) => a.key === row.key);
            return (
              existing ?? {
                key: row.key,
                disclosed: false,
                sensitive: row.key === 'email' || row.key === 'address' || row.key === 'dateOfBirth',
              }
            );
          });
          setSettings({
            ...createDefaultSettings(),
            ...stored,
            attributes: mergedAttributes,
            trustedVerifiers: stored.trustedVerifiers ?? [],
            sharingLinks: stored.sharingLinks ?? [],
          });
        } else {
          setSettings((prev) => ({
            ...prev,
            attributes: attributeRows.map((row) => {
              const existing = prev.attributes.find((a) => a.key === row.key);
              return (
                existing ?? {
                  key: row.key,
                  disclosed: false,
                  sensitive:
                    row.key === 'email' || row.key === 'address' || row.key === 'dateOfBirth',
                }
              );
            }),
          }));
        }
        await refreshAuditLog();
      } catch (err) {
        if (!cancelled) setError('Unable to load privacy settings.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentialId]);

  const persist = useCallback(
    async (next: PrivacySettingsModel, eventType: string, detail: string) => {
      setSettings(next);
      try {
        await savePrivacySettings(credentialId, next);
        await logPrivacyEvent({
          credentialId,
          type: eventType,
          detail,
          timestamp: new Date().toISOString(),
        });
        await refreshAuditLog();
        setStatus('Privacy settings saved.');
        setError('');
        onSaved?.(next);
      } catch (err) {
        setError('Failed to save privacy settings.');
        setStatus('');
      }
    },
    [credentialId, onSaved, refreshAuditLog],
  );

  const handleVisibilityChange = (value: VisibilityOption) => {
    const next: PrivacySettingsModel = { ...settings, visibility: value };
    void persist(next, 'visibility-changed', `Visibility set to ${value}.`);
  };

  const handlePolicyChange = (value: PrivacyPolicyTemplate) => {
    const next: PrivacySettingsModel = { ...settings, policyTemplate: value };
    void persist(next, 'policy-changed', `Privacy policy template set to ${value}.`);
  };

  const handleAttributeToggle = (key: string, disclosed: boolean) => {
    const attributes: AttributePrivacy[] = settings.attributes.map((attr) =>
      attr.key === key ? { ...attr, disclosed } : attr,
    );
    const next: PrivacySettingsModel = { ...settings, attributes };
    void persist(
      next,
      'attribute-toggled',
      `Attribute "${key}" ${disclosed ? 'disclosed' : 'hidden'}.`,
    );
  };

  const handleAddVerifier = () => {
    const address = verifierInput.trim();
    if (!STELLAR_ADDRESS_REGEX.test(address)) {
      setVerifierError('Enter a valid Stellar address (starts with G, 56 characters).');
      return;
    }
    if (settings.trustedVerifiers.some((v) => v.address === address)) {
      setVerifierError('This verifier is already trusted.');
      return;
    }
    const verifier: TrustedVerifier = {
      address,
      label: verifierLabel.trim() || undefined,
      addedAt: new Date().toISOString(),
    };
    const next: PrivacySettingsModel = {
      ...settings,
      trustedVerifiers: [...settings.trustedVerifiers, verifier],
    };
    setVerifierInput('');
    setVerifierLabel('');
    setVerifierError('');
    void persist(next, 'verifier-added', `Trusted verifier added: ${address}.`);
  };

  const handleRemoveVerifier = (address: string) => {
    const next: PrivacySettingsModel = {
      ...settings,
      trustedVerifiers: settings.trustedVerifiers.filter((v) => v.address !== address),
    };
    void persist(next, 'verifier-removed', `Trusted verifier removed: ${address}.`);
  };

  const disclosedCount = settings.attributes.filter((a) => a.disclosed).length;

  return (
    <section className="privacy-settings" aria-labelledby="privacy-settings-heading">
      <h2 id="privacy-settings-heading">Credential Privacy Settings</h2>

      <div role="status" aria-live="polite" className="privacy-settings__status">
        {loading ? 'Loading privacy settings…' : status}
        {error ? (
          <span role="alert" className="privacy-settings__error">
            {error}
          </span>
        ) : null}
      </div>

      <fieldset className="privacy-settings__visibility">
        <legend>Visibility</legend>
        {VISIBILITY_OPTIONS.map((option) => (
          <div key={option.value} className="privacy-settings__option">
            <input
              type="radio"
              id={`visibility-${option.value}`}
              name="visibility"
              value={option.value}
              checked={settings.visibility === option.value}
              onChange={() => handleVisibilityChange(option.value)}
              disabled={loading}
            />
            <label htmlFor={`visibility-${option.value}`}>
              <strong>{option.label}</strong>
              <span className="privacy-settings__hint">{option.description}</span>
            </label>
          </div>
        ))}
      </fieldset>

      <fieldset className="privacy-settings__policy">
        <legend>Privacy Policy Template</legend>
        {POLICY_TEMPLATES.map((template) => (
          <div key={template.value} className="privacy-settings__option">
            <input
              type="radio"
              id={`policy-${template.value}`}
              name="policyTemplate"
              value={template.value}
              checked={settings.policyTemplate === template.value}
              onChange={() => handlePolicyChange(template.value)}
              disabled={loading}
            />
            <label htmlFor={`policy-${template.value}`}>
              <strong>{template.label}</strong>
              <span className="privacy-settings__hint">{template.description}</span>
            </label>
          </div>
        ))}
      </fieldset>

      <fieldset className="privacy-settings__attributes">
        <legend>Selective Disclosure ({disclosedCount} of {settings.attributes.length} shared)</legend>
        <p className="privacy-settings__hint">
          Choose which attributes are disclosed when this credential is shared.
        </p>
        <ul>
          {attributeRows.map((row) => {
            const attr = settings.attributes.find((a) => a.key === row.key);
            const disclosed = attr?.disclosed ?? false;
            return (
              <li key={row.key} className="privacy-settings__attribute">
                <input
                  type="checkbox"
                  id={`attribute-${row.key}`}
                  checked={disclosed}
                  onChange={(e) => handleAttributeToggle(row.key, e.target.checked)}
                  disabled={loading || settings.visibility === 'private'}
                />
                <label htmlFor={`attribute-${row.key}`}>
                  {row.label}
                  {attr?.sensitive ? (
                    <span className="privacy-settings__badge" aria-label="sensitive attribute">
                      {' '}
                      (sensitive)
                    </span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
        {settings.visibility === 'private' ? (
          <p className="privacy-settings__hint">
            Attribute disclosure is disabled while visibility is set to Private.
          </p>
        ) : null}
      </fieldset>

      <fieldset className="privacy-settings__verifiers">
        <legend>Trusted Verifiers</legend>
        <p className="privacy-settings__hint">
          Only these Stellar addresses can request your disclosed attributes.
        </p>
        {settings.trustedVerifiers.length === 0 ? (
          <p className="privacy-settings__hint">No trusted verifiers added yet.</p>
        ) : (
          <ul>
            {settings.trustedVerifiers.map((verifier) => (
              <li key={verifier.address} className="privacy-settings__verifier">
                <span className="privacy-settings__verifier-address">
                  {verifier.label ? `${verifier.label} — ` : ''}
                  {verifier.address}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveVerifier(verifier.address)}
                  aria-label={`Remove trusted verifier ${verifier.label || verifier.address}`}
                  disabled={loading}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="privacy-settings__verifier-form">
          <div>
            <label htmlFor="verifier-address">Stellar address</label>
            <input
              id="verifier-address"
              type="text"
              value={verifierInput}
              onChange={(e) => {
                setVerifierInput(e.target.value);
                setVerifierError('');
              }}
              placeholder="G…"
              aria-invalid={verifierError ? true : undefined}
              aria-describedby={verifierError ? 'verifier-error' : undefined}
              disabled={loading}
            />
          </div>
          <div>
            <label htmlFor="verifier-label">Label (optional)</label>
            <input
              id="verifier-label"
              type="text"
              value={verifierLabel}
              onChange={(e) => setVerifierLabel(e.target.value)}
              placeholder="e.g. Acme Employer"
              disabled={loading}
            />
          </div>
          <button type="button" onClick={handleAddVerifier} disabled={loading}>
            Add verifier
          </button>
          {verifierError ? (
            <p id="verifier-error" role="alert" className="privacy-settings__error">
              {verifierError}
            </p>
          ) : null}
        </div>
      </fieldset>

      <section className="privacy-settings__audit" aria-labelledby="privacy-audit-heading">
        <h3 id="privacy-audit-heading">Privacy Audit Log</h3>
        {auditLog.length === 0 ? (
          <p className="privacy-settings__hint">No privacy events recorded yet.</p>
        ) : (
          <ol className="privacy-settings__audit-list">
            {auditLog.map((entry) => (
              <li key={entry.id ?? `${entry.timestamp}-${entry.type}`}>
                <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString()}</time>
                {' — '}
                <span>{entry.detail}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
};

export default PrivacySettings;