import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { raw } from "hono/html";
import { WebSocket, WebSocketServer } from "ws";

import { findTestCase, TEST_CASES } from "../test-cases.mjs";
import AppHeader from "./components/app-header.jsx";
import HomePage from "./components/home-page.jsx";
import Layout from "./components/layout.jsx";
import TestPage from "./components/test-page.jsx";

const realtimeServers = new WeakMap();

const loadingBayVideo = Buffer.from(
  "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAJBEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggIr7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAxV0GNTGF2ZjYyLjEyLjEwMUSJiECfQAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYj1nLwXK4ZfX5yBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhB3NZQDgkLCBoLqBWpqBAlW5gQESVMNnQIBzc6BjwIBnyJpFo4dFTkNPREVSRIeNTGF2ZjYyLjEyLjEwMXNz2mPAi2PFiPWcvBcrhl9fZ8ilRaOHRU5DT0RFUkSHmExhdmM2Mi4yOC4xMDEgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDIuMDAwMDAwMDAwAB9DtnX754EAo7GBAACAgkmDQgAJ8AWWADgkHBhCAAAwcAAAfJBD/+EADf/zCD///Z0OOebZRdebi6SAo5WBAfQAhgBAkpwASUAAAyAAAFn5huCjlYED6ACGAECSnABKwAADIAAAWfmG4KOVgQXcAIYAQJKcAEnAAAMgAABZ+YbgHFO7a5G7j7OBALeK94EB8YIBq/CBAw==",
  "base64",
);
const dispatcherAudio = Buffer.from(
  "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",
  "base64",
);

function documentHtml(content) {
  return `<!doctype html>${content}`;
}

function mediaEvidenceDocument(title, buttonLabel, documentName) {
  return documentHtml(
    <html lang="en-SG">
      <head>
        <meta charset="utf-8" />
        <title>{title}</title>
        <style>
          {raw(
            "body{margin:0;padding:1rem;color:#0f172a;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}h1{font-size:1rem}button{min-height:2.5rem;padding:.5rem .75rem;border:1px solid #0f766e;border-radius:.4rem;color:white;background:#0f766e}output{display:block;margin-top:.75rem;color:#475569;font-size:.8rem}",
          )}
        </style>
      </head>
      <body>
        <h1>{title}</h1>
        <button type="button">{buttonLabel}</button>
        <output aria-live="polite">Awaiting confirmation</output>
        <script>
          {raw(`
            const button = document.querySelector("button");
            const output = document.querySelector("output");
            button.addEventListener("click", () => {
              button.disabled = true;
              output.textContent = "Document confirmed";
              parent.postMessage(
                {
                  type: "media-document-confirmed",
                  document: ${JSON.stringify(documentName)},
                },
                location.origin,
              );
            });
          `)}
        </script>
      </body>
    </html>,
  );
}

