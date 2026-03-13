import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        host: 'index.html',
        client: 'client.html',
      },
    },
  },
})
