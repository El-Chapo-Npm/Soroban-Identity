import '@walletconnect/react-native-compat';
import 'react-native-get-random-values';
import { registerRootComponent } from 'expo';
import * as Linking from 'expo-linking';
import App from './src/App';

/**
 * Deep linking configuration for the mobile application.
 *
 * Supports both the custom scheme (sorobanid://) and universal links
 * (https://soroban-identity.org/...) so that URLs such as:
 *   - sorobanid://verify?id=...
 *   - https://soroban-identity.org/verify?id=...
 * open the appropriate screen (Scanner or Credentials).
 */
export const linking = {
  prefixes: [
    Linking.createURL('/'),
    'sorobanid://',
    'https://soroban-identity.org',
  ],
  config: {
    screens: {
      Scanner: {
        path: 'verify',
        parse: {
          id: (id: string) => id,
        },
      },
      Credentials: {
        path: 'credentials',
        parse: {
          id: (id: string) => id,
        },
      },
      Home: '',
    },
  },
};

registerRootComponent(App);