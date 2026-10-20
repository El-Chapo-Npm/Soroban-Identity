import * as LocalAuthentication from 'expo-local-authentication';

export type BiometricType = 'fingerprint' | 'face' | 'iris' | 'unknown';

export interface BiometricCapabilities {
  hasHardware: boolean;
  isEnrolled: boolean;
  supportedTypes: BiometricType[];
}

export type BiometricError =
  | 'not_available'
  | 'not_enrolled'
  | 'user_cancel'
  | 'lockout'
  | 'authentication_failed'
  | 'unknown';

export interface AuthenticateOptions {
  reason?: string;
  fallbackToPasscode?: boolean;
}

export interface AuthenticateResult {
  success: boolean;
  error?: BiometricError;
  warning?: string;
}

function mapAuthenticationType(type: LocalAuthentication.AuthenticationType): BiometricType {
  switch (type) {
    case LocalAuthentication.AuthenticationType.FINGERPRINT:
      return 'fingerprint';
    case LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION:
      return 'face';
    case LocalAuthentication.AuthenticationType.IRIS:
      return 'iris';
    default:
      return 'unknown';
  }
}

function mapError(error: string): BiometricError {
  switch (error) {
    case 'not_available':
    case 'not_enrolled':
    case 'user_cancel':
    case 'lockout':
    case 'authentication_failed':
      return error;
    default:
      return 'unknown';
  }
}

export async function getBiometricCapabilities(): Promise<BiometricCapabilities> {
  const [hasHardware, isEnrolled, supportedTypes] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);

  return {
    hasHardware,
    isEnrolled,
    supportedTypes: supportedTypes.map(mapAuthenticationType),
  };
}

export async function authenticate(options: AuthenticateOptions = {}): Promise<AuthenticateResult> {
  const { reason = 'Unlock Soroban Identity', fallbackToPasscode = true } = options;

  const { hasHardware, isEnrolled } = await getBiometricCapabilities();

  // Devices without biometrics fall back to the device passcode when allowed.
  if (!hasHardware || !isEnrolled) {
    if (!fallbackToPasscode) {
      return {
        success: false,
        error: !hasHardware ? 'not_available' : 'not_enrolled',
        warning: !hasHardware
          ? 'Biometric hardware is not available on this device.'
          : 'No biometrics are enrolled on this device.',
      };
    }

    const fallbackResult = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      disableDeviceFallback: false,
    });

    if (fallbackResult.success) {
      return {
        success: true,
        warning: !hasHardware
          ? 'Biometric hardware is not available; authenticated with device passcode.'
          : 'No biometrics enrolled; authenticated with device passcode.',
      };
    }

    return {
      success: false,
      error: mapError(fallbackResult.error),
    };
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    disableDeviceFallback: !fallbackToPasscode,
  });

  if (result.success) {
    return { success: true };
  }

  return {
    success: false,
    error: mapError(result.error),
  };
}