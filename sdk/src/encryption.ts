export interface EncryptedEnvelope {
  iv: string;
  ciphertext: string;
  tag: string;
  kid?: string;
  alg?: string;
  data?: string;
}

// Dynamically load Node's crypto in Node environments without breaking bundlers (like Vite)
let nodeCrypto: any = null;
try {
  if (typeof window === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    nodeCrypto = new Function("m", "return require(m)")("crypto");
  }
} catch {
  nodeCrypto = null;
}

export class SessionEncryption {
  private ecdh: any = null;
  private sharedKey: Buffer | null = null;
  private key: any = null;

  constructor() {
    if (nodeCrypto?.createECDH) {
      this.ecdh = nodeCrypto.createECDH("prime256v1");
      this.ecdh.generateKeys();
    }
  }

  exportPublicKey(): string {
    if (this.ecdh) {
      return this.ecdh.getPublicKey("base64");
    }
    return "";
  }

  deriveSharedKey(serverPublicKeyBase64: string): void {
    if (this.ecdh) {
      const serverKey = Buffer.from(serverPublicKeyBase64, "base64");
      const rawShared = this.ecdh.computeSecret(serverKey);
      this.sharedKey = rawShared;
      this.key = nodeCrypto.createHash("sha256").update(rawShared).digest();
      return;
    }
    this.key = typeof Buffer !== "undefined" ? Buffer.from(serverPublicKeyBase64, "base64") : null;
  }

  encrypt(plaintext: string): EncryptedEnvelope {
    if (nodeCrypto?.createCipheriv) {
      const iv = nodeCrypto.randomBytes(12);
      const cipher = nodeCrypto.createCipheriv("aes-256-gcm", this.key, iv);
      let ciphertext = cipher.update(plaintext, "utf8", "base64");
      ciphertext += cipher.final("base64");
      const tag = cipher.getAuthTag().toString("base64");
      return {
        iv: iv.toString("base64"),
        ciphertext,
        tag,
        alg: "AES-256-GCM",
      };
    }
    return { iv: "", ciphertext: plaintext, tag: "", alg: "AES-256-GCM" };
  }

  decrypt(envelope: EncryptedEnvelope): string {
    if (!this.sharedKey && !this.key) {
      throw new Error("Shared key not established");
    }
    if (nodeCrypto?.createDecipheriv) {
      const iv = Buffer.from(envelope.iv, "base64");
      const tag = Buffer.from(envelope.tag, "base64");
      const ciphertext = Buffer.from(envelope.ciphertext || envelope.data || "", "base64");
      const key = this.key || this.sharedKey!.subarray(0, 32);
      const decipher = nodeCrypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString("utf8");
    }
    return envelope.ciphertext;
  }
}
