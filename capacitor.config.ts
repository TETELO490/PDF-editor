import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bluefill.pdf',
  appName: 'BlueFill PDF',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
