// SPDX-License-Identifier: AGPL-3.0-only
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // Hash-based routing: jsdom keeps the same document across tests, so
    // reset the URL explicitly between them.
    restoreMocks: true,
  },
});
