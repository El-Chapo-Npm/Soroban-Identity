// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  BUILT_IN_TEMPLATES,
  validateClaimsAgainstTemplate,
  exportTemplatesJSON,
  importTemplatesJSON,
  getCustomTemplates,
  saveCustomTemplates,
  type CredentialTemplate,
} from './credentialTemplates';

describe('Credential Templates Library', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('BUILT_IN_TEMPLATES', () => {
    it('contains all required standard templates', () => {
      const templateIds = BUILT_IN_TEMPLATES.map((t) => t.id);
      expect(templateIds).toContain('template_kyc');
      expect(templateIds).toContain('template_diploma');
      expect(templateIds).toContain('template_employment');
      expect(templateIds).toContain('template_residence');
      expect(templateIds).toContain('template_age');
    });

    it('each template has valid schema and required fields', () => {
      for (const t of BUILT_IN_TEMPLATES) {
        expect(t.name).toBeTruthy();
        expect(t.credentialType).toBeTruthy();
        expect(t.fields.length).toBeGreaterThan(0);
        expect(t.schema.required.length).toBeGreaterThan(0);
        expect(t.schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
      }
    });
  });

  describe('validateClaimsAgainstTemplate', () => {
    const kycTemplate = BUILT_IN_TEMPLATES.find((t) => t.id === 'template_kyc')!;

    it('validates complete and valid claims', () => {
      const claims = {
        fullName: 'Alice Bob',
        documentType: 'Passport',
        documentNumber: 'P12345678',
        nationality: 'NG',
        verifiedAt: '2026-10-17',
      };
      const result = validateClaimsAgainstTemplate(kycTemplate, claims);
      expect(result.valid).toBe(true);
      expect(Object.keys(result.errors)).toHaveLength(0);
    });

    it('detects missing required fields', () => {
      const claims = {
        fullName: 'Alice Bob',
        // missing documentType, documentNumber, nationality
      };
      const result = validateClaimsAgainstTemplate(kycTemplate, claims);
      expect(result.valid).toBe(false);
      expect(result.errors['documentType']).toBeDefined();
      expect(result.errors['documentNumber']).toBeDefined();
      expect(result.errors['nationality']).toBeDefined();
    });

    it('validates number field types', () => {
      const ageTemplate = BUILT_IN_TEMPLATES.find((t) => t.id === 'template_age')!;
      const claims = {
        holderName: 'Bob',
        isOverThreshold: 'true',
        minimumAge: 'not-a-number',
      };
      const result = validateClaimsAgainstTemplate(ageTemplate, claims);
      expect(result.valid).toBe(false);
      expect(result.errors['minimumAge']).toContain('must be a valid number');
    });
  });

  describe('Export and Import Templates', () => {
    const customTemplate: CredentialTemplate = {
      id: 'custom_cert',
      name: 'Custom Certificate',
      description: 'A test certificate',
      credentialType: 'Custom',
      icon: '📜',
      isCustom: true,
      fields: [
        { name: 'certTitle', label: 'Certificate Title', type: 'string', required: true },
      ],
      schema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          certTitle: { type: 'string' },
        },
        required: ['certTitle'],
      },
    };

    it('exports templates to formatted JSON', () => {
      const json = exportTemplatesJSON([customTemplate]);
      const parsed = JSON.parse(json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].id).toBe('custom_cert');
    });

    it('imports templates from valid JSON string into storage', () => {
      const json = JSON.stringify([customTemplate]);
      const res = importTemplatesJSON(json);
      expect(res.success).toBe(true);
      expect(res.count).toBe(1);

      const stored = getCustomTemplates();
      expect(stored.some((t) => t.id === 'custom_cert')).toBe(true);
    });

    it('rejects invalid JSON string on import', () => {
      const res = importTemplatesJSON('{ invalid json ...');
      expect(res.success).toBe(false);
      expect(res.count).toBe(0);
      expect(res.error).toBeDefined();
    });

    it('saves and retrieves custom templates', () => {
      saveCustomTemplates([customTemplate]);
      const retrieved = getCustomTemplates();
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].name).toBe('Custom Certificate');
    });
  });
});
