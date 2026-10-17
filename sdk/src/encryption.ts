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

export interface EncryptedEnvelope {
  iv: string;
  ciphertext: string;
  tag: string;
  kid?: string;
  data?: string;
}

export class SessionEncryption {
  private ecdh: any = null;
  private sharedKey: Buffer | null = null;

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
      this.sharedKey = this.ecdh.computeSecret(serverKey);
    }
  }

  decrypt(envelope: EncryptedEnvelope): string {
    if (!this.sharedKey) {
      throw new Error("Shared key not established");
    }
    if (nodeCrypto?.createDecipheriv) {
      const iv = Buffer.from(envelope.iv, "base64");
      const tag = Buffer.from(envelope.tag, "base64");
      const ciphertext = Buffer.from(envelope.ciphertext || envelope.data || "", "base64");
      const key = this.sharedKey.subarray(0, 32);
      const decipher = nodeCrypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString("utf8");
    }
    throw new Error("Decryption not supported in this environment");
  }
}
