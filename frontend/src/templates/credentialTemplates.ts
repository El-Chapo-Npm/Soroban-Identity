import type { CredentialType } from '../../../sdk/src/types';

export interface TemplateFieldSchema {
  name: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'email';
  required?: boolean;
  description?: string;
  defaultValue?: string;
  pattern?: string;
}

export interface CredentialTemplate {
  id: string;
  name: string;
  description: string;
  credentialType: CredentialType;
  icon: string;
  isCustom?: boolean;
  fields: TemplateFieldSchema[];
  schema: {
    $schema: string;
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      format?: string;
      pattern?: string;
    }>;
    required: string[];
  };
}

export const BUILT_IN_TEMPLATES: CredentialTemplate[] = [
  {
    id: 'template_kyc',
    name: 'KYC Identity Verification',
    description: 'Standard Know-Your-Customer verification with identity details and level.',
    credentialType: 'Kyc',
    icon: '🆔',
    fields: [
      { name: 'fullName', label: 'Full Legal Name', type: 'string', required: true, description: 'Legal name of the individual' },
      { name: 'documentType', label: 'Document Type', type: 'string', required: true, defaultValue: 'Passport', description: 'ID Card, Passport, or Driver License' },
      { name: 'documentNumber', label: 'Document ID Number', type: 'string', required: true },
      { name: 'nationality', label: 'Nationality', type: 'string', required: true },
      { name: 'verificationLevel', label: 'Verification Level', type: 'string', defaultValue: 'Tier-1' },
      { name: 'verifiedAt', label: 'Verification Date', type: 'date', required: true },
    ],
    schema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        fullName: { type: 'string', description: 'Legal name of individual' },
        documentType: { type: 'string', description: 'Type of ID document' },
        documentNumber: { type: 'string', description: 'ID Number' },
        nationality: { type: 'string', description: 'Country of citizenship' },
        verificationLevel: { type: 'string' },
        verifiedAt: { type: 'string', format: 'date' },
      },
      required: ['fullName', 'documentType', 'documentNumber', 'nationality'],
    },
  },
  {
    id: 'template_diploma',
    name: 'Educational Diploma',
    description: 'Proof of degree completion, university graduation, or academic award.',
    credentialType: 'Achievement',
    icon: '🎓',
    fields: [
      { name: 'institutionName', label: 'Institution Name', type: 'string', required: true },
      { name: 'degree', label: 'Degree Awarded', type: 'string', required: true, description: 'e.g. Bachelor of Science in Computer Science' },
      { name: 'graduationYear', label: 'Graduation Year', type: 'number', required: true },
      { name: 'gpaOrGrade', label: 'GPA or Honors Grade', type: 'string' },
      { name: 'major', label: 'Field of Study / Major', type: 'string', required: true },
    ],
    schema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        institutionName: { type: 'string' },
        degree: { type: 'string' },
        graduationYear: { type: 'number' },
        gpaOrGrade: { type: 'string' },
        major: { type: 'string' },
      },
      required: ['institutionName', 'degree', 'graduationYear', 'major'],
    },
  },
  {
    id: 'template_residence',
    name: 'Proof of Residence',
    description: 'Proof of physical address for residency validation and compliance.',
    credentialType: 'Custom',
    icon: '🏠',
    fields: [
      { name: 'residentName', label: 'Resident Name', type: 'string', required: true },
      { name: 'streetAddress', label: 'Street Address', type: 'string', required: true },
      { name: 'city', label: 'City', type: 'string', required: true },
      { name: 'stateOrProvince', label: 'State / Province', type: 'string' },
      { name: 'postalCode', label: 'Postal Code', type: 'string', required: true },
      { name: 'country', label: 'Country', type: 'string', required: true },
      { name: 'utilityProvider', label: 'Verifying Entity / Provider', type: 'string' },
    ],
    schema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        residentName: { type: 'string' },
        streetAddress: { type: 'string' },
        city: { type: 'string' },
        stateOrProvince: { type: 'string' },
        postalCode: { type: 'string' },
        country: { type: 'string' },
        utilityProvider: { type: 'string' },
      },
      required: ['residentName', 'streetAddress', 'city', 'postalCode', 'country'],
    },
  },
  {
    id: 'template_employment',
    name: 'Employment Verification',
    description: 'Verify current or prior employment, corporate title, and tenure.',
    credentialType: 'Custom',
    icon: '💼',
    fields: [
      { name: 'employeeName', label: 'Employee Name', type: 'string', required: true },
      { name: 'employerName', label: 'Employer Company', type: 'string', required: true },
      { name: 'jobTitle', label: 'Job Title', type: 'string', required: true },
      { name: 'startDate', label: 'Start Date', type: 'date', required: true },
      { name: 'employmentStatus', label: 'Status', type: 'string', defaultValue: 'Full-time' },
      { name: 'department', label: 'Department / Team', type: 'string' },
    ],
    schema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        employeeName: { type: 'string' },
        employerName: { type: 'string' },
        jobTitle: { type: 'string' },
        startDate: { type: 'string', format: 'date' },
        employmentStatus: { type: 'string' },
        department: { type: 'string' },
      },
      required: ['employeeName', 'employerName', 'jobTitle', 'startDate'],
    },
  },
  {
    id: 'template_age',
    name: 'Age Verification',
    description: 'Zero-knowledge or explicit age verification proving threshold qualification (e.g. 18+, 21+).',
    credentialType: 'Kyc',
    icon: '🎂',
    fields: [
      { name: 'holderName', label: 'Holder Name', type: 'string', required: true },
      { name: 'minimumAge', label: 'Minimum Age Attested', type: 'number', required: true, defaultValue: '18' },
      { name: 'isOverThreshold', label: 'Is Over Threshold', type: 'string', defaultValue: 'true' },
      { name: 'verificationAuthority', label: 'Authority', type: 'string', defaultValue: 'Government Issuer' },
    ],
    schema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        holderName: { type: 'string' },
        minimumAge: { type: 'number' },
        isOverThreshold: { type: 'string' },
        verificationAuthority: { type: 'string' },
      },
      required: ['holderName', 'minimumAge', 'isOverThreshold'],
    },
  },
];

