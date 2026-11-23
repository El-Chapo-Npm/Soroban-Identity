import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import type { RootStack } from '../App';
import { loadCredentials } from '../services/identity';
import { useOnline } from '../services/offline';
import { useAppDispatch, useAppSelector } from '../store';
import {
  fetchCredentials,
  selectCredentialById,
  selectCredentials,
  selectCredentialsStatus,
  selectPendingActions,
  selectSyncStatus,
} from '../store/credentialsSlice';

export default function CredentialsScreen({ route }: NativeStackScreenProps<RootStack, 'Credentials'>) {
  const { address, credentialId } = route.params;
  const online = useOnline();
  const dispatch = useAppDispatch();

  const items = useAppSelector(selectCredentials);
  const status = useAppSelector(selectCredentialsStatus);
  const syncStatus = useAppSelector(selectSyncStatus);
  const pendingActions = useAppSelector(selectPendingActions);

  const [refreshing, setRefreshing] = useState(false);

  const highlighted = useMemo(
    () => (credentialId ? selectCredentialById({ credentials: { items } } as never, credentialId) : undefined),
    [credentialId, items],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await dispatch(fetchCredentials(address)).unwrap();
    } catch {
      // Offline-first: cached credentials remain available; sync status reflects failure.
    } finally {
      setRefreshing(false);
    }
  }, [address, dispatch]);

  useEffect(() => {
    dispatch(fetchCredentials(address));
  }, [address, dispatch, online]);

  useEffect(() => {
    if (!credentialId || !items.length) return;
    // Deep-link target is surfaced via the highlighted banner below.
  }, [credentialId, items.length]);

  const syncLabel = !online
    ? 'Offline — cached credentials'
    : syncStatus === 'syncing'
      ? 'Syncing…'
      : pendingActions > 0
        ? `${pendingActions} action${pendingActions === 1 ? '' : 's'} queued`
        : syncStatus === 'error'
          ? 'Sync failed — will retry'
          : null;

  return (
    <FlatList
      contentContainerStyle={{ padding: 16, gap: 8 }}
      data={items}
      keyExtractor={(item, i) => String(item.id ?? i)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      ListHeaderComponent={
        <>
          {syncLabel ? (
            <Text style={{ color: online ? '#1a4d8f' : '#b26a00' }}>{syncLabel}</Text>
          ) : null}
          {highlighted ? (
            <View style={{ padding: 12, borderRadius: 8, backgroundColor: '#e3f0ff' }}>
              <Text style={{ fontWeight: '600' }}>Opened from link</Text>
              <Text>{String(highlighted.credentialType ?? highlighted.credential_type ?? 'Credential')}</Text>
            </View>
          ) : null}
          {status === 'loading' && !items.length ? <Text>Loading credentials…</Text> : null}
        </>
      }
      ListEmptyComponent={<Text>No credentials yet.</Text>}
      renderItem={({ item }) => {
        const isHighlighted = credentialId != null && String(item.id) === String(credentialId);
        return (
          <View
            style={{
              padding: 12,
              borderRadius: 8,
              backgroundColor: isHighlighted ? '#dbe9ff' : '#f1f3f9',
              borderWidth: isHighlighted ? 1 : 0,
              borderColor: '#1a4d8f',
            }}
          >
            <Text style={{ fontWeight: '600' }}>{String(item.credentialType ?? item.credential_type ?? 'Credential')}</Text>
            <Text>Issuer: {String(item.issuer ?? '—')}</Text>
            <Text>{item.revoked ? 'Revoked' : 'Active'}</Text>
          </View>
        );
      }}
    />
  );
}