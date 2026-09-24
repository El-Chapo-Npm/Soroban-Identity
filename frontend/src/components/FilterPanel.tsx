import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { Credential, CredentialType } from "../../../sdk/src/types";
import { validateStellarAddress } from "../../../sdk/src/utils";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";

export type CompoundLogic = "AND" | "OR";

export type FilterField =
  | "issuer"
  | "credentialType"
  | "dateRange"
  | "verificationStatus"
  | "claimValue";

export type FilterOperator = "equals" | "contains" | "startsWith" | "between";

export interface FilterRule {
  id: string;
  field: FilterField;
  operator: FilterOperator;
  value: string;
  valueTo?: string; // used for date ranges (e.g. End date)
  claimKey?: string; // used when field === 'claimValue'
}

export interface FilterState {
  logic: CompoundLogic;
  rules: FilterRule[];
  quickFilter?: string;
}

export interface FilterPreset {
  id: string;
  name: string;
  filter: FilterState;
  createdAt: number;
  updatedAt?: number;
}

export interface FilterPanelProps {
  initialFilter?: FilterState;
  onFilterChange: (filter: FilterState) => void;
  onApply?: (filter: FilterState) => void;
  onClose?: () => void;
}

const STORAGE_KEY = "soroban_identity_filter_presets";
const BACKEND_ENDPOINT = "/api/filter-presets";

const QUICK_FILTERS: { label: string; id: string; rule: FilterRule }[] = [
  {
    id: "kyc-only",
    label: "KYC Only",
    rule: {
      id: "qf-kyc",
      field: "credentialType",
      operator: "equals",
      value: "Kyc",
    },
  },
  {
    id: "active-status",
    label: "Active Only",
    rule: {
      id: "qf-active",
      field: "verificationStatus",
      operator: "equals",
      value: "active",
    },
  },
  {
    id: "revoked-status",
    label: "Revoked",
    rule: {
      id: "qf-revoked",
      field: "verificationStatus",
      operator: "equals",
      value: "revoked",
    },
  },
  {
    id: "reputation-only",
    label: "Reputation",
    rule: {
      id: "qf-rep",
      field: "credentialType",
      operator: "equals",
      value: "Reputation",
    },
  },
];

const DEFAULT_RULE: FilterRule = {
  id: "rule-initial-1",
  field: "credentialType",
  operator: "equals",
  value: "Kyc",
};

/**
 * Validates a single filter rule. Returns an error message string or null if valid.
 */
export function validateRule(rule: FilterRule): string | null {
  if (rule.field === "issuer" && rule.value.trim()) {
    const trimmed = rule.value.trim();
    if (trimmed.length > 0 && !validateStellarAddress(trimmed)) {
      return `Invalid Stellar address for issuer: "${trimmed}"`;
    }
  }

  if (rule.field === "dateRange") {
    if (rule.value && rule.valueTo) {
      const from = new Date(rule.value).getTime();
      const to = new Date(rule.valueTo).getTime();
      if (isNaN(from)) return "Start date is invalid";
      if (isNaN(to)) return "End date is invalid";
      if (from > to) return "Start date cannot be later than end date";
    }
  }

  if (rule.field === "claimValue") {
    if (rule.value.trim() && !rule.claimKey?.trim()) {
      return "Claim key is required when specifying a claim value";
    }
  }

  return null;
}

/**
 * Checks if a credential matches a given filter state
 */
