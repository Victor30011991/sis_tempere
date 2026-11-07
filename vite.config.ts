import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base './' faz o site funcionar em qualquer endereço do GitHub Pages
// (usuario.github.io/repositorio/) sem precisar configurar o nome do repositório.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