export function createTestSiteApp(taskName, options = {}) {
  const app = new Hono();
  let downloadRequests = 0;
  const progress = {};
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
    context.text("WebSocket upgrade required", 426),
  );
  app.put("/api/test-progress/:slug", async (context) => {
    const slug = context.req.param("slug");
    const payload = await context.req.json().catch(() => ({}));
    if (!progressSlugs.has(slug) || !progressStatuses.has(payload.status)) {
      return context.json({ error: "Invalid scenario progress" }, 400);
    }
    progress[slug] = payload.status;
    options.onProgressChange?.(progress);
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
  app.get("/tests/navigation/delayed-document", async (context) => {
    const requestedDelay = Number(context.req.query("delay"));
    const delay = Number.isFinite(requestedDelay)
      ? Math.min(Math.max(requestedDelay, 0), 15_000)
      : 700;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return context.html(
      documentHtml(
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>Delayed document ready</title>
          </head>
          <body>delayed-document-body</body>
        </html>,
      ),
    );
  });
  app.get("/tests/navigation/not-found", (context) =>
    context.html(
      documentHtml(
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>Navigation target missing</title>
          </head>
          <body>navigation-not-found-body</body>
        </html>,
      ),
      404,
    ),
  );
  app.get("/tests/navigation/redirect", (context) =>
    context.redirect("/tests/navigation/redirect-target", 302),
  );
  app.get("/tests/navigation/redirect-target", (context) =>
    context.html(
      documentHtml(
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>Redirect target ready</title>
          </head>
          <body>redirect-target-body</body>
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
                "*{box-sizing:border-box}body{margin:0;padding:24px;color:#1f2937;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px}header{display:flex;justify-content:space-between;padding-bottom:14px;border-bottom:1px solid #e2e8f0}header span{color:#64748b;font-size:11px;font-weight:650}h2{margin:22px 0 16px;font-size:22px;font-weight:650;letter-spacing:-.03em}.fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}.field{display:block;padding:12px;border:1px solid #e2e8f0;border-radius:8px;background:#fff}.field span,label>span{display:block;color:#64748b;font-size:10px;font-weight:650}.wide{grid-column:1/-1}input[type=text]{width:100%;min-height:40px;margin-top:5px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;font:inherit}.terms{display:flex;align-items:center;gap:8px;margin-top:12px}.terms input{width:18px;height:18px}input:focus-visible,button:focus-visible{outline:2px solid #2563eb;outline-offset:2px}.actions{display:grid;grid-template-columns:1fr auto;gap:8px}button{min-height:42px;margin-top:16px;padding:8px 14px;border:1px solid #2563eb;border-radius:7px;color:#fff;background:#2563eb;font-weight:650}.secondary{color:#1f2937;border-color:#cbd5e1;background:#fff}output{display:block;margin-top:12px;padding:10px;border-radius:7px;color:#166534;background:#f0fdf4;font-weight:600;text-align:center}.pickup-map{width:100%;height:260px;border:1px solid #cbd5e1;border-radius:8px;background:#fff}",
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
            <h2>Pickup location</h2>
            <iframe
              id="pickup-map"
              class="pickup-map"
              title="Pickup location map"
              src="https://www.openstreetmap.org/export/embed.html?bbox=-0.004017949104309083%2C51.47612752641776%2C0.00030577182769775396%2C51.478569861898606&layer=mapnik"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            ></iframe>
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
  app.get("/tests/media-embeds/floor-plan-wide.svg", (context) => {
    context.header("content-type", "image/svg+xml; charset=utf-8");
    return context.body(`
      <svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300">
        <rect width="300" height="300" fill="#ccfbf1"/>
        <rect x="300" width="300" height="300" fill="#dbeafe"/>
        <path d="M300 0V300" stroke="#64748b" stroke-width="4"/>
        <text x="150" y="145" text-anchor="middle" fill="#115e59" font-family="sans-serif" font-size="28">Singapore stage</text>
        <text x="450" y="145" text-anchor="middle" fill="#1e40af" font-family="sans-serif" font-size="28">Shanghai loading</text>
      </svg>
    `);
  });
  app.get("/tests/media-embeds/floor-plan-compact.svg", (context) => {
    context.header("content-type", "image/svg+xml; charset=utf-8");
    return context.body(`
      <svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300">
        <rect width="300" height="300" fill="#d1fae5"/>
        <rect x="300" width="300" height="300" fill="#e0e7ff"/>
        <path d="M300 0V300" stroke="#475569" stroke-width="4"/>
        <text x="150" y="145" text-anchor="middle" fill="#065f46" font-family="sans-serif" font-size="26">SG stage</text>
        <text x="450" y="145" text-anchor="middle" fill="#3730a3" font-family="sans-serif" font-size="26">SH loading</text>
      </svg>
    `);
  });
  app.get("/tests/media-embeds/loading-bay.webm", (context) => {
    context.header("content-type", "video/webm");
    context.header("cache-control", "no-store");
    return context.body(loadingBayVideo);
  });
  app.get("/tests/media-embeds/dispatcher-note.ogg", (context) => {
    context.header("content-type", "audio/ogg");
    context.header("cache-control", "no-store");
    return context.body(dispatcherAudio);
  });
  app.get("/tests/media-embeds/loading-bay.vtt", (context) => {
    context.header("content-type", "text/vtt; charset=utf-8");
    return context.body(
      "WEBVTT\n\n00:00.000 --> 00:01.800\nLoading bay clear for overnight access.\n",
    );
  });
  app.get("/tests/media-embeds/safety-checklist", (context) =>
    context.html(
      mediaEvidenceDocument(
        "Safety checklist",
        "Confirm safety checklist",
        "safety-checklist",
      ),
    ),
  );
  app.get("/tests/media-embeds/customs-receipt", (context) =>
    context.html(
      mediaEvidenceDocument(
        "Customs receipt",
        "Confirm customs receipt",
        "customs-receipt",
      ),
    ),
  );
  app.get("/tests/media-embeds/insurance-certificate", (context) =>
    context.html(
      mediaEvidenceDocument(
        "Insurance certificate",
        "Confirm insurance certificate",
        "insurance-certificate",
      ),
    ),
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
  let latestProgress = {};
  let broadcastProgress = () => {};
  const app = createTestSiteApp(taskName, {
    onProgressChange(progress) {
      latestProgress = { ...progress };
      broadcastProgress(latestProgress);
    },
  });
  let server;
  const info = await new Promise((resolve, reject) => {
    server = serve(
      { fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
      resolve,
    );
    server.once("error", reject);
  });
  const webSocketServer = new WebSocketServer({ noServer: true });
  const clients = new Set();
  webSocketServer.on("connection", (socket) => {
    clients.add(socket);
    socket.once("close", () => clients.delete(socket));
    socket.send(JSON.stringify({ progress: latestProgress }));
  });
  broadcastProgress = (progress) => {
    const message = JSON.stringify({ progress });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    }
  };
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(
      request.url || "/",
      `http://${request.headers.host || "127.0.0.1"}`,
    );
    if (url.pathname !== "/api/test-progress/events") {
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit("connection", client, request);
    });
  });
  realtimeServers.set(server, { clients, webSocketServer });
  return { server, baseUrl: `http://127.0.0.1:${info.port}` };
}

export async function closeTestSite(server) {
  if (!server) return;
  const realtime = realtimeServers.get(server);
  if (realtime) {
    for (const client of realtime.clients) client.terminate();
    await new Promise((resolve) => realtime.webSocketServer.close(resolve));
    realtimeServers.delete(server);
  }
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}

export default createTestSiteApp("development");
