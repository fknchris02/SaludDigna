import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl = process.env.CAPACITOR_SERVER_URL ?? 'http://10.35.10.109:3000/app';

const config: CapacitorConfig = {
  appId: 'mx.saluddigna.omnicanal',
  appName: 'Salud Digna',
  webDir: 'public',
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith('http://'),
  },
};

export default config;

