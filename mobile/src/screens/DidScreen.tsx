import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import type { RootStack } from '../App';
import { loadDid } from '../services/identity';
import { useOnline } from '../services/offline';
import { useAppDispatch, useAppSelector } from '../store';
import { fetchDid, selectDid, selectDidStatus } from '../store/didSlice';

export default function DidScreen({ route }: NativeStackScreenProps<RootStack, 'Did'>) {
  const { address } = route.params;
  const online = useOnline();
  const dispatch = useAppDispatch();

  const cachedDoc = useAppSelector((state) => selectDid(state, address));
  const status = useAppSelector(selectDidStatus);

  const [doc, setDoc] = useState<unknown>(cachedDoc ?? null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const { data, stale: isStale } = await loadDid(address);
      setDoc(data);
      setStale(isStale);
      dispatch(fetchDid(address));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load DID');
    }
  }, [address, dispatch]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadDid(address)
      .then(({ data, stale: isStale }) => {
        if (cancelled) return;
        setDoc(data);
        setStale(isStale);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load DID');
      });
    dispatch(fetchDid(address));
    return () => {
      cancelled = true;
    };
  }, [address, online, dispatch]);

  // Keep local view in sync with Redux cache updates.
  useEffect(() => {
    if (cachedDoc) {
      setDoc(cachedDoc);
    }
  }, [cachedDoc]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const syncLabel = !online
    ? 'Offline — showing cached data'
    : status === 'loading'
      ? 'Syncing…'
      : stale
        ? 'Could not refresh — showing cached data'
        : null;

  return (
    <ScrollView
      contentContainerStyle={{ padding: 24, gap: 8 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {syncLabel && <Text style={{ color: '#b26a00' }}>{syncLabel}</Text>}
      {error && (
        <View style={{ gap: 4 }}>
          <Text style={{ color: '#b00020' }}>{error}</Text>
          {!online && <Text style={{ color: '#b26a00' }}>You are offline. Pull down to retry when connected.</Text>}
        </View>
      )}
      {doc ? (
        <Text selectable style={{ fontFamily: 'Courier' }}>
          {JSON.stringify(doc, null, 2)}
        </Text>
      ) : (
        <Text>No DID registered for this account.</Text>
      )}
    </ScrollView>
  );
}