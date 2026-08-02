import { fileURLToPath } from "node:url";

import devServer from "@hono/vite-dev-server";
import nodeAdapter from "@hono/vite-dev-server/node";
import { defineConfig } from "vite";

const clientEntries = [
  "clicks",
  "hover",
  "drag-drop",
  "canvas",
  "forms",
  "keyboard",
  "uploads",
  "scroll",
  "dialogs",
  "network",
];

export default defineConfig(({ command, mode }) => {
  if (mode === "client") {
    return {
      build: {
        copyPublicDir: false,
        emptyOutDir: true,
        outDir: "dist",
        rollupOptions: {
          input: Object.fromEntries(
            clientEntries.map((slug) => [
              slug,
              fileURLToPath(
                new URL(`./src/scenarios/${slug}/client.js`, import.meta.url),
              ),
            ]),
          ),
          output: {
            entryFileNames: "assets/[name].js",
          },
        },
      },
    };
  }

  return {
    plugins:
      command === "serve"
        ? [
            devServer({
              adapter: nodeAdapter,
              entry: "src/server.jsx",
            }),
          ]
        : [],
    build: {
      copyPublicDir: false,
      emptyOutDir: false,
      outDir: "dist",
      ssr: "src/server.jsx",
      target: "node22",
      rollupOptions: {
        output: {
          entryFileNames: "server.mjs",
        },
      },
    },
    esbuild: {
      jsx: "automatic",
      jsxImportSource: "hono/jsx",
    },
  };
});
