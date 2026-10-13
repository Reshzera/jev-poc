import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/** Caminho local que o front chama; o proxy abaixo encaminha para o JEV. */
const JEV_PROXY_PATH = "/jev";
const JEV_UPSTREAM = "https://api.typesafe.ai/v1";

export default defineConfig(({ mode }) => {
  // Prefixo vazio: lê também variáveis sem `VITE_`, que nunca vão para o bundle.
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = env.JEV_API_KEY || env.VITE_JEV_API_KEY;

  return {
    plugins: [react()],
    css: {
      preprocessorOptions: {
        scss: {
          // Lets any module do `@use 'variables'` / `@use 'mixins'`.
          loadPaths: [fileURLToPath(new URL("./src/styles", import.meta.url))],
        },
      },
    },
    server: {
      proxy: {
        // A API do JEV recusa chamadas de origem browser ("Disallowed CORS
        // origin"), então o dev server encaminha e injeta a credencial — a
        // chave fica no servidor, fora do bundle.
        [JEV_PROXY_PATH]: {
          target: env.JEV_BASE_URL || env.VITE_JEV_BASE_URL || JEV_UPSTREAM,
          changeOrigin: true,
          rewrite: (path: string) =>
            path.replace(new RegExp(`^${JEV_PROXY_PATH}`), ""),
          configure: (proxy: {
            on: (event: string, handler: (req: unknown) => void) => void;
          }) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (!apiKey) return;
              (
                proxyReq as { setHeader: (k: string, v: string) => void }
              ).setHeader("Authorization", `Bearer ${apiKey}`);
            });
          },
        },
      },
    },
  };
});
