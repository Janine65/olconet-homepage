import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  redirects: { '/zeichnungen/': '/kreationen/' },
  vite: {
    server: {
      proxy: { '/api/public/': { target: 'http://127.0.0.1:18433', changeOrigin: false } },
    },
  },
});
