import AsyncStorage from "@react-native-async-storage/async-storage";

const SESSION_KEY = "@sd_omnicanal:app:telefono";

export async function loadSessionPhone(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export async function saveSessionPhone(telefono: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SESSION_KEY, telefono);
  } catch {
    // ignorar fallas de almacenamiento local
  }
}

export async function clearSessionPhone(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SESSION_KEY);
  } catch {
    // ignorar fallas de almacenamiento local
  }
}
