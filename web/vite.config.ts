import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// base './' => o site funciona em qualquer subcaminho (ex.: usuario.github.io/Instagram-/)
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 600 },
});
