import { CameraView, useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Button, Text, View } from 'react-native';
import { authenticateWithBiometrics } from '../services/biometrics';
import { credentials } from '../services/identity';
import { enqueueVerification, isOnline } from '../services/offlineQueue';

// Expects QR payloads of the form sorobanid://verify?id=<credentialId>&caller=<G...>
// Also accepts deep links (e.g. sorobanid://verify/...) routed here via React Navigation.
type ScanPayload = { id: string; caller: string };

function parsePayload(data: string): ScanPayload {
  let url: URL;
  try {
    url = new URL(data);
  } catch {
    throw new Error('Invalid QR code');
  }
  if (url.protocol !== 'sorobanid:') {
    throw new Error('Not a Soroban Identity credential QR');
  }
  const id = url.searchParams.get('id');
  const caller = url.searchParams.get('caller');
  if (!id || !caller) throw new Error('Not a Soroban Identity credential QR');
  return { id, caller };
}

export default function ScannerScreen({ route }: { route?: { params?: { payload?: string } } }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handledDeepLink = useRef<string | null>(null);

  const handlePayload = useCallback(async (data: string) => {
    setBusy(true);
    setError(null);
    try {
      const { id, caller } = parsePayload(data);

      const authenticated = await authenticateWithBiometrics();
      if (!authenticated) {
        setError('Biometric authentication is required to present credentials');
        return;
      }

      if (!(await isOnline())) {
        await enqueueVerification(caller, id);
        setResult('Offline — verification queued and will run when you reconnect.');
        return;
      }

      setResult('Verifying…');
      setResult(JSON.stringify(await credentials.verifyCredential(caller, id), null, 2));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  // Handle deep-linked payloads passed in via navigation params.
  useEffect(() => {
    const payload = route?.params?.payload;
    if (!payload || handledDeepLink.current === payload) return;
    handledDeepLink.current = payload;
    void handlePayload(payload);
  }, [route?.params?.payload, handlePayload]);

  const onScan = ({ data }: { data: string }) => {
    if (busy || result) return;
    void handlePayload(data);
  };

  const reset = () => {
    setResult(null);
    setError(null);
    handledDeepLink.current = null;
  };

  if (!permission) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
        <Text>
          {permission.canAskAgain
            ? 'Camera access is needed to scan credential QR codes.'
            : 'Camera access was denied. Enable it in Settings to scan QR codes.'}
        </Text>
        {permission.canAskAgain && <Button title="Allow camera" onPress={requestPermission} />}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {result || error ? (
        <View style={{ padding: 24, gap: 12 }}>
          {error ? <Text style={{ color: '#b00020' }}>{`Error: ${error}`}</Text> : <Text selectable>{result}</Text>}
          <Button title="Scan again" onPress={reset} />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={busy ? undefined : onScan}
          />
          {busy && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" />
            </View>
          )}
        </View>
      )}
    </View>
  );
}
