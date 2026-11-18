import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { allowedHosts: ["terminal.local"] },
  build: {
    // Emit fonts as same-origin files; preserve font-src 'self' without data:.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: { charts: ["recharts"], motion: ["framer-motion"] },
      },
    },
  },
});
