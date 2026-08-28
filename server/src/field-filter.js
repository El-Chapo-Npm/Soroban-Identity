/**
 * Sparse fieldsets (#747)
 *
 * Lets a client request `?fields=a,b.c` to receive only the named top-level
 * or dotted nested paths, trimming payload size for clients that only need a
 * few fields off a large resource.
 */

/** Parse a comma-separated `fields` query value into trimmed, deduplicated paths. */
export function parseFields(fieldsParam) {
  if (!fieldsParam) return null;
  const paths = [...new Set(
    String(fieldsParam)
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
  )];
  return paths.length > 0 ? paths : null;
}

/**
 * Validate requested field paths against a resource's known field names.
 * Only the first segment of a dotted path (`claims.name` -> `claims`) needs
 * to be a known field — nested structure below that is not schema-checked.
 *
 * @returns {string[]} Unknown top-level field names, empty when all are valid.
 */
export function validateFields(paths, allowedFields) {
  const allowed = new Set(allowedFields);
  const unknown = new Set();
  for (const p of paths) {
    const top = p.split('.')[0];
    if (!allowed.has(top)) unknown.add(top);
  }
  return [...unknown];
}

function getPath(obj, segments) {
  let current = obj;
  for (const segment of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[segment];
  }
  return current;
}

function setPath(obj, segments, value) {
  let current = obj;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (typeof current[segment] !== 'object' || current[segment] === null) {
      current[segment] = {};
    }
    current = current[segment];
  }
  current[segments[segments.length - 1]] = value;
}

/**
 * Project a single object down to the requested dotted field paths.
 * A path whose value is `undefined` on the source object is omitted rather
 * than written as `undefined`, so the result only ever contains fields that
 * were actually present.
 *
 * @param {object} resource
 * @param {string[]} paths
 * @returns {object}
 */
export function selectFields(resource, paths) {
  const result = {};
  for (const path of paths) {
    const segments = path.split('.');
    const value = getPath(resource, segments);
    if (value !== undefined) setPath(result, segments, value);
  }
  return result;
}

/**
 * Apply field selection to either a single resource or an array of them.
 * Returns the input unchanged when `fieldsParam` is absent.
 *
 * @param {object|object[]} data
 * @param {string|null|undefined} fieldsParam - raw `?fields=` query value
 * @param {string[]} allowedFields - known top-level field names for validation
 * @returns {{data: object|object[], error?: string}}
 */
export function applyFieldFiltering(data, fieldsParam, allowedFields) {
  const paths = parseFields(fieldsParam);
  if (!paths) return { data };

  const unknown = validateFields(paths, allowedFields);
  if (unknown.length > 0) {
    return { error: `Unknown field(s): ${unknown.join(', ')}` };
  }

  if (Array.isArray(data)) {
    return { data: data.map((item) => selectFields(item, paths)) };
  }
  return { data: selectFields(data, paths) };
}
