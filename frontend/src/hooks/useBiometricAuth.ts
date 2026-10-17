import { useState, useEffect, useCallback, useRef } from "react";

export type SensitiveOperation =
  | "credential_issuance"
  | "credential_revocation"
  | "private_key_export";

export interface BiometricDevice {
  id: string;
  credentialId: string; // Base64 encoded credential ID
  name: string;
  registeredAt: number;
  publicKey?: string;
  transports?: AuthenticatorTransport[];
  lastUsedAt?: number;
}

export interface DeviceManagementApi {
  devices: BiometricDevice[];
  removeDevice: (deviceId: string) => void;
  renameDevice: (deviceId: string, name: string) => void;
  refresh: () => void;
}

export type BiometricErrorCode =
  | "unsupported_browser"
  | "platform_authenticator_unavailable"
  | "registration_failed"
  | "authentication_failed"
  | "no_devices_registered"
  | "storage_failure"
  | "cancelled";

export class BiometricError extends Error {
  code: BiometricErrorCode;
  constructor(code: BiometricErrorCode, message: string) {
    super(message);
    this.name = "BiometricError";
    this.code = code;
  }
}

export interface BiometricPreferences {
  enabledOperations: Record<SensitiveOperation, boolean>;
  fallbackToWallet: boolean;
  maxRetries: number;
}

export interface BiometricPromptState {
  isOpen: boolean;
  operation: SensitiveOperation;
  contextMessage: string;
  attempt: number;
  maxRetries: number;
  status: "idle" | "prompting" | "failed" | "retrying" | "success" | "falling_back";
  error: string | null;
}

export interface AuthenticateOptions {
  contextMessage?: string;
  fallbackSigner?: (challenge: string) => Promise<string>;
}

export interface AuthenticationResult {
  success: boolean;
  method: "biometric" | "wallet_signature" | "none";
  credentialId?: string;
  signature?: string;
  error?: string;
}

const DEVICES_STORAGE_KEY = "soroban_biometric_registered_devices_encrypted";
const PREFS_STORAGE_KEY = "soroban_biometric_prefs_encrypted";
const DEVICE_SALT_KEY = "soroban_biometric_device_salt";

// Browser compatibility notes (documented for consumers of this hook):
// - Chrome/Edge 67+ (desktop & Android): platform authenticators supported.
// - Safari 13+ (macOS): Touch ID supported via platform authenticator.
// - Safari 14+ (iOS): Face ID / Touch ID supported.
// - Firefox 60+: WebAuthn supported; platform authenticator availability varies.
// - Windows Hello supported on Chrome/Edge/Firefox.
// Fallback to wallet/password is provided when WebAuthn is unavailable.
export const BROWSER_COMPATIBILITY_NOTES =
  "WebAuthn biometric auth requires Chrome/Edge 67+, Safari 13+ (macOS), Safari 14+ (iOS), or Firefox 60+. Windows Hello is supported on Chromium/Firefox. A wallet/password fallback is used otherwise.";

// Helper utilities for ArrayBuffer and Base64 conversion
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function getRandomBytes(length: number = 32): Uint8Array {
  const array = new Uint8Array(length);
  if (typeof window !== "undefined" && window.crypto) {
    window.crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < length; i++) array[i] = Math.floor(Math.random() * 256);
  }
  return array;
}

