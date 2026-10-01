import * as LocalAuthentication from 'expo-local-authentication';

export async function authenticate(reason = 'Unlock Soroban Identity'): Promise<boolean> {
  const [hasHardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  // Devices without biometrics fall back to the device passcode.
  if (!hasHardware || !enrolled) return (await LocalAuthentication.authenticateAsync({ promptMessage: reason })).success;
  const result = await LocalAuthentication.authenticateAsync({ promptMessage: reason, disableDeviceFallback: false });
  return result.success;
}
