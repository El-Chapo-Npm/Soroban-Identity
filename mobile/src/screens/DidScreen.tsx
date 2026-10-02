import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import type { RootStack } from '../App';
import { loadDid } from '../services/identity';
import { useOnline } from '../services/offline';

export default function DidScreen({ route }: NativeStackScreenProps<RootStack, 'Did'>) {
  const { address } = route.params;
  const online = useOnline();
  const [doc, setDoc] = useState<unknown>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    loadDid(address).then(({ data, stale }) => { setDoc(data); setStale(stale); });
  }, [address, online]);

  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 8 }}>
      {!online && <Text style={{ color: '#b26a00' }}>Offline — showing cached data</Text>}
      {stale && online && <Text style={{ color: '#b26a00' }}>Could not refresh — showing cached data</Text>}
      {doc ? <Text selectable style={{ fontFamily: 'Courier' }}>{JSON.stringify(doc, null, 2)}</Text> : <Text>No DID registered for this account.</Text>}
    </ScrollView>
  );
}
