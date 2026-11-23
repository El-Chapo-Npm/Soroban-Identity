/**
 * Extension bridge service
 * Facilitates communication between Soroban Identity web app and the browser extension.
 */

import type { Credential } from "@soroban-identity/sdk";

export interface ExtensionStatus {
  installed: boolean;
  version?: string;
  hasPermission?: boolean;
}

export const EXTENSION_ID_KEY = "soroban_extension_installed";

/**
 * Checks whether the browser extension is installed and available.
 */
export async function checkExtensionStatus(): Promise<ExtensionStatus> {
  if (typeof window === "undefined") {
    return { installed: false };
  }

  // Check if extension injected custom window attribute or answered ping
  if ((window as any).__sorobanExtensionAvailable || (window as any).__credVerifyContentScriptLoaded) {
    return { installed: true, version: "0.1.0", hasPermission: true };
  }

  // Probe via window message
  return new Promise((resolve) => {
    let resolved = false;

    const handler = (event: MessageEvent) => {
      if (event.data && event.data.type === "SOROBAN_EXTENSION_PONG") {
        resolved = true;
        window.removeEventListener("message", handler);
        resolve({
          installed: true,
          version: event.data.version || "0.1.0",
          hasPermission: true,
        });
      }
    };

    window.addEventListener("message", handler);
    window.postMessage({ type: "SOROBAN_EXTENSION_PING" }, "*");

    setTimeout(() => {
      if (!resolved) {
        window.removeEventListener("message", handler);
        resolve({ installed: false });
      }
    }, 400);
  });
}

/**
 * Sync active credentials from web app to browser extension local storage.
 */
export async function syncCredentialsToExtension(credentials: Credential[]): Promise<boolean> {
  if (typeof window === "undefined") return false;

  return new Promise((resolve) => {
    let handled = false;

    const handler = (event: MessageEvent) => {
      if (event.data && event.data.type === "SOROBAN_CREDENTIALS_SYNCED") {
        handled = true;
        window.removeEventListener("message", handler);
        resolve(event.data.success ?? true);
      }
    };

    window.addEventListener("message", handler);

    window.postMessage(
      {
        type: "SOROBAN_SYNC_CREDENTIALS",
        credentials: credentials.map((c) => ({
          id: c.id,
          issuer: c.issuer,
          subject: c.subject,
          credentialType: c.credentialType,
          claims: c.claims,
          issuedAt: c.issuedAt,
          expiresAt: c.expiresAt,
          revoked: c.revoked,
        })),
      },
      "*"
    );

    setTimeout(() => {
      if (!handled) {
        window.removeEventListener("message", handler);
        // Fallback: try saving to localStorage with extension-accessible key
        try {
          localStorage.setItem("soroban_credentials_mirror", JSON.stringify(credentials));
          resolve(true);
        } catch {
          resolve(false);
        }
      }
    }, 500);
  });
}
