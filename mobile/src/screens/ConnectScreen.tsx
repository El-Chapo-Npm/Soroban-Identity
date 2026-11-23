import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Button, Text, View } from 'react-native';
import type { RootStack } from '../App';
import { connectWallet } from '../services/wallet';

type ConnectStatus = 'idle' | 'connecting' | 'connected' | 'error';

export default function ConnectScreen({ navigation, route }: NativeStackScreenProps<RootStack, 'Connect'>) {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectStatus>('idle');

  const connect = useCallback(async () => {
    setError(null);
    setStatus('connecting');
    try {
      const connected = await connectWallet();
      setAddress(connected);
      setStatus('connected');
    } catch (e) {
      setError((e as Error).message);
      setStatus('error');
    }
  }, []);

  // Handle deep-link-driven wallet connection. The deep link may carry a
  // pre-filled address (e.g. `app://connect?address=0x...`) or simply trigger
  // a connection attempt (e.g. `app://connect`).
  useEffect(() => {
    const params = route.params as { address?: string; autoConnect?: boolean } | undefined;
    if (!params) {
      return;
    }
    if (params.address) {
      setAddress(params.address);
      setStatus('connected');
      setError(null);
    } else if (params.autoConnect) {
      void connect();
    }
  }, [route.params, connect]);

  const statusLabel =
    status === 'connecting'
      ? 'Connecting…'
      : status === 'connected'
        ? 'Connected'
        : status === 'error'
          ? 'Connection failed'
          : 'Not connected';

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontWeight: '600' }}>Status: {statusLabel}</Text>
      {status === 'connecting' && <ActivityIndicator />}
      {address ? (
        <>
          <Text selectable>Connected: {address}</Text>
          <Button title="Manage DID" onPress={() => navigation.navigate('Did', { address })} />
          <Button title="My credentials" onPress={() => navigation.navigate('Credentials', { address })} />
        </>
      ) : (
        <Button
          title="Connect wallet (WalletConnect)"
          onPress={connect}
          disabled={status === 'connecting'}
        />
      )}
      <Button title="Scan credential QR" onPress={() => navigation.navigate('Scanner')} />
      <Button title="Settings" onPress={() => navigation.navigate('Settings')} />
      {error && <Text style={{ color: 'crimson' }}>{error}</Text>}
    </View>
  );
}