import { useState } from "react";
import type { CredentialField, ExportTemplate } from "./types";
import { DEFAULT_FIELD_LABELS } from "./format";
import { TEMPLATE_FIELDS, newTemplateId } from "./templates";

interface Props {
  /** Template to start from; built-ins are copied rather than edited. */
  base: ExportTemplate;
  onSave: (template: ExportTemplate) => void;
  onCancel: () => void;
}

export default function TemplateEditor({ base, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<ExportTemplate>(() =>
    base.builtIn
      ? { ...base, id: newTemplateId(), name: `${base.name} (copy)`, builtIn: false }
      : { ...base }
  );

  const toggleField = (field: CredentialField) => {
    setDraft((d) => ({
      ...d,
      fields: d.fields.includes(field)
        ? d.fields.filter((f) => f !== field)
        : // Keep the canonical ordering when re-enabling a field.
          TEMPLATE_FIELDS.filter((f) => f === field || d.fields.includes(f)),
    }));
  };

  const setLabel = (field: CredentialField, label: string) => {
    setDraft((d) => ({
      ...d,
      fieldLabels: { ...d.fieldLabels, [field]: label || undefined },
    }));
  };

  return (
    <div className="export-template-editor">
      <label className="export-label">Template name</label>
      <input
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
      />

      <label className="export-label">Document title</label>
      <input
        value={draft.title}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
      />

      <label className="export-label">Accent colour</label>
      <input
        type="color"
        className="export-color"
        value={draft.accentColor}
        onChange={(e) => setDraft({ ...draft, accentColor: e.target.value })}
      />

      <label className="export-label">Fields</label>
      <div className="export-field-grid">
        {TEMPLATE_FIELDS.map((field) => (
          <div key={field} className="export-field-row">
            <label className="export-check">
              <input
                type="checkbox"
                checked={draft.fields.includes(field)}
                onChange={() => toggleField(field)}
              />
              {DEFAULT_FIELD_LABELS[field]}
            </label>
            <input
              placeholder="Custom label"
              value={draft.fieldLabels?.[field] ?? ""}
              disabled={!draft.fields.includes(field)}
              onChange={(e) => setLabel(field, e.target.value)}
            />
          </div>
        ))}
      </div>

      <label className="export-check">
        <input
          type="checkbox"
          checked={draft.includeQr}
          onChange={(e) => setDraft({ ...draft, includeQr: e.target.checked })}
        />
        Include verification QR code
      </label>

      <label className="export-label">Footer text</label>
      <input
        value={draft.footerText ?? ""}
        onChange={(e) => setDraft({ ...draft, footerText: e.target.value })}
      />

      <div className="export-actions">
        <button
          onClick={() => onSave(draft)}
          disabled={!draft.name.trim() || draft.fields.length === 0}
        >
          Save template
        </button>
        <button className="export-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
