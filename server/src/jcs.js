/**
 * JSON Canonicalization Scheme — RFC 8785 (#753)
 *
 * A signature is over bytes, but a credential is an object. Two encoders can
 * serialize the same object differently (key order, whitespace, how a number
 * is rendered), and any of those differences breaks the signature. JCS pins
 * down a single byte sequence for a given JSON value so that signing and
 * verifying agree.
 *
 * This is the canonicalization the `eddsa-jcs-2022` cryptosuite requires. It
 * is used in preference to JSON-LD's URDNA2015 because it needs no context
 * resolution and no RDF dataset — the whole algorithm is below.
 */

/**
 * Serialize a number the way RFC 8785 requires (which is ECMAScript's
 * `Number::toString`, with integers rendered without a fractional part).
 *
 * @param {number} value
 * @returns {string}
 */
function serializeNumber(value) {
  if (!Number.isFinite(value)) {
    // JSON has no representation for these, and silently emitting `null`
    // would produce a signature over data the caller did not intend.
    throw new TypeError('NaN and Infinity cannot be canonicalized');
  }
  // -0 canonicalizes to 0; JSON.stringify already does this, and String()
  // does not.
  if (value === 0) return '0';
  return JSON.stringify(value);
}

/**
 * Escape a string per RFC 8785, which mandates the shortest valid escape for
 * each character.
 *
 * `JSON.stringify` already implements exactly these rules for strings, so it
 * is used rather than reimplemented — including its handling of lone
 * surrogates, which a hand-rolled escaper reliably gets wrong.
 *
 * @param {string} value
 * @returns {string}
 */
function serializeString(value) {
  return JSON.stringify(value);
}

/**
 * Produce the canonical JSON representation of a value.
 *
 * Object keys are sorted by their UTF-16 code units, which is what
 * `Array.prototype.sort` does by default and what the specification requires.
 * Properties whose value is `undefined`, and functions, are dropped exactly as
 * `JSON.stringify` drops them.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalize(value) {
  if (value === null) return 'null';

  const type = typeof value;

  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'number') return serializeNumber(value);
  if (type === 'string') return serializeString(value);

  if (type === 'bigint') {
    throw new TypeError('BigInt cannot be canonicalized');
  }

  if (Array.isArray(value)) {
    // An undefined element serializes as null inside an array, matching
    // JSON.stringify — dropping it instead would change the array's length.
    const items = value.map((item) =>
      item === undefined || typeof item === 'function' ? 'null' : canonicalize(item),
    );
    return `[${items.join(',')}]`;
  }

  if (type === 'object') {
    // Honour toJSON so Date and friends canonicalize as they would serialize.
    if (typeof value.toJSON === 'function') {
      return canonicalize(value.toJSON());
    }

    const keys = Object.keys(value).sort();
    const members = [];

    for (const key of keys) {
      const item = value[key];
      if (item === undefined || typeof item === 'function') continue;
      members.push(`${serializeString(key)}:${canonicalize(item)}`);
    }

    return `{${members.join(',')}}`;
  }

  throw new TypeError(`Cannot canonicalize value of type ${type}`);
}
