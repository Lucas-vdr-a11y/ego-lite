import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { raw } from "hono/html";

import { findTestCase } from "../test-cases.mjs";
import HomePage from "./components/home-page.jsx";
import Layout from "./components/layout.jsx";
import TestPage from "./components/test-page.jsx";

function documentHtml(content) {
  return `<!doctype html>${content}`;
}

export function createTestSiteApp(taskName) {
  const app = new Hono();
  if (import.meta.env.PROD) {
    app.use(
      "/assets/*",
      serveStatic({ root: fileURLToPath(new URL("./", import.meta.url)) }),
    );
  }
  app.get("/healthz", (context) =>
    context.json({
      ok: true,
      taskName,
      fixture: "ego-browser-hono-test-site",
      now: Date.now(),
    }),
  );
  app.get("/", (context) => context.html(documentHtml(<HomePage />)));
  app.get("/tests/navigation/destination", (context) =>
    context.html(
      documentHtml(
        <Layout title="Launch decision record">
          <main class="destination-page">
            <p class="brand-mark">NORTHSTAR / KNOWLEDGE</p>
            <p class="kicker">Decision record · DR-024</p>
            <h1>Launch in two measured phases.</h1>
            <p id="destination-status">
              The workspace opened a complete decision record in this page.
            </p>
            <div class="decision-meta">
              <span>DECIDED 24 JUL</span>
              <span>OWNER / MEI LIN</span>
              <span>5 LINKED NOTES</span>
            </div>
            <a href="/tests/navigation">← Return to research index</a>
          </main>
        </Layout>,
      ),
    ),
  );
  app.get("/frames/content", (context) =>
    context.html(
      documentHtml(
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>Secure partner checkout</title>
            <style>
              {raw(
                "*{box-sizing:border-box}body{margin:0;font-family:'Avenir Next','Trebuchet MS',sans-serif;background:#f4f0e8;color:#17201f;padding:30px}header{display:flex;justify-content:space-between;border-bottom:1px solid #c9c1b3;padding-bottom:18px}header span{font-size:11px;font-weight:800;letter-spacing:.12em}h2{font-family:Georgia,serif;font-size:30px;font-weight:400;margin:28px 0 18px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{border:1px solid #17201f;padding:13px}.field span{display:block;color:#66716d;font-size:10px;font-weight:800;letter-spacing:.08em}.field strong{display:block;margin-top:5px;font-weight:500}.wide{grid-column:1/-1}button{width:100%;margin-top:18px;background:#17201f;color:#f4f0e8;border:0;padding:15px;font-weight:800}output{display:block;margin-top:14px;padding:12px;background:#c8ef58;font-family:Georgia,serif;text-align:center}",
              )}
            </style>
          </head>
          <body>
            <header>
              <span>EMBER PAY</span>
              <span>TLS / SECURE</span>
            </header>
            <h2>Confirm payment details</h2>
            <div class="fields">
              <div class="field wide">
                <span>CARD</span>
                <strong>•••• •••• •••• 4242</strong>
              </div>
              <div class="field">
                <span>EXPIRY</span>
                <strong>08 / 29</strong>
              </div>
              <div class="field">
                <span>SECURITY</span>
                <strong>•••</strong>
              </div>
            </div>
            <button
              id="frame-button"
              onclick="document.querySelector('output').textContent='Payment details confirmed'"
            >
              Confirm S$ 248.00
            </button>
            <output>Awaiting confirmation</output>
          </body>
        </html>,
      ),
    ),
  );
  app.post("/api/echo", async (context) => {
    const payload = await context.req.json();
    return context.json({
      ok: true,
      echo: payload.message,
      source: "ego-browser-hono-test-site",
    });
  });
  app.get("/api/download", (context) => {
    context.header("content-type", "text/plain; charset=utf-8");
    context.header(
      "content-disposition",
      'attachment; filename="ego-browser-sample.txt"',
    );
    context.header("cache-control", "no-store");
    return context.body("ego-browser download fixture\n");
  });
  app.get("/tests/:slug", (context) => {
    const testCase = findTestCase(context.req.param("slug"));
    return testCase
      ? context.html(documentHtml(<TestPage testCase={testCase} />))
      : context.notFound();
  });
  return app;
}

export async function startTestSite(taskName) {
  const app = createTestSiteApp(taskName);
  let server;
  const info = await new Promise((resolve, reject) => {
    server = serve(
      { fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
      resolve,
    );
    server.once("error", reject);
  });
  return { server, baseUrl: `http://127.0.0.1:${info.port}` };
}

export async function closeTestSite(server) {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}

export default createTestSiteApp("development");
