import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { logger } from "./logger.js";

/**
 * Feature flag system for gradual rollout and A/B testing.
 *
 * Flags are persisted as JSON on disk with atomic writes. In-memory cache
 * provides fast lookups; the file is re-read on writes to stay in sync.
 *
 * ## Storage layout
 * ```
 * <dataDir>/feature-flags/flags.json
 * <dataDir>/feature-flags/audit.jsonl
 * ```
 *
 * ## Flag lifecycle
 * 1. Created  – admin creates a flag (default: disabled).
 * 2. Targeted – rules added for gradual rollout / per-user targeting.
 * 3. Evaluated – `evaluate()` checks rules and returns the variant.
 * 4. Archived – flag removed from active set; audit trail preserved.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {"boolean" | "variant"} FlagType
 *
 * @typedef {Object} TargetingRule
 * @property {string} attribute - User attribute to match (e.g. "tier", "userId").
 * @property {string} operator  - "eq" | "neq" | "in" | "not_in" | "percentage".
 * @property {*}      value     - Comparison value.
 * @property {string} variant   - Variant to return when rule matches.
 *
 * @typedef {Object} FeatureFlag
 * @property {string}     id          - Unique identifier.
 * @property {string}     key         - Human-readable flag key (e.g. "new_credential_types").
 * @property {string}     description - What the flag controls.
 * @property {FlagType}   type        - "boolean" (on/off) or "variant" (A/B/n).
 * @property {boolean}    enabled     - Global kill switch.
 * @property {*}          defaultValue - Value returned when no rule matches.
 * @property {TargetingRule[]} targetingRules - Ordered evaluation rules.
 * @property {string}     createdBy   - Actor who created the flag.
 * @property {number}     createdAt   - Unix timestamp (ms).
 * @property {number}     updatedAt   - Unix timestamp (ms).
 * @property {boolean}    archived    - Whether the flag is archived.
 */

// ── In-memory cache ───────────────────────────────────────────────────────────

/** @type {Map<string, FeatureFlag>} */
let flagCache = new Map();

// ── File I/O ──────────────────────────────────────────────────────────────────

function flagsPath(dataDir) {
  return path.join(dataDir, "feature-flags", "flags.json");
}

function auditPath(dataDir) {
  return path.join(dataDir, "feature-flags", "audit.jsonl");
}

async function ensureDir(dataDir) {
  const dir = path.join(dataDir, "feature-flags");
  await mkdir(dir, { recursive: true });
}

async function loadFlags(dataDir) {
  try {
    const raw = await readFile(flagsPath(dataDir), "utf-8");
    const list = JSON.parse(raw);
    flagCache = new Map();
    for (const flag of list) {
      flagCache.set(flag.key, flag);
    }
    return flagCache;
  } catch (err) {
    if (err.code === "ENOENT") {
      flagCache = new Map();
      return flagCache;
    }
    throw err;
  }
}

async function saveFlags(dataDir) {
  await ensureDir(dataDir);
  const list = [...flagCache.values()];
  const tmpPath = flagsPath(dataDir) + ".tmp";
  await writeFile(tmpPath, JSON.stringify(list, null, 2), "utf-8");
  await import("node:fs/promises").then((fs) =>
    fs.rename(tmpPath, flagsPath(dataDir)),
  );
}

async function appendAudit(dataDir, entry) {
  await ensureDir(dataDir);
  const line = JSON.stringify({
    ...entry,
    timestamp: Date.now(),
    id: randomUUID(),
  });
  const fs = await import("node:fs/promises");
  await fs.appendFile(auditPath(dataDir), line + "\n", "utf-8");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialize the feature flag system by loading persisted flags.
 *
 * @param {string} dataDir - Base data directory.
 */
export async function initFeatureFlags(dataDir) {
  await loadFlags(dataDir);
  logger.info(
    { flagCount: flagCache.size },
    "Feature flags loaded",
  );
}

/**
 * Create a new feature flag.
 *
 * @param {string}   dataDir
 * @param {Object}   opts
 * @param {string}   opts.key         - Unique flag key.
 * @param {string}   [opts.description] - Description.
 * @param {FlagType} [opts.type="boolean"] - Flag type.
 * @param {*}        [opts.defaultValue=false] - Default value.
 * @param {string}   [opts.createdBy="system"] - Creator.
 * @returns {FeatureFlag}
 */
export async function createFlag(
  dataDir,
  {
    key,
    description = "",
    type = "boolean",
    defaultValue = false,
    targetingRules = [],
    createdBy = "system",
  } = {},
) {
  if (flagCache.has(key)) {
    throw new Error(`Flag "${key}" already exists`);
  }

  const now = Date.now();
  /** @type {FeatureFlag} */
  const flag = {
    id: randomUUID(),
    key,
    description,
    type,
    enabled: false,
    defaultValue,
    targetingRules,
    createdBy,
    createdAt: now,
    updatedAt: now,
    archived: false,
  };

  flagCache.set(key, flag);
  await saveFlags(dataDir);
  await appendAudit(dataDir, {
    action: "flag_created",
    flagKey: key,
    actor: createdBy,
    flag,
  });

  logger.info({ flagKey: key }, "Feature flag created");
  return flag;
}

/**
 * Update an existing feature flag.
 *
 * @param {string} dataDir
 * @param {string} key     - Flag key.
 * @param {Object} updates - Fields to update.
 * @returns {FeatureFlag}
 */
export async function updateFlag(dataDir, key, updates) {
  const flag = flagCache.get(key);
  if (!flag) {
    throw new Error(`Flag "${key}" not found`);
  }

  const allowedFields = [
    "description",
    "type",
    "enabled",
    "defaultValue",
    "targetingRules",
    "archived",
  ];
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      flag[field] = updates[field];
    }
  }
  flag.updatedAt = Date.now();

  flagCache.set(key, flag);
  await saveFlags(dataDir);
  await appendAudit(dataDir, {
    action: "flag_updated",
    flagKey: key,
    actor: updates.updatedBy ?? "system",
    changes: updates,
  });

  logger.info({ flagKey: key }, "Feature flag updated");
  return flag;
}

