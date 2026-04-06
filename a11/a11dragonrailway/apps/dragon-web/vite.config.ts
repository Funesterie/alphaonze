import { loadEnv, defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_DRAGON_API_URL || "http://127.0.0.1:4600";

  return {
    plugins: [react()],
    server: {
      port: 5174,
      proxy: {
        "/api": {
          target,
          changeOrigin: true
        },
        "/health": {
          target,
          changeOrigin: true
        }
      }
    },
    preview: {
      port: 4174
    }
  };
});
