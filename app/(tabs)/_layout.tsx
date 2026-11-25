import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { ComponentProps } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Typography } from '../../src/presentation/theme/tokens';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

interface TabBarIconProps {
  readonly focused: boolean;
  readonly activeName: IoniconName;
  readonly inactiveName: IoniconName;
  readonly rawColor: unknown;
}

function resolveTabIconColor(rawColor: unknown, focused: boolean): string {
  // Normalizo el color recibido desde React Navigation porque RN 0.88 incluye null en ColorValue y @expo/vector-icons exige string.
  if (typeof rawColor === 'string' && rawColor.length > 0) {
    return rawColor;
  }
  return focused ? Colors.primary : Colors.textMuted;
}

function TabBarIcon({ focused, activeName, inactiveName, rawColor }: TabBarIconProps) {
  return (
    <Ionicons
      name={focused ? activeName : inactiveName}
      size={22}
      color={resolveTabIconColor(rawColor, focused)}
    />
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: {
          fontSize: Typography.micro,
          fontWeight: '700',
          marginTop: 2,
        },
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          // Adapto dinámicamente la altura inferior a la barra de gestos de iPhone 14 Pro Max y modelos recientes.
          height: 60 + insets.bottom,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 8),
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Catálogo',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon
              focused={focused}
              activeName="grid"
              inactiveName="grid-outline"
              rawColor={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          title: 'Fiados',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon
              focused={focused}
              activeName="people"
              inactiveName="people-outline"
              rawColor={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Ajustes',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon
              focused={focused}
              activeName="shield-checkmark"
              inactiveName="shield-checkmark-outline"
              rawColor={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}