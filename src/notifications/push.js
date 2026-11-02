// Register for Expo Push Notifications and upload token to Worker API
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

export async function registerForPushNotificationsAsync(request) {
  if (Platform.OS === 'web') return null;

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return null;

    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    const tokenObj = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const token = tokenObj?.data;

    if (token && request) {
      await request('POST', '/me/push-token', {
        token,
        platform: Platform.OS,
      });
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#c9a45c',
      });
    }

    return token;
  } catch (error) {
    console.warn('[push] Push token registration skipped:', error.message);
    return null;
  }
}
