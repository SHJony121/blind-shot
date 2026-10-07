import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev-only helper: when BLINDSHOT_SHOT_DIR is set, POST a canvas data URL to /__shot?name=x
 * to save a PNG there. Used for automated visual checks; never part of a production build.
 */
function devScreenshots(): Plugin {
  const dir = process.env.BLINDSHOT_SHOT_DIR;
  return {
    name: 'blindshot-dev-screenshots',
    apply: 'serve',
    configureServer(server) {
      if (!dir) return;
      mkdirSync(dir, { recursive: true });
      server.middlewares.use('/__shot', (req, res) => {
        const name = (new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'shot').replace(/[^a-z0-9_-]/gi, '');
        let body = '';
        req.on('data', (c: Buffer) => (body += c.toString()));
        req.on('end', () => {
          const b64 = body.replace(/^data:image\/png;base64,/, '');
          writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devScreenshots()],
  server: { port: 5173, host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@blindshot/shared'],
  },
});
