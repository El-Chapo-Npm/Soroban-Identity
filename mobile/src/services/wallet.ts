import SignClient from '@walletconnect/sign-client';
import type { SessionTypes } from '@walletconnect/types';
import { Linking } from 'react-native';
import { STELLAR_CHAIN, WALLETCONNECT_PROJECT_ID } from '../config';

let client: SignClient | null = null;
let session: SessionTypes.Struct | null = null;

async function getClient() {
  client ??= await SignClient.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    metadata: { name: 'Soroban Identity', description: 'Decentralized identity on Stellar', url: 'https://soroban-identity.org', icons: [] },
  });
  return client;
}

export async function connectWallet(): Promise<string> {
  const c = await getClient();
  const { uri, approval } = await c.connect({
    requiredNamespaces: {
      stellar: { chains: [STELLAR_CHAIN], methods: ['stellar_signXDR', 'stellar_signAndSubmitXDR'], events: [] },
    },
  });
  if (uri) await Linking.openURL(`lobstr://wc?uri=${encodeURIComponent(uri)}`).catch(() => undefined);
  session = await approval();
  return session.namespaces.stellar.accounts[0].split(':').pop()!;
}

export async function signXdr(xdr: string): Promise<string> {
  if (!client || !session) throw new Error('Wallet not connected');
  const res = await client.request<{ signedXDR: string }>({
    topic: session.topic,
    chainId: STELLAR_CHAIN,
    request: { method: 'stellar_signXDR', params: { xdr } },
  });
  return res.signedXDR;
}

export async function disconnectWallet() {
  if (client && session) await client.disconnect({ topic: session.topic, reason: { code: 6000, message: 'User disconnected' } });
  session = null;
}
