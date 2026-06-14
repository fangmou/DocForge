import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@codemirror') || id.includes('@replit/codemirror-vim')
                || id.includes('@lezer')) {
              return 'codemirror';
            }
            if (id.includes('@asciidoctor')) {
              return 'asciidoctor';
            }
            if (id.includes('/marked/')) {
              return 'marked';
            }
            if (id.includes('@tauri-apps')) {
              return 'tauri';
            }
            if (id.includes('lit')) {
              return 'lit';
            }
          }
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
});
