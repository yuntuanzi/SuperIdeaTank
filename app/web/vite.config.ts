import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 开发模式下把 /api 代理到本地服务端（生产由 Express 直接托管 dist，无需代理）
      '/api': 'http://localhost:8787',
    },
  },
});
