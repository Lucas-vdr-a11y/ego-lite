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
  "navigation",
  "dialogs",
  "downloads",
  "frames",
  "network",
  "review-workflow",
  "collaborative-docs",
  "spreadsheet",
  "rich-text",
  "visual-path",
  "svg-mathml",
  "text-content",
  "inline-semantics",
  "media-embeds",
  "table-semantics",
  "native-form-controls",
];

export default defineConfig(({ command, mode }) => {
  if (mode === "client") {
    return {
      build: {
        copyPublicDir: false,
        emptyOutDir: true,
        outDir: "dist",
        rollupOptions: {
          input: {
            progress: fileURLToPath(
              new URL("./src/progress/client.js", import.meta.url),
            ),
            ...Object.fromEntries(
              clientEntries.map((slug) => [
                slug,
                fileURLToPath(
                  new URL(`./src/scenarios/${slug}/client.js`, import.meta.url),
                ),
              ]),
            ),
          },
          output: {
            entryFileNames: "assets/[name].js",
          },
        },
      },
    };
  }

  return {
    server: {
      host: "localhost",
    },
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