/**
 * Delete a feature flag (archives it).
 *
 * @param {string} dataDir
 * @param {string} key
 * @param {string} [actor="system"]
 */
export async function archiveFlag(dataDir, key, actor = "system") {
  const flag = flagCache.get(key);
  if (!flag) {
    throw new Error(`Flag "${key}" not found`);
  }

  flag.archived = true;
  flag.updatedAt = Date.now();
  flagCache.set(key, flag);
  await saveFlags(dataDir);
  await appendAudit(dataDir, {
    action: "flag_archived",
    flagKey: key,
    actor,
  });

  logger.info({ flagKey: key }, "Feature flag archived");
}

/**
 * Evaluate a feature flag for a given user context.
 *
 * Rules are evaluated in order; the first match wins. If no rule matches,
 * the flag's `defaultValue` is returned. If the flag is disabled or
 * archived, the `defaultValue` is always returned.
 *
 * @param {string} key     - Flag key.
 * @param {Object} [context={}] - User context attributes.
 * @returns {{ value: *, variant: string, reason: string }}
 */
export function evaluate(key, context = {}) {
  const flag = flagCache.get(key);
  if (!flag) {
    return { value: undefined, variant: "default", reason: "flag_not_found" };
  }

  if (flag.archived) {
    return { value: flag.defaultValue, variant: "default", reason: "archived" };
  }

  if (!flag.enabled) {
    return { value: flag.defaultValue, variant: "default", reason: "disabled" };
  }

  for (const rule of flag.targetingRules) {
    if (matchRule(rule, context)) {
      return {
        value: rule.variant,
        variant: rule.variant,
        reason: "rule_match",
      };
    }
  }

  // No rule matched. An enabled boolean flag is effectively "on" for
  // everyone; for variant flags, fall back to the configured default.
  if (flag.type === "boolean") {
    return { value: true, variant: "on", reason: "flag_enabled" };
  }

  return {
    value: flag.defaultValue,
    variant: "default",
    reason: "no_rule_match",
  };
}

/**
 * Get all flags (optionally filtering out archived ones).
 *
 * @param {boolean} [includeArchived=false]
 * @returns {FeatureFlag[]}
 */
export function listFlags(includeArchived = false) {
  const flags = [...flagCache.values()];
  if (!includeArchived) {
    return flags.filter((f) => !f.archived);
  }
  return flags;
}

/**
 * Get a single flag by key.
 *
 * @param {string} key
 * @returns {FeatureFlag | undefined}
 */
export function getFlag(key) {
  return flagCache.get(key);
}

// ── Rule matching ─────────────────────────────────────────────────────────────

function matchRule(rule, context) {
  const val = context[rule.attribute];
  if (val === undefined) return false;

  switch (rule.operator) {
    case "eq":
      return val === rule.value;
    case "neq":
      return val !== rule.value;
    case "in":
      return Array.isArray(rule.value) && rule.value.includes(val);
    case "not_in":
      return Array.isArray(rule.value) && !rule.value.includes(val);
    case "percentage": {
      if (typeof rule.value !== "number" || rule.value < 0 || rule.value > 100) {
        return false;
      }
      const hash = simpleHash(rule.attribute + JSON.stringify(context));
      return hash % 100 < rule.value;
    }
    default:
      return false;
  }
}

function simpleHash(str) {
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = (h1 >>> 0) ^ (h2 >>> 0);
  return combined >>> 0;
}

// ── Convenience wrappers for common flag checks ───────────────────────────────

/**
 * Check if a boolean flag is enabled for a user.
 *
 * @param {string} key
 * @param {Object} [context={}]
 * @returns {boolean}
 */
export function isEnabled(key, context = {}) {
  const { value } = evaluate(key, context);
  return value === true;
}

/**
 * Get the variant string for a flag.
 *
 * @param {string} key
 * @param {Object} [context={}]
 * @returns {string}
 */
export function getVariant(key, context = {}) {
  const { variant } = evaluate(key, context);
  return variant;
}
