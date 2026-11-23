// Browser stand-in for the Node crypto calls the SDK makes while the
// frontend bundles that SDK. SHA-256 matches Node's createHash/createHmac.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function sha256(data: Uint8Array): Uint8Array {
  const bitLen = data.length * 8;
  const withPad = new Uint8Array(((data.length + 9 + 63) & ~63));
  withPad.set(data);
  withPad[data.length] = 0x80;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 4, bitLen >>> 0, false);
  view.setUint32(withPad.length - 8, Math.floor(bitLen / 0x100000000), false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let i = 0; i < withPad.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((word, i) => outView.setUint32(i * 4, word, false));
  return out;
}

function toBytes(data: string | Uint8Array): Uint8Array {
  if (typeof data === "string") return new TextEncoder().encode(data);
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

class Hash {
  private parts: Uint8Array[] = [];
  constructor(private readonly algorithm: string) {
    if (algorithm !== "sha256") throw new Error(`Unsupported hash ${algorithm}`);
  }
  update(data: string | Uint8Array): this {
    this.parts.push(toBytes(data));
    return this;
  }
  digest(encoding?: "hex"): Uint8Array | string {
    const total = this.parts.reduce((n, p) => n + p.length, 0);
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const part of this.parts) {
      buf.set(part, offset);
      offset += part.length;
    }
    const hash = sha256(buf);
    return encoding === "hex" ? hex(hash) : hash;
  }
}

export function createHash(algorithm: string): Hash {
  return new Hash(algorithm);
}

export function createHmac(algorithm: string, secret: string | Uint8Array): Hash {
  if (algorithm !== "sha256") throw new Error(`Unsupported hmac ${algorithm}`);
  const keyBytes = toBytes(secret);
  const block = 64;
  let key = keyBytes;
  if (key.length > block) key = sha256(key);
  const padded = new Uint8Array(block);
  padded.set(key);
  const oKey = new Uint8Array(block);
  const iKey = new Uint8Array(block);
  for (let i = 0; i < block; i++) {
    oKey[i] = padded[i] ^ 0x5c;
    iKey[i] = padded[i] ^ 0x36;
  }
  const inner = new Hash("sha256");
  inner.update(iKey);
  const outer = {
    update(data: string | Uint8Array) {
      inner.update(data);
      return outer;
    },
    digest(encoding?: "hex") {
      const innerDigest = inner.digest() as Uint8Array;
      const final = new Hash("sha256");
      final.update(oKey);
      final.update(innerDigest);
      return final.digest(encoding);
    },
  };
  return outer as unknown as Hash;
}

export function randomBytes(size: number): Uint8Array & { toString(encoding: "hex"): string } {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return Object.assign(bytes, {
    toString(encoding: "hex") {
      if (encoding !== "hex") throw new Error(`Unsupported encoding ${encoding}`);
      return hex(bytes);
    },
  });
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