export function matchesFilter(
  credential: Credential,
  filter: FilterState,
  verificationStatus?: "active" | "expired" | "revoked" | "valid" | "invalid"
): boolean {
  if (!filter.rules || filter.rules.length === 0) return true;

  const results = filter.rules.map((rule) => {
    switch (rule.field) {
      case "issuer": {
        if (!rule.value.trim()) return true;
        const target = credential.issuer.toLowerCase();
        const query = rule.value.trim().toLowerCase();
        if (rule.operator === "equals") return target === query;
        if (rule.operator === "contains") return target.includes(query);
        if (rule.operator === "startsWith") return target.startsWith(query);
        return true;
      }
      case "credentialType": {
        if (!rule.value || rule.value === "All") return true;
        return credential.credentialType === rule.value;
      }
      case "verificationStatus": {
        if (!rule.value || rule.value === "all") return true;
        const currentStatus =
          verificationStatus ||
          (credential.revoked
            ? "revoked"
            : credential.expiresAt > 0 && Date.now() / 1000 > credential.expiresAt
            ? "expired"
            : "active");
        return currentStatus === rule.value;
      }
      case "dateRange": {
        const issuedMs = credential.issuedAt * 1000;
        if (rule.value) {
          const from = new Date(rule.value).getTime();
          if (!isNaN(from) && issuedMs < from) return false;
        }
        if (rule.valueTo) {
          const to = new Date(rule.valueTo).getTime();
          if (!isNaN(to) && issuedMs > to) return false;
        }
        return true;
      }
      case "claimValue": {
        const key = rule.claimKey?.trim();
        const val = rule.value.trim().toLowerCase();
        if (!key) return true;
        const actualVal = credential.claims[key]?.toLowerCase() || "";
        if (!val) return Boolean(credential.claims[key]);
        if (rule.operator === "equals") return actualVal === val;
        if (rule.operator === "contains") return actualVal.includes(val);
        if (rule.operator === "startsWith") return actualVal.startsWith(val);
        return true;
      }
      default:
        return true;
    }
  });

  if (filter.logic === "AND") {
    return results.every(Boolean);
  } else {
    return results.some(Boolean);
  }
}

