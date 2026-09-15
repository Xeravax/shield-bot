import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@locales": path.resolve(__dirname, "../locales"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
    hmr: {
      clientPort: 443,
    },
    allowedHosts: ["designing-minutes-quantity-counted.trycloudflare.com"],
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
