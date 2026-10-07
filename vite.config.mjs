import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = {...loadEnv(mode, process.cwd(), ''), ...process.env};
  const backend = new URL(env.PUBLIC_API_URL || 'http://localhost:8080');
  if (!['http:', 'https:'].includes(backend.protocol) || backend.username || backend.password || backend.search || backend.hash || backend.pathname !== '/') throw new Error('PUBLIC_API_URL must be a backend origin without a path or credentials.');
  if (env.VERCEL && backend.protocol !== 'https:') throw new Error('The production backend must use HTTPS.');
  return {
    root: 'frontend',
    define: {'import.meta.env.VITE_BACKEND_ORIGIN': JSON.stringify(backend.origin)},
    server: {port: 5173, strictPort: true},
    build: {outDir: 'dist', emptyOutDir: true, target: 'es2022'},
  };
});
