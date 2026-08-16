import { raw } from "hono/html";

import bootstrapStyles from "bootstrap/dist/css/bootstrap.min.css?raw";
import quillSnowStyles from "quill/dist/quill.snow.css?raw";
import styles from "../styles.css?raw";

const interactiveScenarios = new Set([
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
  "web-components",
]);

export function scenarioModulePath(slug) {
  if (!interactiveScenarios.has(slug)) return undefined;
  return import.meta.env.DEV
    ? `/src/scenarios/${slug}/client.js`
    : `/assets/${slug}.js`;
}

function progressModulePath() {
  return import.meta.env.DEV
    ? "/src/progress/client.js"
    : "/assets/progress.js";
}

export default function Layout({ title, children, scriptSrc }) {
  return (
    <html lang="en" data-bs-theme="light">
      <head>
        <meta charset="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta
          name="description"
          content="Deterministic browser interaction fixtures for ego-browser."
        />
        <title>
          {title ? `${title} · Ego Browser Lab` : "Ego Browser Lab"}
        </title>
        <style data-ui-foundation="bootstrap">{raw(bootstrapStyles)}</style>
        <style data-rich-text-editor="quill-snow">{raw(quillSnowStyles)}</style>
        <style data-ui-theme="ego-browser">{raw(styles)}</style>
      </head>
      <body>
        {children}
        <script type="module" src={progressModulePath()}></script>
        {scriptSrc ? <script type="module" src={scriptSrc}></script> : null}
      </body>
    </html>
  );
}
