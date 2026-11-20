import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: (process.env.VITE_ENABLE_SECURE_API ?? loadEnv(mode, process.cwd()).VITE_ENABLE_SECURE_API) === "true" ? "/" : "./",
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
}));
