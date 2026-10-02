import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import type { RootStack } from '../App';
import { loadCredentials } from '../services/identity';
import { useOnline } from '../services/offline';

export default function CredentialsScreen({ route }: NativeStackScreenProps<RootStack, 'Credentials'>) {
  const { address } = route.params;
  const online = useOnline();
  const [items, setItems] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    loadCredentials(address).then(({ data }) => setItems((data as Record<string, unknown>[] | null) ?? []));
  }, [address, online]);

  return (
    <FlatList
      contentContainerStyle={{ padding: 16, gap: 8 }}
      data={items}
      keyExtractor={(item, i) => String(item.id ?? i)}
      ListHeaderComponent={!online ? <Text style={{ color: '#b26a00' }}>Offline — cached credentials</Text> : null}
      ListEmptyComponent={<Text>No credentials yet.</Text>}
      renderItem={({ item }) => (
        <View style={{ padding: 12, borderRadius: 8, backgroundColor: '#f1f3f9' }}>
          <Text style={{ fontWeight: '600' }}>{String(item.credentialType ?? item.credential_type ?? 'Credential')}</Text>
          <Text>Issuer: {String(item.issuer ?? '—')}</Text>
          <Text>{item.revoked ? 'Revoked' : 'Active'}</Text>
        </View>
      )}
    />
  );
}