export const FilterPanel: React.FC<FilterPanelProps> = ({
  initialFilter,
  onFilterChange,
  onApply,
  onClose,
}) => {
  const [logic, setLogic] = useState<CompoundLogic>(initialFilter?.logic || "AND");
  const [rules, setRules] = useState<FilterRule[]>(
    initialFilter?.rules && initialFilter.rules.length > 0
      ? initialFilter.rules
      : [{ ...DEFAULT_RULE, id: "rule-1" }]
  );
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [newPresetName, setNewPresetName] = useState("");
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [activeChip, setActiveChip] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Load presets from LocalStorage and attempt backend sync
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setPresets(parsed);
        }
      }
    } catch {
      // LocalStorage access failure handled gracefully
    }

    // Attempt to sync with backend if available
    const syncBackend = async () => {
      try {
        const response = await fetch(BACKEND_ENDPOINT, { method: "GET" });
        if (response.ok) {
          const backendPresets: FilterPreset[] = await response.json();
          if (Array.isArray(backendPresets) && backendPresets.length > 0) {
            setPresets(backendPresets);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(backendPresets));
          }
        }
      } catch {
        // Backend not reachable or offline; fallback to local storage
      }
    };

    syncBackend();
  }, []);

  // Save presets helper with backend sync
  const savePresetsList = async (updated: FilterPreset[]) => {
    setPresets(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn("Failed to write presets to localStorage", e);
    }

    try {
      await fetch(BACKEND_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
    } catch {
      // Offline/backend sync failure is safely ignored
    }
  };

  // Validate all rules
  const validateCurrentRules = useCallback((): boolean => {
    const errors: string[] = [];
    rules.forEach((rule, idx) => {
      const err = validateRule(rule);
      if (err) errors.push(`Rule ${idx + 1}: ${err}`);
    });
    setValidationErrors(errors);
    return errors.length === 0;
  }, [rules]);

  // Current active filter count badge calculation
  const activeCount = useMemo(() => {
    return rules.filter((r) => {
      if (r.field === "credentialType") return r.value && r.value !== "All";
      if (r.field === "verificationStatus") return r.value && r.value !== "all";
      if (r.field === "dateRange") return Boolean(r.value || r.valueTo);
      if (r.field === "claimValue") return Boolean(r.claimKey);
      return Boolean(r.value.trim());
    }).length;
  }, [rules]);

  const currentFilterState = useMemo<FilterState>(() => {
    return {
      logic,
      rules,
      quickFilter: activeChip || undefined,
    };
  }, [logic, rules, activeChip]);

  // Broadcast changes whenever state changes and rules are valid
  useEffect(() => {
    onFilterChange(currentFilterState);
  }, [currentFilterState, onFilterChange]);

  const handleApply = () => {
    if (validateCurrentRules()) {
      onApply?.(currentFilterState);
      setStatusMessage("Filters applied successfully");
      setTimeout(() => setStatusMessage(null), 2500);
    }
  };

  const handleReset = () => {
    setLogic("AND");
    setRules([{ ...DEFAULT_RULE, id: `rule-${Date.now()}` }]);
    setActiveChip(null);
    setValidationErrors([]);
    setStatusMessage("Filters reset to default");
    setTimeout(() => setStatusMessage(null), 2000);
  };

  // Keyboard Shortcuts
  useKeyboardShortcuts({
    shortcuts: [
      {
        key: "Enter",
        ctrl: true,
        description: "Apply active filters",
        category: "actions",
        handler: handleApply,
      },
      {
        key: "Escape",
        description: "Reset filters or close panel",
        category: "actions",
        handler: () => {
          if (onClose) onClose();
          else handleReset();
        },
      },
      {
        key: "s",
        ctrl: true,
        description: "Save filter preset",
        category: "actions",
        handler: () => setIsSavingPreset(true),
      },
    ],
  });

  const addRule = () => {
    setRules((prev) => [
      ...prev,
      {
        id: `rule-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        field: "credentialType",
        operator: "equals",
        value: "Kyc",
      },
    ]);
  };

  const removeRule = (id: string) => {
    setRules((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  };

  const updateRule = (id: string, updates: Partial<FilterRule>) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates } : r))
    );
  };

  // Quick Filter Chip Click
  const toggleQuickFilter = (qf: typeof QUICK_FILTERS[0]) => {
    if (activeChip === qf.id) {
      setActiveChip(null);
      handleReset();
    } else {
      setActiveChip(qf.id);
      setRules([qf.rule]);
      setLogic("AND");
    }
  };

  // Save Preset
  const handleSavePreset = async () => {
    if (!newPresetName.trim()) {
      setValidationErrors(["Please enter a preset name."]);
      return;
    }
    const newPreset: FilterPreset = {
      id: `preset-${Date.now()}`,
      name: newPresetName.trim(),
      filter: currentFilterState,
      createdAt: Date.now(),
    };
    const updated = [...presets, newPreset];
    await savePresetsList(updated);
    setSelectedPresetId(newPreset.id);
    setNewPresetName("");
    setIsSavingPreset(false);
    setStatusMessage(`Preset "${newPreset.name}" saved!`);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  // Load Preset
  const handleLoadPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    const found = presets.find((p) => p.id === presetId);
    if (found) {
      setLogic(found.filter.logic);
      setRules(found.filter.rules);
      setActiveChip(found.filter.quickFilter || null);
      setStatusMessage(`Loaded preset "${found.name}"`);
      setTimeout(() => setStatusMessage(null), 2500);
    }
  };

  // Delete Preset
  const handleDeletePreset = async (presetId: string) => {
    const updated = presets.filter((p) => p.id !== presetId);
    await savePresetsList(updated);
    if (selectedPresetId === presetId) setSelectedPresetId("");
    setStatusMessage("Preset deleted");
    setTimeout(() => setStatusMessage(null), 2000);
  };

  // Export Presets as JSON
  const handleExportJSON = () => {
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(presets, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute(
      "download",
      `filter-presets-${new Date().toISOString().slice(0, 10)}.json`
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setStatusMessage("Presets exported to JSON");
    setTimeout(() => setStatusMessage(null), 2500);
  };

  // Import Presets from JSON
  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const imported = JSON.parse(text);

        if (!Array.isArray(imported)) {
          throw new Error("Invalid format: expected array of presets");
        }

        const validPresets: FilterPreset[] = imported.filter(
          (p: any) => p && typeof p.name === "string" && p.filter?.rules
        );

        if (validPresets.length === 0) {
          throw new Error("No valid presets found in file");
        }

        const merged = [...presets];
        validPresets.forEach((vp) => {
          if (!merged.some((m) => m.id === vp.id)) {
            merged.push(vp);
          }
        });

        await savePresetsList(merged);
        setStatusMessage(`Successfully imported ${validPresets.length} preset(s)`);
        setTimeout(() => setStatusMessage(null), 3000);
      } catch (err: any) {
        setValidationErrors([`Import failed: ${err.message}`]);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label="Advanced Filter Panel"
      style={{
        background: "var(--card-bg, #ffffff)",
        border: "1px solid var(--card-border, #e2e8f0)",
        borderRadius: "12px",
        padding: "1.25rem",
        marginBottom: "1.5rem",
        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <h3
            style={{
              margin: 0,
              fontSize: "1.1rem",
              fontWeight: 600,
              color: "var(--text, #0f172a)",
            }}
          >
            Filter Credentials
          </h3>
          {activeCount > 0 && (
            <span
              role="status"
              aria-label={`${activeCount} active filters`}
              style={{
                background: "var(--accent, #7c3aed)",
                color: "#ffffff",
                fontSize: "0.75rem",
                fontWeight: 700,
                borderRadius: "9999px",
                padding: "0.15rem 0.55rem",
              }}
            >
              {activeCount} active
            </span>
          )}
        </div>

        {/* Shortcuts info */}
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted, #64748b)" }}>
          <kbd style={{ padding: "0.1rem 0.3rem", background: "var(--bg-subtle)", borderRadius: "4px" }}>Ctrl+Enter</kbd> to apply |{" "}
          <kbd style={{ padding: "0.1rem 0.3rem", background: "var(--bg-subtle)", borderRadius: "4px" }}>Esc</kbd> to clear
        </div>
      </div>

      {/* Quick Filters Row */}
      <div style={{ marginBottom: "1rem" }}>
        <div
          style={{
            fontSize: "0.8rem",
            fontWeight: 600,
            color: "var(--text-muted, #64748b)",
            marginBottom: "0.4rem",
          }}
        >
          Quick Filters:
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {QUICK_FILTERS.map((qf) => {
            const isActive = activeChip === qf.id;
            return (
              <button
                key={qf.id}
                type="button"
                onClick={() => toggleQuickFilter(qf)}
                style={{
                  background: isActive
                    ? "var(--accent, #7c3aed)"
                    : "var(--bg-subtle, #f1f5f9)",
                  color: isActive ? "#ffffff" : "var(--text, #0f172a)",
                  border: `1px solid ${isActive ? "var(--accent, #7c3aed)" : "var(--border-input, #cbd5e1)"}`,
                  borderRadius: "16px",
                  padding: "0.25rem 0.75rem",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {qf.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Logic Operator Selector */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          marginBottom: "1rem",
          padding: "0.5rem 0.75rem",
          background: "var(--bg-subtle, #f1f5f9)",
          borderRadius: "8px",
        }}
      >
        <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text)" }}>
          Match Logic:
        </span>
        <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer", fontSize: "0.85rem" }}>
          <input
            type="radio"
            name="logic-operator"
            value="AND"
            checked={logic === "AND"}
            onChange={() => setLogic("AND")}
          />
          Match ALL (AND)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer", fontSize: "0.85rem" }}>
          <input
            type="radio"
            name="logic-operator"
            value="OR"
            checked={logic === "OR"}
            onChange={() => setLogic("OR")}
          />
          Match ANY (OR)
        </label>
      </div>

      {/* Validation or status alert */}
      {validationErrors.length > 0 && (
        <div
          role="alert"
          style={{
            background: "var(--badge-red-bg, #fee2e2)",
            color: "var(--badge-red-text, #991b1b)",
            padding: "0.75rem",
            borderRadius: "6px",
            marginBottom: "1rem",
            fontSize: "0.85rem",
          }}
        >
          {validationErrors.map((err, i) => (
            <div key={i}>• {err}</div>
          ))}
        </div>
      )}
      {statusMessage && (
        <div
          role="status"
          style={{
            background: "var(--badge-green-bg, #dcfce7)",
            color: "var(--badge-green-text, #166534)",
            padding: "0.5rem 0.75rem",
            borderRadius: "6px",
            marginBottom: "1rem",
            fontSize: "0.85rem",
          }}
        >
          {statusMessage}
        </div>
      )}

      {/* Rules list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.25rem" }}>
        {rules.map((rule, index) => (
          <div
            key={rule.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              flexWrap: "wrap",
              padding: "0.5rem",
              border: "1px solid var(--border-input, #cbd5e1)",
              borderRadius: "6px",
              background: "var(--card-bg, #ffffff)",
            }}
          >
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                width: "20px",
                textAlign: "center",
              }}
            >
              #{index + 1}
            </span>

            {/* Field selection */}
            <select
              aria-label={`Rule ${index + 1} field`}
              value={rule.field}
              onChange={(e) =>
                updateRule(rule.id, {
                  field: e.target.value as FilterField,
                  value: e.target.value === "credentialType" ? "Kyc" : "",
                  claimKey: "",
                })
              }
              style={{
                padding: "0.35rem 0.5rem",
                borderRadius: "4px",
                border: "1px solid var(--border-input, #cbd5e1)",
                background: "var(--dropdown-bg, #ffffff)",
                color: "var(--text)",
                fontSize: "0.85rem",
              }}
            >
              <option value="credentialType">Credential Type</option>
              <option value="issuer">Issuer Address</option>
              <option value="verificationStatus">Verification Status</option>
              <option value="dateRange">Date Issued Range</option>
              <option value="claimValue">Claim Value</option>
            </select>

            {/* Operator Selection */}
            {rule.field !== "credentialType" &&
              rule.field !== "verificationStatus" &&
              rule.field !== "dateRange" && (
                <select
                  aria-label={`Rule ${index + 1} operator`}
                  value={rule.operator}
                  onChange={(e) =>
                    updateRule(rule.id, { operator: e.target.value as FilterOperator })
                  }
                  style={{
                    padding: "0.35rem 0.5rem",
                    borderRadius: "4px",
                    border: "1px solid var(--border-input, #cbd5e1)",
                    background: "var(--dropdown-bg, #ffffff)",
                    color: "var(--text)",
                    fontSize: "0.85rem",
                  }}
                >
                  <option value="equals">Equals</option>
                  <option value="contains">Contains</option>
                  <option value="startsWith">Starts With</option>
                </select>
              )}

            {/* Claim Key Input (only when claimValue is chosen) */}
            {rule.field === "claimValue" && (
              <input
                type="text"
                placeholder="Claim Key (e.g. tier)"
                aria-label={`Rule ${index + 1} claim key`}
                value={rule.claimKey || ""}
                onChange={(e) => updateRule(rule.id, { claimKey: e.target.value })}
                style={{
                  padding: "0.35rem 0.5rem",
                  borderRadius: "4px",
                  border: "1px solid var(--border-input, #cbd5e1)",
                  fontSize: "0.85rem",
                  flex: "1 1 120px",
                }}
              />
            )}

            {/* Value inputs per field */}
            {rule.field === "credentialType" && (
              <select
                aria-label={`Rule ${index + 1} credential type value`}
                value={rule.value}
                onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                style={{
                  padding: "0.35rem 0.5rem",
                  borderRadius: "4px",
                  border: "1px solid var(--border-input, #cbd5e1)",
                  fontSize: "0.85rem",
                  flex: "1 1 140px",
                }}
              >
                <option value="All">All Types</option>
                <option value="Kyc">Kyc</option>
                <option value="Reputation">Reputation</option>
                <option value="Achievement">Achievement</option>
                <option value="Custom">Custom</option>
              </select>
            )}

            {rule.field === "verificationStatus" && (
              <select
                aria-label={`Rule ${index + 1} verification status value`}
                value={rule.value}
                onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                style={{
                  padding: "0.35rem 0.5rem",
                  borderRadius: "4px",
                  border: "1px solid var(--border-input, #cbd5e1)",
                  fontSize: "0.85rem",
                  flex: "1 1 140px",
                }}
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="revoked">Revoked</option>
              </select>
            )}

            {rule.field === "dateRange" && (
              <div style={{ display: "flex", gap: "0.3rem", alignItems: "center", flex: "1 1 280px" }}>
                <input
                  type="date"
                  aria-label={`Rule ${index + 1} start date`}
                  value={rule.value}
                  onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                  style={{
                    padding: "0.35rem",
                    borderRadius: "4px",
                    border: "1px solid var(--border-input, #cbd5e1)",
                    fontSize: "0.85rem",
                  }}
                />
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>to</span>
                <input
                  type="date"
                  aria-label={`Rule ${index + 1} end date`}
                  value={rule.valueTo || ""}
                  onChange={(e) => updateRule(rule.id, { valueTo: e.target.value })}
                  style={{
                    padding: "0.35rem",
                    borderRadius: "4px",
                    border: "1px solid var(--border-input, #cbd5e1)",
                    fontSize: "0.85rem",
                  }}
                />
              </div>
            )}

            {(rule.field === "issuer" || rule.field === "claimValue") && (
              <input
                type="text"
                aria-label={`Rule ${index + 1} value`}
                placeholder={rule.field === "issuer" ? "Stellar Address (G...)" : "Claim Value"}
                value={rule.value}
                onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                style={{
                  padding: "0.35rem 0.5rem",
                  borderRadius: "4px",
                  border: "1px solid var(--border-input, #cbd5e1)",
                  fontSize: "0.85rem",
                  flex: "1 1 150px",
                }}
              />
            )}

            {/* Remove rule button */}
            <button
              type="button"
              aria-label={`Remove rule ${index + 1}`}
              onClick={() => removeRule(rule.id)}
              disabled={rules.length <= 1}
              style={{
                background: "transparent",
                border: "none",
                color: rules.length <= 1 ? "var(--btn-disabled-color, #94a3b8)" : "var(--error-text, #dc2626)",
                cursor: rules.length <= 1 ? "not-allowed" : "pointer",
                padding: "0.3rem 0.5rem",
                fontSize: "1rem",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Button controls: Add rule, Apply, Reset */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.75rem",
          marginBottom: "1.25rem",
        }}
      >
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            onClick={addRule}
            style={{
              background: "var(--bg-subtle, #f1f5f9)",
              border: "1px solid var(--border-input, #cbd5e1)",
              borderRadius: "6px",
              padding: "0.4rem 0.8rem",
              fontSize: "0.85rem",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            + Add Condition
          </button>
          <button
            type="button"
            onClick={handleReset}
            style={{
              background: "transparent",
              border: "1px solid var(--border-input, #cbd5e1)",
              borderRadius: "6px",
              padding: "0.4rem 0.8rem",
              fontSize: "0.85rem",
              cursor: "pointer",
              color: "var(--text-muted)",
            }}
          >
            Reset All
          </button>
        </div>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            onClick={handleApply}
            style={{
              background: "var(--accent, #7c3aed)",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              padding: "0.45rem 1.25rem",
              fontSize: "0.85rem",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 2px 4px rgba(124, 58, 237, 0.2)",
            }}
          >
            Apply Filters
          </button>
        </div>
      </div>

      {/* Presets Management Section */}
      <div
        style={{
          borderTop: "1px solid var(--card-border, #e2e8f0)",
          paddingTop: "1rem",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.5rem",
            marginBottom: "0.5rem",
          }}
        >
          <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text)" }}>
            Saved Presets
          </span>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={() => setIsSavingPreset(!isSavingPreset)}
              style={{
                fontSize: "0.8rem",
                padding: "0.25rem 0.5rem",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border-input)",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              {isSavingPreset ? "Cancel" : "Save as Preset"}
            </button>
            <button
              type="button"
              onClick={handleExportJSON}
              style={{
                fontSize: "0.8rem",
                padding: "0.25rem 0.5rem",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border-input)",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Export JSON
            </button>
            <label
              style={{
                fontSize: "0.8rem",
                padding: "0.25rem 0.5rem",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border-input)",
                borderRadius: "4px",
                cursor: "pointer",
                display: "inline-block",
              }}
            >
              Import JSON
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                style={{ display: "none" }}
                onChange={handleImportJSON}
              />
            </label>
          </div>
        </div>

        {/* Save preset input */}
        {isSavingPreset && (
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              marginBottom: "0.75rem",
              marginTop: "0.5rem",
            }}
          >
            <input
              type="text"
              placeholder="Preset Name (e.g. My Active KYCs)"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              style={{
                flex: 1,
                padding: "0.35rem 0.5rem",
                fontSize: "0.85rem",
                borderRadius: "4px",
                border: "1px solid var(--border-input)",
              }}
            />
            <button
              type="button"
              onClick={handleSavePreset}
              style={{
                background: "var(--accent, #7c3aed)",
                color: "#ffffff",
                border: "none",
                borderRadius: "4px",
                padding: "0.35rem 0.85rem",
                fontSize: "0.85rem",
                cursor: "pointer",
              }}
            >
              Save
            </button>
          </div>
        )}

        {/* Preset Selector */}
        {presets.length > 0 ? (
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <select
              aria-label="Select a saved preset"
              value={selectedPresetId}
              onChange={(e) => handleLoadPreset(e.target.value)}
              style={{
                padding: "0.35rem 0.5rem",
                borderRadius: "4px",
                border: "1px solid var(--border-input)",
                fontSize: "0.85rem",
                minWidth: "160px",
              }}
            >
              <option value="">-- Load a Saved Preset --</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} ({preset.filter.rules.length} rules)
                </option>
              ))}
            </select>

            {selectedPresetId && (
              <button
                type="button"
                onClick={() => handleDeletePreset(selectedPresetId)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--error-text, #dc2626)",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                Delete Selected Preset
              </button>
            )}
          </div>
        ) : (
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            No presets saved yet. Configure filters above and click "Save as Preset".
          </div>
        )}
      </div>
    </div>
  );
};

export default FilterPanel;