const STORAGE_CUSTOM_TEMPLATES_KEY = 'soroban_custom_credential_templates';

export function getCustomTemplates(): CredentialTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_CUSTOM_TEMPLATES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to load custom templates from localStorage', e);
    return [];
  }
}

export function saveCustomTemplates(templates: CredentialTemplate[]): void {
  try {
    localStorage.setItem(STORAGE_CUSTOM_TEMPLATES_KEY, JSON.stringify(templates));
  } catch (e) {
    console.error('Failed to save custom templates to localStorage', e);
  }
}

export function getAllTemplates(): CredentialTemplate[] {
  return [...BUILT_IN_TEMPLATES, ...getCustomTemplates()];
}

/**
 * Validate claim key-value pairs against a template schema
 */
export function validateClaimsAgainstTemplate(
  template: CredentialTemplate,
  claims: Record<string, string>
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  // Check required properties from schema
  for (const requiredKey of template.schema.required) {
    if (!claims[requiredKey] || !claims[requiredKey].trim()) {
      errors[requiredKey] = `Field "${requiredKey}" is required by template ${template.name}.`;
    }
  }

  // Check types from fields
  for (const field of template.fields) {
    const val = claims[field.name];
    if (val && field.type === 'number') {
      if (isNaN(Number(val))) {
        errors[field.name] = `Field "${field.name}" must be a valid number.`;
      }
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Export custom templates to JSON string
 */
export function exportTemplatesJSON(templates?: CredentialTemplate[]): string {
  const target = templates ?? getCustomTemplates();
  return JSON.stringify(target, null, 2);
}

/**
 * Import custom templates from JSON string
 */
export function importTemplatesJSON(jsonString: string): { success: boolean; count: number; error?: string } {
  try {
    const parsed = JSON.parse(jsonString);
    const list: CredentialTemplate[] = Array.isArray(parsed) ? parsed : [parsed];

    const validList: CredentialTemplate[] = [];
    for (const item of list) {
      if (!item.id || !item.name || !item.schema) continue;
      item.isCustom = true;
      validList.push(item);
    }

    if (validList.length === 0) {
      return { success: false, count: 0, error: 'No valid template objects found in JSON.' };
    }

    const current = getCustomTemplates();
    const map = new Map<string, CredentialTemplate>();
    current.forEach((t) => map.set(t.id, t));
    validList.forEach((t) => map.set(t.id, t));

    const updated = Array.from(map.values());
    saveCustomTemplates(updated);

    return { success: true, count: validList.length };
  } catch (err: unknown) {
    return {
      success: false,
      count: 0,
      error: err instanceof Error ? err.message : 'Invalid JSON file format.',
    };
  }
}
