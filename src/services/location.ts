import * as Location from 'expo-location';
import { CAMPUS_CENTER } from '../data/destinations';

export type UserLocation = {
  lat: number;
  lng: number;
  accuracy?: number;
  mocked?: boolean;
};

export async function requestLocationPermission(): Promise<boolean> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return true;
  const asked = await Location.requestForegroundPermissionsAsync();
  return asked.granted;
}

export async function getCurrentUserLocation(): Promise<UserLocation> {
  const granted = await requestLocationPermission();
  if (!granted) {
    return { ...CAMPUS_CENTER, mocked: true, accuracy: 999 };
  }

  try {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? undefined,
      mocked: false,
    };
  } catch {
    return { ...CAMPUS_CENTER, mocked: true, accuracy: 999 };
  }
}

export { haversineM } from './geo';