// Encrypt and store preferences using Web Crypto API AES-GCM
async function getDeviceKey(): Promise<CryptoKey | null> {
  if (typeof window === "undefined" || !window.crypto?.subtle) return null;
  let salt = localStorage.getItem(DEVICE_SALT_KEY);
  if (!salt) {
    salt = bufferToBase64(getRandomBytes(16).buffer as ArrayBuffer);
    localStorage.setItem(DEVICE_SALT_KEY, salt);
  }

  const enc = new TextEncoder();
  const rawKeyMaterial = enc.encode(`soroban-device-key-${salt}`);
  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    rawKeyMaterial,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(base64ToBuffer(salt)),
      iterations: 50000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptData(data: object): Promise<string | null> {
  try {
    const key = await getDeviceKey();
    if (!key || typeof window === "undefined" || !window.crypto?.subtle) return null;
    const iv = getRandomBytes(12);
    const enc = new TextEncoder();
    const encodedData = enc.encode(JSON.stringify(data));
    const encrypted = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      encodedData
    );
    return JSON.stringify({
      iv: bufferToBase64(iv.buffer as ArrayBuffer),
      data: bufferToBase64(encrypted),
    });
  } catch {
    return null;
  }
}

async function decryptData<T>(ciphertextJson: string): Promise<T | null> {
  try {
    const parsed = JSON.parse(ciphertextJson);
    if (!parsed.iv || !parsed.data) return null;
    const key = await getDeviceKey();
    if (!key || typeof window === "undefined" || !window.crypto?.subtle) return null;
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(base64ToBuffer(parsed.iv)) },
      key,
      base64ToBuffer(parsed.data)
    );
    const dec = new TextDecoder();
    return JSON.parse(dec.decode(decrypted));
  } catch {
    return null;
  }
}

const DEFAULT_PREFERENCES: BiometricPreferences = {
  enabledOperations: {
    credential_issuance: true,
    credential_revocation: true,
    private_key_export: true,
  },
  fallbackToWallet: true,
  maxRetries: 3,
};

