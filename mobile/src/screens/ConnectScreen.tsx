import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Button, Text, View } from 'react-native';
import type { RootStack } from '../App';
import { connectWallet } from '../services/wallet';

export default function ConnectScreen({ navigation }: NativeStackScreenProps<RootStack, 'Connect'>) {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setError(null);
    try {
      setAddress(await connectWallet());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      {address ? (
        <>
          <Text selectable>Connected: {address}</Text>
          <Button title="Manage DID" onPress={() => navigation.navigate('Did', { address })} />
          <Button title="My credentials" onPress={() => navigation.navigate('Credentials', { address })} />
        </>
      ) : (
        <Button title="Connect wallet (WalletConnect)" onPress={connect} />
      )}
      <Button title="Scan credential QR" onPress={() => navigation.navigate('Scanner')} />
      {error && <Text style={{ color: 'crimson' }}>{error}</Text>}
    </View>
  );
}
