export interface EncryptedEnvelope {
  iv: string;
  ciphertext: string;
  tag: string;
  kid?: string;
  alg?: string;
}

export class SessionEncryption {
  private ecdh?: any;
  private key?: any;

  constructor() {
    try {
      if (typeof window === "undefined") {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const crypto = require("crypto");
        this.ecdh = crypto.createECDH?.("prime256v1");
        this.ecdh?.generateKeys();
      }
    } catch {
      // browser environment
    }
  }

  exportPublicKey(): string {
    if (this.ecdh) {
      return this.ecdh.getPublicKey("base64");
    }
    return "";
  }

  deriveSharedKey(serverPublicKey: string): void {
    try {
      if (this.ecdh && typeof window === "undefined") {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const crypto = require("crypto");
        const rawShared = this.ecdh.computeSecret(serverPublicKey, "base64");
        this.key = crypto.createHash("sha256").update(rawShared).digest();
        return;
      }
    } catch {
      // fallback
    }
    this.key = typeof Buffer !== "undefined" ? Buffer.from(serverPublicKey, "base64") : null;
  }

  encrypt(plaintext: string): EncryptedEnvelope {
    if (typeof window === "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const crypto = require("crypto");
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
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
    if (typeof window === "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const crypto = require("crypto");
      const iv = Buffer.from(envelope.iv, "base64");
      const tag = Buffer.from(envelope.tag, "base64");
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(tag);
      let plaintext = decipher.update(envelope.ciphertext, "base64", "utf8");
      plaintext += decipher.final("utf8");
      return plaintext;
    }
    return envelope.ciphertext;
  }
}
