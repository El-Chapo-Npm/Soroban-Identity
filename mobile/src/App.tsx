import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Button, Text, View } from 'react-native';
import { authenticate } from './services/biometrics';
import ConnectScreen from './screens/ConnectScreen';
import DidScreen from './screens/DidScreen';
import CredentialsScreen from './screens/CredentialsScreen';
import ScannerScreen from './screens/ScannerScreen';

export type RootStack = {
  Connect: undefined;
  Did: { address: string };
  Credentials: { address: string };
  Scanner: undefined;
};

const Stack = createNativeStackNavigator<RootStack>();

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const unlock = () => authenticate().then(setUnlocked);
  useEffect(() => { unlock(); }, []);

  if (!unlocked) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Text>Soroban Identity is locked</Text>
        <Button title="Unlock" onPress={unlock} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Connect" component={ConnectScreen} options={{ title: 'Soroban Identity' }} />
        <Stack.Screen name="Did" component={DidScreen} options={{ title: 'My DID' }} />
        <Stack.Screen name="Credentials" component={CredentialsScreen} />
        <Stack.Screen name="Scanner" component={ScannerScreen} options={{ title: 'Scan credential' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
