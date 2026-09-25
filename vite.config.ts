import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), VitePWA({ registerType:'autoUpdate', manifest:false, workbox:{ globPatterns:['**/*.{js,css,html,svg,png,glb,mp3,webp}'], maximumFileSizeToCacheInBytes:5242880 } })],
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei'],
          rapier: ['@dimforge/rapier3d-compat', '@react-three/rapier'],
        },
      },
    },
  },
});
