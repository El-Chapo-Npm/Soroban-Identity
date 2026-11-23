import * as LocalAuthentication from 'expo-local-authentication';
import * as Keychain from 'react-native-keychain';
import { Platform } from 'react-native';

export type BiometricType = 'face' | 'fingerprint' | 'iris' | 'none';

export interface BiometricCapabilities {
  hasHardware: boolean;
  isEnrolled: boolean;
  supportedTypes: BiometricType[];
  primaryType: BiometricType;
}

const DEFAULT_SERVICE = 'com.soroban.identity.biometric';

/**
 * Detect the biometric capabilities of the current device and determine
 * the primary biometric modality (Face ID vs Touch ID vs fingerprint).
 */
export async function getBiometricCapabilities(): Promise<BiometricCapabilities> {
  const [hasHardware, isEnrolled, supportedTypes] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);

  const types: BiometricType[] = [];
  for (const t of supportedTypes) {
    switch (t) {
      case LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION:
        types.push('face');
        break;
      case LocalAuthentication.AuthenticationType.FINGERPRINT:
        types.push('fingerprint');
        break;
      case LocalAuthentication.AuthenticationType.IRIS:
        types.push('iris');
        break;
      default:
        break;
    }
  }

  let primaryType: BiometricType = 'none';
  if (types.includes('face')) primaryType = 'face';
  else if (types.includes('fingerprint')) primaryType = 'fingerprint';
  else if (types.includes('iris')) primaryType = 'iris';

  return { hasHardware, isEnrolled, supportedTypes: types, primaryType };
}

/**
 * Build a platform-appropriate prompt message for the given biometric type.
 */
export function getBiometricPrompt(
  type: BiometricType,
  fallbackReason = 'Unlock Soroban Identity',
): string {
  switch (type) {
    case 'face':
      return Platform.OS === 'ios' ? 'Authenticate with Face ID' : fallbackReason;
    case 'fingerprint':
      return Platform.OS === 'ios' ? 'Authenticate with Touch ID' : fallbackReason;
    case 'iris':
      return 'Authenticate with Iris Scan';
    default:
      return fallbackReason;
  }
}

/**
 * Authenticate the user using biometrics, falling back to the device
 * passcode when biometrics are unavailable or not enrolled.
 */
export async function authenticate(reason = 'Unlock Soroban Identity'): Promise<boolean> {
  const { hasHardware, isEnrolled, primaryType } = await getBiometricCapabilities();

  // Devices without biometrics fall back to the device passcode.
  if (!hasHardware || !isEnrolled) {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      disableDeviceFallback: false,
    });
    return result.success;
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: getBiometricPrompt(primaryType, reason),
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
  });
  return result.success;
}

/**
 * Enroll biometrics by verifying the user can authenticate and then
 * marking the keychain as biometric-protected for this service.
 */
export async function enrollBiometrics(
  reason = 'Enable biometric unlock for Soroban Identity',
): Promise<boolean> {
  const { hasHardware, isEnrolled } = await getBiometricCapabilities();
  if (!hasHardware || !isEnrolled) {
    return false;
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    disableDeviceFallback: false,
  });
  if (!result.success) {
    return false;
  }

  // Persist an enrollment marker gated by biometrics.
  await Keychain.setGenericPassword('enrolled', 'true', {
    service: `${DEFAULT_SERVICE}.enrollment`,
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return true;
}

/**
 * Check whether biometrics have previously been enrolled for this app.
 */
export async function isBiometricsEnrolled(): Promise<boolean> {
  try {
    const credentials = await Keychain.getGenericPassword({
      service: `${DEFAULT_SERVICE}.enrollment`,
    });
    return credentials !== false && credentials.password === 'true';
  } catch {
    return false;
  }
}

/**
 * Remove the biometric enrollment marker.
 */
export async function disableBiometrics(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: `${DEFAULT_SERVICE}.enrollment` });
  } catch {
    // Ignore errors when clearing enrollment.
  }
}

/**
 * Store a secret in the keychain, protected by biometrics with a device
 * passcode fallback.
 */
export async function storeSecret(
  key: string,
  value: string,
  service: string = DEFAULT_SERVICE,
): Promise<boolean> {
  try {
    await Keychain.setGenericPassword(key, value, {
      service,
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Retrieve a secret from the keychain. Access is gated by biometrics with a
 * device passcode fallback.
 */
export async function retrieveSecret(
  service: string = DEFAULT_SERVICE,
): Promise<string | null> {
  try {
    const credentials = await Keychain.getGenericPassword({ service });
    if (credentials === false) return null;
    return credentials.password;
  } catch {
    return null;
  }
}

/**
 * Delete a stored secret from the keychain.
 */
export async function deleteSecret(service: string = DEFAULT_SERVICE): Promise<boolean> {
  try {
    return await Keychain.resetGenericPassword({ service });
  } catch {
    return false;
  }
}