import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import {
  Theme,
  ThemeColors,
  PrebuiltTheme,
  PREBUILT_THEMES,
  DEFAULT_THEME,
  validateContrast,
  generateCssVariables,
  exportTheme,
  importTheme,
} from '../utils/themingEngine';

type ColorKey = keyof ThemeColors;

interface ColorField {
  key: ColorKey;
  label: string;
}

const COLOR_FIELDS: ColorField[] = [
  { key: 'primary', label: 'Primary' },
  { key: 'accent', label: 'Accent' },
  { key: 'background', label: 'Background' },
  { key: 'text', label: 'Text' },
  { key: 'success', label: 'Success' },
  { key: 'warning', label: 'Warning' },
  { key: 'error', label: 'Error' },
];

const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const ThemeEditor: React.FC = () => {
  const {
    theme,
    setTheme,
    resetTheme,
    saveTheme,
    isPreviewing,
    startPreview,
    stopPreview,
  } = useTheme();

  const [draft, setDraft] = useState<Theme>(theme);
  const [hexInputs, setHexInputs] = useState<Record<ColorKey, string>>(() => {
    const initial = {} as Record<ColorKey, string>;
    COLOR_FIELDS.forEach(({ key }) => {
      initial[key] = theme.colors[key];
    });
    return initial;
  });
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [importError, setImportError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Keep the draft in sync with the active theme when it changes externally.
  useEffect(() => {
    setDraft(theme);
    const next = {} as Record<ColorKey, string>;
    COLOR_FIELDS.forEach(({ key }) => {
      next[key] = theme.colors[key];
    });
    setHexInputs(next);
  }, [theme]);

  const contrastIssues = useMemo(() => validateContrast(draft.colors), [draft.colors]);

  const cssVariables = useMemo(() => generateCssVariables(draft), [draft]);

  const updateColor = useCallback((key: ColorKey, value: string) => {
    setDraft((prev) => ({
      ...prev,
      colors: { ...prev.colors, [key]: value },
    }));
  }, []);

  const handleColorPickerChange = useCallback(
    (key: ColorKey, value: string) => {
      updateColor(key, value);
      setHexInputs((prev) => ({ ...prev, [key]: value }));
    },
    [updateColor],
  );

  const handleHexInputChange = useCallback(
    (key: ColorKey, value: string) => {
      setHexInputs((prev) => ({ ...prev, [key]: value }));
      if (HEX_PATTERN.test(value)) {
        updateColor(key, value);
      }
    },
    [updateColor],
  );

  const handleHexInputBlur = useCallback(
    (key: ColorKey) => {
      const value = hexInputs[key];
      if (!HEX_PATTERN.test(value)) {
        // Revert to the last valid value.
        setHexInputs((prev) => ({ ...prev, [key]: draft.colors[key] }));
      }
    },
    [hexInputs, draft.colors],
  );

  const handleLogoUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      setStatusMessage('Please select an image file for the logo.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      setDraft((prev) => ({ ...prev, logoUrl: dataUrl }));
      setStatusMessage('Logo uploaded.');
    };
    reader.onerror = () => {
      setStatusMessage('Failed to read the logo file.');
    };
    reader.readAsDataURL(file);
  }, []);

  const handleRemoveLogo = useCallback(() => {
    setDraft((prev) => ({ ...prev, logoUrl: undefined }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleApplyGalleryTheme = useCallback((prebuilt: PrebuiltTheme) => {
    setDraft(prebuilt.theme);
    const next = {} as Record<ColorKey, string>;
    COLOR_FIELDS.forEach(({ key }) => {
      next[key] = prebuilt.theme.colors[key];
    });
    setHexInputs(next);
    setStatusMessage(`Applied "${prebuilt.name}" theme.`);
  }, []);

  const handlePreviewToggle = useCallback(() => {
    if (isPreviewing) {
      stopPreview();
    } else {
      startPreview(draft);
    }
  }, [isPreviewing, startPreview, stopPreview, draft]);

  const handleSave = useCallback(() => {
    setTheme(draft);
    saveTheme(draft);
    if (isPreviewing) {
      stopPreview();
    }
    setStatusMessage('Theme saved.');
  }, [draft, setTheme, saveTheme, isPreviewing, stopPreview]);

  const handleReset = useCallback(() => {
    resetTheme();
    setDraft(DEFAULT_THEME);
    const next = {} as Record<ColorKey, string>;
    COLOR_FIELDS.forEach(({ key }) => {
      next[key] = DEFAULT_THEME.colors[key];
    });
    setHexInputs(next);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (isPreviewing) {
      stopPreview();
    }
    setStatusMessage('Theme reset to default.');
  }, [resetTheme, isPreviewing, stopPreview]);

  const handleExport = useCallback(() => {
    const json = exportTheme(draft);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'theme.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setStatusMessage('Theme exported.');
  }, [draft]);

  const handleImportClick = useCallback(() => {
    setImportError('');
    importInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = typeof reader.result === 'string' ? reader.result : '';
        const imported = importTheme(raw);
        setDraft(imported);
        const next = {} as Record<ColorKey, string>;
        COLOR_FIELDS.forEach(({ key }) => {
          next[key] = imported.colors[key];
        });
        setHexInputs(next);
        setImportError('');
        setStatusMessage('Theme imported.');
      } catch (err) {
        setImportError(err instanceof Error ? err.message : 'Invalid theme file.');
      }
    };
    reader.onerror = () => {
      setImportError('Failed to read the theme file.');
    };
    reader.readAsText(file);
    if (importInputRef.current) {
      importInputRef.current.value = '';
    }
  }, []);

  return (
    <section className="theme-editor" aria-labelledby="theme-editor-heading">
      <h2 id="theme-editor-heading">Theme Editor</h2>

      <div className="theme-editor__layout">
        <div className="theme-editor__controls">
          <fieldset className="theme-editor__palette">
            <legend>Color Palette</legend>
            {COLOR_FIELDS.map(({ key, label }) => {
              const inputId = `theme-color-${key}`;
              const hexId = `theme-hex-${key}`;
              return (
                <div className="theme-editor__color-row" key={key}>
                  <label htmlFor={inputId}>{label}</label>
                  <input
                    id={inputId}
                    type="color"
                    value={HEX_PATTERN.test(draft.colors[key]) ? draft.colors[key] : '#000000'}
                    onChange={(e) => handleColorPickerChange(key, e.target.value)}
                    aria-label={`${label} color picker`}
                  />
                  <label htmlFor={hexId} className="visually-hidden">
                    {label} hex value
                  </label>
                  <input
                    id={hexId}
                    type="text"
                    value={hexInputs[key]}
                    onChange={(e) => handleHexInputChange(key, e.target.value)}
                    onBlur={() => handleHexInputBlur(key)}
                    aria-invalid={!HEX_PATTERN.test(hexInputs[key])}
                    aria-describedby={!HEX_PATTERN.test(hexInputs[key]) ? `theme-hex-${key}-error` : undefined}
                    spellCheck={false}
                    maxLength={7}
                  />
                  {!HEX_PATTERN.test(hexInputs[key]) && (
                    <span id={`theme-hex-${key}-error`} className="theme-editor__error" role="alert">
                      Invalid hex color
                    </span>
                  )}
                </div>
              );
            })}
          </fieldset>

          <fieldset className="theme-editor__branding">
            <legend>Branding</legend>
            <label htmlFor="theme-logo-upload">Upload logo</label>
            <input
              id="theme-logo-upload"
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
            />
            {draft.logoUrl && (
              <div className="theme-editor__logo-preview">
                <img src={draft.logoUrl} alt="Uploaded logo preview" />
                <button type="button" onClick={handleRemoveLogo}>
                  Remove logo
                </button>
              </div>
            )}
          </fieldset>

          <fieldset className="theme-editor__contrast">
            <legend>Accessibility</legend>
            {contrastIssues.length === 0 ? (
              <p className="theme-editor__contrast-ok" role="status">
                All color pairs meet WCAG contrast requirements.
              </p>
            ) : (
              <ul className="theme-editor__contrast-issues" role="alert">
                {contrastIssues.map((issue) => (
                  <li key={issue.id}>
                    {issue.message} (ratio {issue.ratio.toFixed(2)}:1, required {issue.required}:1)
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          <fieldset className="theme-editor__io">
            <legend>Import / Export</legend>
            <button type="button" onClick={handleExport}>
              Export theme
            </button>
            <button type="button" onClick={handleImportClick}>
              Import theme
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportFile}
              className="visually-hidden"
              aria-label="Import theme file"
            />
            {importError && (
              <p className="theme-editor__error" role="alert">
                {importError}
              </p>
            )}
          </fieldset>

          <fieldset className="theme-editor__gallery">
            <legend>Theme Gallery</legend>
            <ul className="theme-editor__gallery-list">
              {PREBUILT_THEMES.map((prebuilt) => (
                <li key={prebuilt.id}>
                  <button
                    type="button"
                    onClick={() => handleApplyGalleryTheme(prebuilt)}
                    aria-label={`Apply ${prebuilt.name} theme`}
                  >
                    <span
                      className="theme-editor__swatch"
                      style={{
                        background: `linear-gradient(135deg, ${prebuilt.theme.colors.primary}, ${prebuilt.theme.colors.accent})`,
                      }}
                      aria-hidden="true"
                    />
                    {prebuilt.name}
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>

          <div className="theme-editor__actions">
            <button type="button" onClick={handlePreviewToggle} aria-pressed={isPreviewing}>
              {isPreviewing ? 'Stop preview' : 'Preview theme'}
            </button>
            <button type="button" onClick={handleSave}>
              Save theme
            </button>
            <button type="button" onClick={handleReset}>
              Reset to default
            </button>
          </div>

          {statusMessage && (
            <p className="theme-editor__status" role="status">
              {statusMessage}
            </p>
          )}
        </div>

        <div className="theme-editor__preview" aria-label="Theme preview">
          <h3>Live Preview</h3>
          <div
            className="theme-editor__preview-surface"
            style={cssVariables as React.CSSProperties}
          >
            <header className="theme-editor__preview-header">
              {draft.logoUrl ? (
                <img src={draft.logoUrl} alt="Brand logo" className="theme-editor__preview-logo" />
              ) : (
                <span className="theme-editor__preview-logo-placeholder">Logo</span>
              )}
              <span>Sample App</span>
            </header>
            <p>This is how your interface will look with the selected colors.</p>
            <div className="theme-editor__preview-buttons">
              <button type="button" className="preview-btn preview-btn--primary">
                Primary
              </button>
              <button type="button" className="preview-btn preview-btn--accent">
                Accent
              </button>
            </div>
            <div className="theme-editor__preview-alerts">
              <span className="preview-alert preview-alert--success">Success</span>
              <span className="preview-alert preview-alert--warning">Warning</span>
              <span className="preview-alert preview-alert--error">Error</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ThemeEditor;