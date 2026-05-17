import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts", "tests/**/*.test.ts"]
  }
});
