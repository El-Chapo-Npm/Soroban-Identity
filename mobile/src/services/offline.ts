import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

const PREFIX = 'soroban-id:cache:';

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener((s) => setOnline(Boolean(s.isConnected))), []);
  return online;
}

// Network-first read that falls back to the last cached value when offline or on failure.
export async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<{ data: T | null; stale: boolean }> {
  const { isConnected } = await NetInfo.fetch();
  if (isConnected) {
    try {
      const data = await fetcher();
      await AsyncStorage.setItem(PREFIX + key, JSON.stringify(data));
      return { data, stale: false };
    } catch {
      /* fall through to cache */
    }
  }
  const raw = await AsyncStorage.getItem(PREFIX + key);
  return { data: raw ? (JSON.parse(raw) as T) : null, stale: true };
}
