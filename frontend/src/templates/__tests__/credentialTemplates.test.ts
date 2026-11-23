import { describe, it, expect, beforeEach } from 'vitest';
import {
  BUILT_IN_TEMPLATES,
  getAllTemplates,
  validateClaimsAgainstTemplate,
  exportTemplatesJSON,
  importTemplatesJSON,
  type CredentialTemplate,
} from '../credentialTemplates';

describe('credentialTemplates', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('includes built-in templates for education, employment, and identity', () => {
    const templates = BUILT_IN_TEMPLATES;
    expect(templates.length).toBeGreaterThanOrEqual(4);

    const ids = templates.map((t) => t.id);
    expect(ids).toContain('template_kyc');
    expect(ids).toContain('template_diploma');
    expect(ids).toContain('template_employment');
    expect(ids).toContain('template_residence');
  });

  it('validates claims against template required fields', () => {
    const kycTemplate = BUILT_IN_TEMPLATES.find((t) => t.id === 'template_kyc')!;

    // Missing required fields
    const invalidRes = validateClaimsAgainstTemplate(kycTemplate, {
      fullName: 'Alice Bob',
    });
    expect(invalidRes.valid).toBe(false);
    expect(invalidRes.errors).toHaveProperty('documentType');

    // All required fields present
    const validRes = validateClaimsAgainstTemplate(kycTemplate, {
      fullName: 'Alice Bob',
      documentType: 'Passport',
      documentNumber: 'AB123456',
      nationality: 'US',
    });
    expect(validRes.valid).toBe(true);
    expect(Object.keys(validRes.errors).length).toBe(0);
  });

  it('validates numeric fields correctly', () => {
    const diplomaTemplate = BUILT_IN_TEMPLATES.find((t) => t.id === 'template_diploma')!;

    const invalidNumberRes = validateClaimsAgainstTemplate(diplomaTemplate, {
      institutionName: 'Stellar University',
      degree: 'B.S. CS',
      graduationYear: 'not-a-year',
      major: 'Computer Science',
    });
    expect(invalidNumberRes.valid).toBe(false);
    expect(invalidNumberRes.errors.graduationYear).toContain('must be a valid number');

    const validNumberRes = validateClaimsAgainstTemplate(diplomaTemplate, {
      institutionName: 'Stellar University',
      degree: 'B.S. CS',
      graduationYear: '2024',
      major: 'Computer Science',
    });
    expect(validNumberRes.valid).toBe(true);
  });

  it('exports and imports custom templates successfully', () => {
    const customTemplate: CredentialTemplate = {
      id: 'template_driver_license',
      name: "Driver's License",
      description: 'State DMV driver credential',
      credentialType: 'Custom',
      icon: '🚗',
      fields: [
        { name: 'licenseNumber', label: 'License Number', type: 'string', required: true },
      ],
      schema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: { licenseNumber: { type: 'string' } },
        required: ['licenseNumber'],
      },
    };

    const jsonStr = exportTemplatesJSON([customTemplate]);
    expect(jsonStr).toContain('template_driver_license');

    const importRes = importTemplatesJSON(jsonStr);
    expect(importRes.success).toBe(true);
    expect(importRes.count).toBe(1);

    const all = getAllTemplates();
    expect(all.some((t) => t.id === 'template_driver_license')).toBe(true);
  });
});
