import { raw } from "hono/html";

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
  "dialogs",
  "network",
]);

export function scenarioModulePath(slug) {
  if (!interactiveScenarios.has(slug)) return undefined;
  return import.meta.env.DEV
    ? `/src/scenarios/${slug}/client.js`
    : `/assets/${slug}.js`;
}

export default function Layout({ title, children, scriptSrc }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          name="description"
          content="Deterministic browser interaction fixtures for ego-browser."
        />
        <title>
          {title ? `${title} · Ego Browser Lab` : "Ego Browser Lab"}
        </title>
        <style>{raw(styles)}</style>
      </head>
      <body>
        {children}
        {scriptSrc ? <script type="module" src={scriptSrc}></script> : null}
      </body>
    </html>
  );
}
