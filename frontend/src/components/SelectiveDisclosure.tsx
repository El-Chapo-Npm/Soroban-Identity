import React, { useCallback, useEffect, useMemo, useState } from 'react';

export type CredentialAttribute = {
  key: string;
  label?: string;
  value?: unknown;
  sensitive?: boolean;
  required?: boolean;
  description?: string;
};

export type SelectiveDisclosureProps = {
  attributes: CredentialAttribute[];
  selectedKeys?: string[];
  defaultSelectedKeys?: string[];
  disabled?: boolean;
  showPreview?: boolean;
  showSelectAll?: boolean;
  className?: string;
  title?: string;
  emptyMessage?: string;
  onChange?: (selectedKeys: string[]) => void;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatValue(item)).join(', ');
  }
  if (isPlainObject(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return '[object]';
    }
  }
  return String(value);
};

const getAttributeLabel = (attribute: CredentialAttribute): string =>
  attribute.label ?? attribute.key;

const SelectiveDisclosure: React.FC<SelectiveDisclosureProps> = ({
  attributes,
  selectedKeys,
  defaultSelectedKeys,
  disabled = false,
  showPreview = true,
  showSelectAll = true,
  className,
  title = 'Selective Disclosure',
  emptyMessage = 'No attributes available to disclose.',
  onChange,
}) => {
  const isControlled = selectedKeys !== undefined;

  const initialSelection = useMemo(() => {
    const source = selectedKeys ?? defaultSelectedKeys ?? [];
    const validKeys = new Set(attributes.map((attribute) => attribute.key));
    return source.filter((key) => validKeys.has(key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [internalSelection, setInternalSelection] = useState<string[]>(initialSelection);

  const currentSelection = useMemo(() => {
    const source = isControlled ? selectedKeys ?? [] : internalSelection;
    const validKeys = new Set(attributes.map((attribute) => attribute.key));
    return source.filter((key) => validKeys.has(key));
  }, [attributes, internalSelection, isControlled, selectedKeys]);

  useEffect(() => {
    if (!isControlled) {
      return;
    }
    const validKeys = new Set(attributes.map((attribute) => attribute.key));
    const sanitized = (selectedKeys ?? []).filter((key) => validKeys.has(key));
    if (sanitized.length !== (selectedKeys ?? []).length) {
      onChange?.(sanitized);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attributes, selectedKeys, isControlled]);

  const selectedSet = useMemo(() => new Set(currentSelection), [currentSelection]);

  const emitChange = useCallback(
    (nextKeys: string[]) => {
      if (!isControlled) {
        setInternalSelection(nextKeys);
      }
      onChange?.(nextKeys);
    },
    [isControlled, onChange],
  );

  const toggleAttribute = useCallback(
    (key: string) => {
      if (disabled) {
        return;
      }
      const next = new Set(selectedSet);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      const ordered = attributes
        .map((attribute) => attribute.key)
        .filter((attributeKey) => next.has(attributeKey));
      emitChange(ordered);
    },
    [attributes, disabled, emitChange, selectedSet],
  );

  const selectAll = useCallback(() => {
    if (disabled) {
      return;
    }
    emitChange(attributes.map((attribute) => attribute.key));
  }, [attributes, disabled, emitChange]);

  const clearAll = useCallback(() => {
    if (disabled) {
      return;
    }
    emitChange([]);
  }, [disabled, emitChange]);

  const allSelected =
    attributes.length > 0 && attributes.every((attribute) => selectedSet.has(attribute.key));
  const noneSelected = attributes.every((attribute) => !selectedSet.has(attribute.key));

  const previewAttributes = useMemo(
    () => attributes.filter((attribute) => selectedSet.has(attribute.key)),
    [attributes, selectedSet],
  );

  const containerClassName = ['selective-disclosure', className].filter(Boolean).join(' ');

  return (
    <div className={containerClassName} data-testid="selective-disclosure">
      <div className="selective-disclosure__header">
        <h3 className="selective-disclosure__title">{title}</h3>
        {showSelectAll && attributes.length > 0 && (
          <div className="selective-disclosure__actions">
            <button
              type="button"
              className="selective-disclosure__action"
              onClick={selectAll}
              disabled={disabled || allSelected}
            >
              Select all
            </button>
            <button
              type="button"
              className="selective-disclosure__action"
              onClick={clearAll}
              disabled={disabled || noneSelected}
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {attributes.length === 0 ? (
        <p className="selective-disclosure__empty">{emptyMessage}</p>
      ) : (
        <ul className="selective-disclosure__list" role="group" aria-label={title}>
          {attributes.map((attribute) => {
            const checked = selectedSet.has(attribute.key);
            const inputId = `selective-disclosure-${attribute.key}`;
            return (
              <li key={attribute.key} className="selective-disclosure__item">
                <label className="selective-disclosure__label" htmlFor={inputId}>
                  <input
                    id={inputId}
                    type="checkbox"
                    className="selective-disclosure__checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleAttribute(attribute.key)}
                    aria-describedby={
                      attribute.description ? `${inputId}-description` : undefined
                    }
                  />
                  <span className="selective-disclosure__label-text">
                    {getAttributeLabel(attribute)}
                    {attribute.sensitive && (
                      <span
                        className="selective-disclosure__badge selective-disclosure__badge--sensitive"
                        title="Sensitive attribute"
                      >
                        Sensitive
                      </span>
                    )}
                    {attribute.required && (
                      <span
                        className="selective-disclosure__badge selective-disclosure__badge--required"
                        title="Required attribute"
                      >
                        Required
                      </span>
                    )}
                  </span>
                </label>
                {attribute.description && (
                  <p
                    id={`${inputId}-description`}
                    className="selective-disclosure__description"
                  >
                    {attribute.description}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {showPreview && attributes.length > 0 && (
        <div className="selective-disclosure__preview" data-testid="selective-disclosure-preview">
          <h4 className="selective-disclosure__preview-title">
            Disclosure preview ({previewAttributes.length} of {attributes.length})
          </h4>
          {previewAttributes.length === 0 ? (
            <p className="selective-disclosure__preview-empty">
              No attributes selected. Nothing will be shared.
            </p>
          ) : (
            <dl className="selective-disclosure__preview-list">
              {previewAttributes.map((attribute) => (
                <div key={attribute.key} className="selective-disclosure__preview-item">
                  <dt className="selective-disclosure__preview-key">
                    {getAttributeLabel(attribute)}
                  </dt>
                  <dd className="selective-disclosure__preview-value">
                    {formatValue(attribute.value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
};

export default SelectiveDisclosure;