import { NavigationContainer, LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useEffect, useRef, useState } from 'react';
import { Button, Text, View } from 'react-native';
import { Provider } from 'react-redux';
import { store } from './store';
import { authenticate } from './services/biometrics';
import {
  registerForPushNotifications,
  addNotificationListeners,
  NotificationSubscription,
} from './services/notifications';
import ConnectScreen from './screens/ConnectScreen';
import DidScreen from './screens/DidScreen';
import CredentialsScreen from './screens/CredentialsScreen';
import ScannerScreen from './screens/ScannerScreen';
import SettingsScreen from './screens/SettingsScreen';

export type RootStack = {
  Connect: undefined;
  Did: { address: string };
  Credentials: { address: string };
  Scanner: undefined;
  Settings: undefined;
};

export type RootTab = {
  Home: undefined;
  Credentials: { address: string };
  Scanner: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStack>();
const Tab = createBottomTabNavigator<RootTab>();

const linking: LinkingOptions<RootStack> = {
  prefixes: ['sorobanid://', 'https://app.sorobanid.example'],
  config: {
    screens: {
      Connect: 'connect',
      Did: 'did/:address',
      Credentials: 'credentials/:address',
      Scanner: 'scan',
      Settings: 'settings',
    },
  },
};

function MainTabs() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Home" component={ConnectScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="Credentials" component={CredentialsScreen} options={{ title: 'Credentials' }} />
      <Tab.Screen name="Scanner" component={ScannerScreen} options={{ title: 'Scan' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const notificationSubs = useRef<NotificationSubscription[]>([]);

  const unlock = () => authenticate().then(setUnlocked);

  useEffect(() => { unlock(); }, []);

  useEffect(() => {
    if (!unlocked) return;
    registerForPushNotifications().catch(() => undefined);
    notificationSubs.current = addNotificationListeners();
    return () => {
      notificationSubs.current.forEach((sub) => sub.remove());
      notificationSubs.current = [];
    };
  }, [unlocked]);

  if (!unlocked) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Text>Soroban Identity is locked</Text>
        <Button title="Unlock" onPress={unlock} />
      </View>
    );
  }

  return (
    <Provider store={store}>
      <NavigationContainer linking={linking}>
        <Stack.Navigator>
          <Stack.Screen name="Connect" component={MainTabs} options={{ headerShown: false, title: 'Soroban Identity' }} />
          <Stack.Screen name="Did" component={DidScreen} options={{ title: 'My DID' }} />
          <Stack.Screen name="Credentials" component={CredentialsScreen} />
          <Stack.Screen name="Scanner" component={ScannerScreen} options={{ title: 'Scan credential' }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </Provider>
  );
}
