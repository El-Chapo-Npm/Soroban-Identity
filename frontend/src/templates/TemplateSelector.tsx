import React, { useState } from 'react';
import {
  type CredentialTemplate,
  getAllTemplates,
  exportTemplatesJSON,
  importTemplatesJSON,
} from './credentialTemplates';
import { useToast } from '../context/ToastContext';

interface TemplateSelectorProps {
  selectedTemplateId?: string;
  onSelectTemplate: (template: CredentialTemplate) => void;
}

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({
  selectedTemplateId,
  onSelectTemplate,
}) => {
  const toast = useToast();
  const [templates, setTemplates] = useState<CredentialTemplate[]>(() => getAllTemplates());
  const [previewTemplate, setPreviewTemplate] = useState<CredentialTemplate | null>(null);

  const handleExport = () => {
    const jsonStr = exportTemplatesJSON();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `custom_templates_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Custom templates exported successfully.');
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const res = importTemplatesJSON(content);
      if (res.success) {
        toast.success(`Imported ${res.count} template(s).`);
        setTemplates(getAllTemplates());
      } else {
        toast.error(res.error || 'Failed to import templates.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <label style={{ fontSize: '0.9rem', fontWeight: 600 }}>
          Credential Template Library:
        </label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <label
            style={{
              padding: '0.3rem 0.6rem',
              backgroundColor: 'var(--bg-accent, #f1f5f9)',
              border: '1px solid var(--border-input, #cbd5e1)',
              borderRadius: '0.25rem',
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            📥 Import Templates
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleImport}
              style={{ display: 'none' }}
            />
          </label>
          <button
            type="button"
            onClick={handleExport}
            style={{
              padding: '0.3rem 0.6rem',
              backgroundColor: 'var(--bg-accent, #f1f5f9)',
              border: '1px solid var(--border-input, #cbd5e1)',
              borderRadius: '0.25rem',
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            📤 Export Templates
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: '0.75rem',
          marginBottom: '1rem',
        }}
      >
        {templates.map((tpl) => {
          const isSelected = selectedTemplateId === tpl.id;
          return (
            <div
              key={tpl.id}
              onClick={() => {
                onSelectTemplate(tpl);
                setPreviewTemplate(tpl);
              }}
              style={{
                border: isSelected
                  ? '2px solid var(--accent-light, #2563eb)'
                  : '1px solid var(--border-input, #e2e8f0)',
                backgroundColor: isSelected ? 'rgba(37, 99, 235, 0.05)' : 'var(--card-bg, #ffffff)',
                borderRadius: '0.5rem',
                padding: '0.75rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '1.25rem' }}>{tpl.icon}</span>
                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{tpl.name}</span>
              </div>
              <p
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted, #64748b)',
                  margin: '0 0 0.5rem',
                  lineHeight: 1.3,
                }}
              >
                {tpl.description}
              </p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="badge badge-green" style={{ fontSize: '0.7rem' }}>
                  {tpl.credentialType}
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--accent-light)' }}>
                  {tpl.fields.length} claims
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {previewTemplate && (
        <div
          style={{
            padding: '0.75rem 1rem',
            backgroundColor: 'var(--bg-accent, #f8fafc)',
            borderRadius: '0.375rem',
            border: '1px solid var(--border-input, #e2e8f0)',
            marginBottom: '1rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
              Preview Template: {previewTemplate.name}
            </span>
            <button
              type="button"
              onClick={() => setPreviewTemplate(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)' }}
            >
              ✕
            </button>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            Required claims: {previewTemplate.schema.required.join(', ')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {previewTemplate.fields.map((f) => (
              <span
                key={f.name}
                style={{
                  fontSize: '0.7rem',
                  padding: '0.2rem 0.4rem',
                  borderRadius: '0.25rem',
                  backgroundColor: 'var(--card-bg, #ffffff)',
                  border: '1px solid var(--border-input, #cbd5e1)',
                }}
              >
                {f.label} ({f.type}){f.required ? ' *' : ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TemplateSelector;
