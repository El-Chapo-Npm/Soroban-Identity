import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { Button, Text, View } from 'react-native';
import { credentials } from '../services/identity';

// Expects QR payloads of the form sorobanid://verify?id=<credentialId>&caller=<G...>
export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<string | null>(null);

  if (!permission?.granted) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Button title="Allow camera" onPress={requestPermission} />
      </View>
    );
  }

  const onScan = async ({ data }: { data: string }) => {
    if (result) return;
    try {
      const url = new URL(data);
      const id = url.searchParams.get('id');
      const caller = url.searchParams.get('caller');
      if (!id || !caller) throw new Error('Not a Soroban Identity credential QR');
      setResult('Verifying…');
      setResult(JSON.stringify(await credentials.verifyCredential(caller, id), null, 2));
    } catch (e) {
      setResult(`Error: ${(e as Error).message}`);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      {result ? (
        <View style={{ padding: 24, gap: 12 }}>
          <Text selectable>{result}</Text>
          <Button title="Scan again" onPress={() => setResult(null)} />
        </View>
      ) : (
        <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
      )}
    </View>
  );
}