export function useBiometricAuth() {
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [isPlatformAuthenticatorAvailable, setIsPlatformAuthenticatorAvailable] = useState<boolean>(false);
  const [devices, setDevices] = useState<BiometricDevice[]>([]);
  const [preferences, setPreferences] = useState<BiometricPreferences>(DEFAULT_PREFERENCES);
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [promptState, setPromptState] = useState<BiometricPromptState | null>(null);

  const activeAuthParamsRef = useRef<{
    operation: SensitiveOperation;
    options?: AuthenticateOptions;
    resolve: (res: AuthenticationResult) => void;
    currentAttempt: number;
  } | null>(null);

  // 1. Detect browser compatibility and platform authenticator
  useEffect(() => {
    const checkSupport = async () => {
      const supported =
        typeof window !== "undefined" &&
        window.PublicKeyCredential !== undefined &&
        navigator.credentials !== undefined &&
        typeof navigator.credentials.create === "function" &&
        typeof navigator.credentials.get === "function";

      setIsSupported(supported);

      if (supported && typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
        try {
          const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
          setIsPlatformAuthenticatorAvailable(available);
        } catch {
          setIsPlatformAuthenticatorAvailable(false);
        }
      }
    };

    checkSupport();
  }, []);

  // 2. Load devices & encrypted preferences
  useEffect(() => {
    const load = async () => {
      try {
        const storedDevices = localStorage.getItem(DEVICES_STORAGE_KEY);
        if (storedDevices) {
          const decrypted = await decryptData<BiometricDevice[]>(storedDevices);
          if (decrypted) {
            setDevices(decrypted);
          } else {
            // Backwards compatibility: legacy plaintext storage
            try {
              const legacy = JSON.parse(storedDevices);
              if (Array.isArray(legacy)) setDevices(legacy);
            } catch {
              /* ignore */
            }
          }
        }

        const encryptedPrefs = localStorage.getItem(PREFS_STORAGE_KEY);
        if (encryptedPrefs) {
          const prefs = await decryptData<BiometricPreferences>(encryptedPrefs);
          if (prefs) setPreferences(prefs);
        }
      } catch {
        // Storage access gracefully handled
      }
    };
    load();
  }, []);

  // Save devices (encrypted at rest)
  const saveDevices = useCallback(async (newDevices: BiometricDevice[]) => {
    setDevices(newDevices);
    try {
      const encrypted = await encryptData(newDevices);
      if (encrypted) {
        localStorage.setItem(DEVICES_STORAGE_KEY, encrypted);
      } else {
        throw new BiometricError(
          "storage_failure",
          "Unable to securely encrypt biometric device metadata."
        );
      }
    } catch (e) {
      console.warn("Could not save biometric devices to storage", e);
    }
  }, []);

  // Save preferences with encryption
  const updatePreferences = useCallback(
    async (newPrefs: Partial<BiometricPreferences>) => {
      const merged: BiometricPreferences = {
        ...preferences,
        ...newPrefs,
        enabledOperations: {
          ...preferences.enabledOperations,
          ...(newPrefs.enabledOperations || {}),
        },
      };
      setPreferences(merged);

      try {
        const encrypted = await encryptData(merged);
        if (encrypted) {
          localStorage.setItem(PREFS_STORAGE_KEY, encrypted);
        } else {
          localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(merged));
        }
      } catch {
        localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(merged));
      }
    },
    [preferences]
  );

  // Register device using WebAuthn API (registration ceremony)
  const registerDevice = useCallback(
    async (deviceName?: string): Promise<BiometricDevice> => {
      if (!isSupported) {
        throw new BiometricError(
          "unsupported_browser",
          "WebAuthn is not supported on this browser. Please use password or wallet authentication."
        );
      }

      if (!isPlatformAuthenticatorAvailable) {
        throw new BiometricError(
          "platform_authenticator_unavailable",
          "No platform authenticator (Touch ID, Face ID, Windows Hello) is available on this device."
        );
      }

      const userId = getRandomBytes(16);
      const challenge = getRandomBytes(32);
      const name =
        deviceName ||
        (typeof navigator !== "undefined"
          ? navigator.userAgent.slice(0, 30)
          : "Biometric Device");

      const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
        challenge: challenge.buffer as ArrayBuffer,
        rp: {
          name: "Soroban Identity",
          id: typeof window !== "undefined" ? window.location.hostname : "localhost",
        },
        user: {
          id: userId.buffer as ArrayBuffer,
          name: "Soroban User",
          displayName: "Soroban Identity User",
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" }, // ES256
          { alg: -257, type: "public-key" }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
          requireResidentKey: false,
        },
        timeout: 60000,
        attestation: "none",
      };

      let credential: PublicKeyCredential | null = null;
      try {
        credential = (await navigator.credentials.create({
          publicKey: publicKeyCredentialCreationOptions,
        })) as PublicKeyCredential | null;
      } catch (err: any) {
        if (err?.name === "NotAllowedError") {
          throw new BiometricError(
            "cancelled",
            "Biometric registration was cancelled or timed out."
          );
        }
        throw new BiometricError(
          "registration_failed",
          err?.message || "Failed to register biometric authenticator."
        );
      }

      if (!credential) {
        throw new BiometricError(
          "registration_failed",
          "Failed to register biometric authenticator."
        );
      }

      const response = credential.response as AuthenticatorAttestationResponse;
      const transports =
        typeof response.getTransports === "function"
          ? (response.getTransports() as AuthenticatorTransport[])
          : undefined;

      const newDevice: BiometricDevice = {
        id: `device-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        credentialId: bufferToBase64(credential.rawId),
        name,
        registeredAt: Date.now(),
        transports,
      };

      const updated = [...devices, newDevice];
      await saveDevices(updated);
      return newDevice;
    },
    [isSupported, isPlatformAuthenticatorAvailable, devices, saveDevices]
  );

  // Revoke device
  const revokeDevice = useCallback(
    async (deviceId: string) => {
      const updated = devices.filter((d) => d.id !== deviceId);
      await saveDevices(updated);
    },
    [devices, saveDevices]
  );

  // Rename a registered device
  const renameDevice = useCallback(
    async (deviceId: string, name: string) => {
      const updated = devices.map((d) => (d.id === deviceId ? { ...d, name } : d));
      await saveDevices(updated);
    },
    [devices, saveDevices]
  );

  // Refresh devices from storage
  const refreshDevices = useCallback(async () => {
    try {
      const stored = localStorage.getItem(DEVICES_STORAGE_KEY);
      if (!stored) {
        setDevices([]);
        return;
      }
      const decrypted = await decryptData<BiometricDevice[]>(stored);
      if (decrypted) setDevices(decrypted);
    } catch {
      /* ignore */
    }
  }, []);

  // Fallback to wallet signature helper
  const performWalletFallback = useCallback(
    async (
      operation: SensitiveOperation,
      options?: AuthenticateOptions
    ): Promise<AuthenticationResult> => {
      if (options?.fallbackSigner) {
        try {
          setPromptState((prev) =>
            prev
              ? {
                  ...prev,
                  status: "falling_back",
                  contextMessage: "Biometric unavailable. Requesting wallet signature...",
                }
              : null
          );
          const challenge = `Soroban-Auth:${operation}:${Date.now()}`;
          const signature = await options.fallbackSigner(challenge);
          setPromptState(null);
          setIsAuthenticating(false);
          return {
            success: true,
            method: "wallet_signature",
            signature,
          };
        } catch (err: any) {
          const msg = err?.message || "Wallet signature fallback failed";
          setAuthError(msg);
          setPromptState(null);
          setIsAuthenticating(false);
          return { success: false, method: "wallet_signature", error: msg };
        }
      }
      return {
        success: false,
        method: "none",
        error: "Biometric authentication failed and no wallet fallback signer was provided",
      };
    },
    []
  );

  // Execute WebAuthn Assertion (authentication ceremony)
  const executeBiometricGet = useCallback(
    async (credentialIdBase64: string): Promise<PublicKeyCredential | null> => {
      const challenge = getRandomBytes(32);
      const allowCredentials: PublicKeyCredentialDescriptor[] = [
        {
          id: base64ToBuffer(credentialIdBase64),
          type: "public-key",
        },
      ];

      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: challenge.buffer as ArrayBuffer,
          allowCredentials,
          timeout: 60000,
          userVerification: "required",
        },
      })) as PublicKeyCredential | null;

      return assertion;
    },
    []
  );

  // Main internal biometric attempt handler with retry loop
  const attemptBiometric = useCallback(
    async (attempt: number): Promise<void> => {
      const active = activeAuthParamsRef.current;
      if (!active) return;

      const { operation, options, resolve } = active;
      const primaryDevice = devices[0];

      setPromptState({
        isOpen: true,
        operation,
        contextMessage:
          options?.contextMessage ||
          `Biometric confirmation requested for ${operation.replace(/_/g, " ")}.`,
        attempt,
        maxRetries: preferences.maxRetries,
        status: attempt > 1 ? "retrying" : "prompting",
        error: null,
      });

      try {
        const assertion = await executeBiometricGet(primaryDevice.credentialId);
        if (assertion) {
          setPromptState((prev) => (prev ? { ...prev, status: "success" } : null));
          // Update last-used metadata for the device
          const updatedDevices = devices.map((d) =>
            d.id === primaryDevice.id ? { ...d, lastUsedAt: Date.now() } : d
          );
          saveDevices(updatedDevices);
          setTimeout(() => {
            setPromptState(null);
            setIsAuthenticating(false);
            activeAuthParamsRef.current = null;
            resolve({
              success: true,
              method: "biometric",
              credentialId: primaryDevice.credentialId,
            });
          }, 600);
          return;
        }
        throw new Error("Biometric authentication verification returned empty.");
      } catch (err: any) {
        const errorMsg = err?.message || "Biometric authentication failed.";
        setAuthError(errorMsg);

        if (attempt < preferences.maxRetries) {
          setPromptState((prev) =>
            prev
              ? {
                  ...prev,
                  status: "failed",
                  error: `${errorMsg} Retrying (${attempt + 1}/${preferences.maxRetries})...`,
                }
              : null
          );
          // Wait briefly before allowing retry
          setTimeout(() => {
            attemptBiometric(attempt + 1);
          }, 1000);
        } else {
          // Reached max retries, fallback if enabled
          if (preferences.fallbackToWallet && options?.fallbackSigner) {
            setPromptState((prev) =>
              prev
                ? {
                    ...prev,
                    status: "falling_back",
                    error: "Biometric attempts exhausted. Falling back to wallet signature...",
                  }
                : null
            );
            const fallbackResult = await performWalletFallback(operation, options);
            activeAuthParamsRef.current = null;
            resolve(fallbackResult);
          } else {
            setPromptState((prev) =>
              prev
                ? {
                    ...prev,
                    status: "failed",
                    error: errorMsg,
                  }
                : null
            );
            setIsAuthenticating(false);
            activeAuthParamsRef.current = null;
            resolve({
              success: false,
              method: "biometric",
              error: errorMsg,
            });
          }
        }
      }
    },
    [devices, preferences, executeBiometricGet, performWalletFallback, saveDevices]
  );

  // Authenticate sensitive operation
  const authenticateOperation = useCallback(
    async (
      operation: SensitiveOperation,
      options?: AuthenticateOptions
    ): Promise<AuthenticationResult> => {
      // Check if this operation requires biometric authentication
      if (!preferences.enabledOperations[operation]) {
        return { success: true, method: "none" };
      }

      setIsAuthenticating(true);
      setAuthError(null);

      // Graceful degradation: If not supported or no devices registered, fallback or pass through
      if (!isSupported || devices.length === 0) {
        if (!isSupported) {
          setAuthError(
            "Biometric authentication is not supported on this browser. " +
              BROWSER_COMPATIBILITY_NOTES
          );
        } else {
          setAuthError(
            "No biometric devices registered. Register a device or use password/wallet authentication."
          );
        }
        if (preferences.fallbackToWallet && options?.fallbackSigner) {
          return performWalletFallback(operation, options);
        }
        setIsAuthenticating(false);
        return {
          success: true,
          method: "none",
        };
      }

      return new Promise<AuthenticationResult>((resolve) => {
        activeAuthParamsRef.current = {
          operation,
          options,
          resolve,
          currentAttempt: 1,
        };
        attemptBiometric(1);
      });
    },
    [preferences, isSupported, devices, performWalletFallback, attemptBiometric]
  );

  // Retry currently pending authentication manually
  const retryAuthentication = useCallback(async (): Promise<void> => {
    if (!activeAuthParamsRef.current) return;
    attemptBiometric(1);
  }, [attemptBiometric]);

  // Cancel prompt
  const cancelAuthentication = useCallback(() => {
    if (activeAuthParamsRef.current) {
      activeAuthParamsRef.current.resolve({
        success: false,
        method: "biometric",
        error: "Authentication cancelled by user",
      });
      activeAuthParamsRef.current = null;
    }
    setPromptState(null);
    setIsAuthenticating(false);
  }, []);

  // Device management API
  const deviceManagement: DeviceManagementApi = {
    devices,
    removeDevice: revokeDevice,
    renameDevice,
    refresh: refreshDevices,
  };

  return {
    isSupported,
    isPlatformAuthenticatorAvailable,
    isEnabled: Object.values(preferences.enabledOperations).some(Boolean),
    devices,
    preferences,
    isAuthenticating,
    authError,
    promptState,
    registerDevice,
    revokeDevice,
    renameDevice,
    refreshDevices,
    updatePreferences,
    authenticateOperation,
    retryAuthentication,
    cancelAuthentication,
    deviceManagement,
    browserCompatibilityNotes: BROWSER_COMPATIBILITY_NOTES,
  };
}

export default useBiometricAuth;
