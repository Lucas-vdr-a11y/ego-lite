import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { raw } from "hono/html";

import { findTestCase, TEST_CASES } from "../test-cases.mjs";
import AppHeader from "./components/app-header.jsx";
import HomePage from "./components/home-page.jsx";
import Layout from "./components/layout.jsx";
import TestPage from "./components/test-page.jsx";

function documentHtml(content) {
  return `<!doctype html>${content}`;
}

export function createTestSiteApp(taskName) {
  const app = new Hono();
  let downloadRequests = 0;
  const progress = {};
  let progressRevision = 0;
  const progressStatuses = new Set(["in-progress", "completed", "failed"]);
  const progressSlugs = new Set(TEST_CASES.map((testCase) => testCase.slug));
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
  app.get("/api/test-progress", (context) => context.json({ progress }));
  app.get("/api/test-progress/events", (context) =>
    streamSSE(context, async (stream) => {
      let sentRevision = -1;
      while (!stream.aborted) {
        if (sentRevision !== progressRevision) {
          sentRevision = progressRevision;
          await stream.writeSSE({
            event: "progress",
            id: String(progressRevision),
            data: JSON.stringify({ progress }),
          });
        }
        await stream.sleep(100);
      }
    }),
  );
  app.put("/api/test-progress/:slug", async (context) => {
    const slug = context.req.param("slug");
    const payload = await context.req.json().catch(() => ({}));
    if (!progressSlugs.has(slug) || !progressStatuses.has(payload.status)) {
      return context.json({ error: "Invalid scenario progress" }, 400);
    }
    progress[slug] = payload.status;
    progressRevision += 1;
    return context.json({ progress });
  });
  app.get("/", (context) => context.html(documentHtml(<HomePage />)));
  app.get("/tests/navigation/destination", (context) =>
    context.html(
      documentHtml(
        <Layout title="Launch decision record">
          <AppHeader />
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
  app.get("/tests/navigation/slow-image", async (context) => {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    context.header("content-type", "image/svg+xml");
    return context.body(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" />',
    );
  });
  app.get("/tests/navigation/slow-load", (context) =>
    context.html(
      documentHtml(
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>Committed before load</title>
          </head>
          <body>
            <h1>Committed document</h1>
            <img src="/tests/navigation/slow-image" alt="Delayed resource" />
          </body>
        </html>,
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
                "*{box-sizing:border-box}body{margin:0;padding:24px;color:#1f2937;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px}header{display:flex;justify-content:space-between;padding-bottom:14px;border-bottom:1px solid #e2e8f0}header span{color:#64748b;font-size:11px;font-weight:650}h2{margin:22px 0 16px;font-size:22px;font-weight:650;letter-spacing:-.03em}.fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}.field{display:block;padding:12px;border:1px solid #e2e8f0;border-radius:8px;background:#fff}.field span,label>span{display:block;color:#64748b;font-size:10px;font-weight:650}.wide{grid-column:1/-1}input[type=text]{width:100%;min-height:40px;margin-top:5px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;font:inherit}.terms{display:flex;align-items:center;gap:8px;margin-top:12px}.terms input{width:18px;height:18px}input:focus-visible,button:focus-visible{outline:2px solid #2563eb;outline-offset:2px}.actions{display:grid;grid-template-columns:1fr auto;gap:8px}button{min-height:42px;margin-top:16px;padding:8px 14px;border:1px solid #2563eb;border-radius:7px;color:#fff;background:#2563eb;font-weight:650}.secondary{color:#1f2937;border-color:#cbd5e1;background:#fff}output{display:block;margin-top:12px;padding:10px;border-radius:7px;color:#166534;background:#f0fdf4;font-weight:600;text-align:center}",
              )}
            </style>
          </head>
          <body>
            <header>
              <span>EMBER PAY</span>
              <span>TLS / SECURE</span>
            </header>
            <h2>Confirm payment details</h2>
            <form id="payment-form">
              <div class="fields">
                <label class="field wide">
                  <span>CARDHOLDER NAME</span>
                  <input
                    id="cardholder-name"
                    type="text"
                    aria-label="Cardholder name"
                    autocomplete="cc-name"
                  />
                </label>
                <label class="field wide">
                  <span>CARD NUMBER</span>
                  <input
                    id="card-number"
                    type="text"
                    aria-label="Card number"
                    inputmode="numeric"
                    autocomplete="cc-number"
                  />
                </label>
                <label class="field">
                  <span>EXPIRY</span>
                  <input
                    id="card-expiry"
                    type="text"
                    aria-label="Expiry"
                    placeholder="MM/YY"
                    autocomplete="cc-exp"
                  />
                </label>
                <label class="field">
                  <span>SECURITY</span>
                  <input
                    id="card-security"
                    type="text"
                    aria-label="Security code"
                    inputmode="numeric"
                    autocomplete="cc-csc"
                  />
                </label>
              </div>
              <label class="terms">
                <input id="payment-terms" type="checkbox" />
                Accept payment terms
              </label>
              <div class="actions">
                <button id="frame-button" type="submit">
                  Confirm S$ 248.00
                </button>
                <button id="frame-reset" type="reset" class="secondary">
                  Reset
                </button>
              </div>
              <output data-testid="frame-result">Awaiting confirmation</output>
            </form>
            <script>
              {raw(`
                const form = document.querySelector('#payment-form');
                const output = document.querySelector('output');
                form.addEventListener('submit', (event) => {
                  event.preventDefault();
                  const name = document.querySelector('#cardholder-name').value.trim();
                  const card = document.querySelector('#card-number').value.replace(/\\s/g, '');
                  const expiry = document.querySelector('#card-expiry').value.trim();
                  const security = document.querySelector('#card-security').value.trim();
                  const terms = document.querySelector('#payment-terms').checked;
                  if (!name) output.textContent = 'Enter the cardholder name';
                  else if (!/^\\d{16}$/.test(card)) output.textContent = 'Enter a valid card number';
                  else if (!/^(0[1-9]|1[0-2])\\/\\d{2}$/.test(expiry)) output.textContent = 'Enter expiry as MM/YY';
                  else if (!/^\\d{3}$/.test(security)) output.textContent = 'Enter a 3-digit security code';
                  else if (!terms) output.textContent = 'Accept the payment terms';
                  else {
                    output.textContent = 'Payment confirmed for ' + name;
                    parent.postMessage({ type: 'frame-payment-confirmed', name }, location.origin);
                  }
                });
                form.addEventListener('reset', () => {
                  setTimeout(() => { output.textContent = 'Awaiting confirmation'; });
                });
              `)}
            </script>
          </body>
        </html>,
      ),
    ),
  );
  app.post("/api/echo", async (context) => {
    const mode = context.req.query("mode");
    if (mode === "delayed") {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (mode === "error") {
      return context.json({ ok: false, error: "carrier unavailable" }, 503);
    }
    const payload = await context.req.json();
    return context.json({
      ok: true,
      echo: payload.message,
      mode,
      source: "ego-browser-hono-test-site",
    });
  });
  app.get("/api/download", (context) => {
    downloadRequests += 1;
    context.header("content-type", "text/plain; charset=utf-8");
    context.header(
      "content-disposition",
      'attachment; filename="ego-browser-sample.txt"',
    );
    context.header("cache-control", "no-store");
    return context.body("ego-browser download fixture\n");
  });
  app.get("/api/download-status", (context) =>
    context.json({ requests: downloadRequests }),
  );
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
