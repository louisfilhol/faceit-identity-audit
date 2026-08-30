// SPDX-License-Identifier: AGPL-3.0-only
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// FastAPI serves this directory's contents at the site root in production.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    // Dev server: Vite serves the app with hot reload; every API call is
    // proxied to the FastAPI backend started with ./run.sh.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: false,
      },
    },
  },
});
