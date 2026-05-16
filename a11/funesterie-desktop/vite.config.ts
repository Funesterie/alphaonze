import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5177,
    strictPort: false
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
