import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { closeFixtureServer, startFixtureServer } from "./fixture.mjs";
import { TEST_CASES } from "./site/test-cases.mjs";

const { createTestSiteApp } = await import("./site/dist/server.mjs");
const { default: createViteConfig } = await import("./site/vite.config.js");

const interactiveRoutes = [
  "clicks",
  "hover",
  "drag-drop",
  "canvas",
  "forms",
  "keyboard",
  "uploads",
  "scroll",
  "dialogs",
  "downloads",
  "frames",
  "navigation",
  "network",
  "svg-mathml",
  "text-content",
  "inline-semantics",
  "media-embeds",
  "table-semantics",
  "native-form-controls",
  "web-components",
  "contract-amendment",
  "interactive-elements",
  "legacy-elements",
];

test("Hono test site exposes a Vite development command", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("./site/package.json", import.meta.url)),
  );

  assert.equal(packageJson.scripts.dev, "vite");
});

test("Vite development server stays scoped to localhost", () => {
  const config = createViteConfig({ command: "serve", mode: "development" });

  assert.equal(config.server?.host, "localhost");
});

test("Hono test site uses local Bootstrap CSS without Bootstrap JavaScript", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("./site/package.json", import.meta.url)),
  );
  const layoutSource = await readFile(
    new URL("./site/src/components/layout.jsx", import.meta.url),
    "utf8",
  );
  const response =
    await createTestSiteApp("bootstrap-test").request("/tests/forms");
  const html = await response.text();

  assert.equal(packageJson.dependencies.bootstrap, "5.3.8");
  assert.match(layoutSource, /bootstrap\/dist\/css\/bootstrap\.min\.css\?raw/);
  assert.doesNotMatch(layoutSource, /bootstrap\/dist\/js|bootstrap\.bundle/);
  assert.match(html, /data-bs-theme=["']light["']/);
  assert.match(html, /data-ui-foundation=["']bootstrap["']/);
});

test("interactive fixtures use focused libraries for drag and whiteboard input", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("./site/package.json", import.meta.url)),
  );
  const app = createTestSiteApp("component-test");
  const dragHtml = await (await app.request("/tests/drag-drop")).text();
  const canvasHtml = await (await app.request("/tests/canvas")).text();

  assert.match(packageJson.dependencies.sortablejs, /^\^1\./);
  assert.match(packageJson.dependencies.konva, /^\^10\./);
  assert.match(dragHtml, /data-drag-handle/);
  assert.match(dragHtml, /aria-label=["']Drag checkout reassurance["']/);
  assert.match(canvasHtml, /data-background=["']dot-grid["']/);
  assert.match(canvasHtml, />Pencil</);
  assert.match(canvasHtml, />Brush</);
  assert.match(canvasHtml, />Marker</);
  assert.match(canvasHtml, />Eraser</);
  assert.match(canvasHtml, /aria-label=["']Redo stroke["']/);
  assert.match(canvasHtml, /aria-label=["']Export PNG["']/);
  assert.match(canvasHtml, /aria-label=["']Export SVG["']/);
});

test("download fixture records real archive requests", async () => {
  const app = createTestSiteApp("download-test");
  const before = await (await app.request("/api/download-status")).json();
  const download = await app.request("/api/download");
  const after = await (await app.request("/api/download-status")).json();

  assert.equal(before.requests, 0);
  assert.equal(download.status, 200);
  assert.match(
    download.headers.get("content-disposition") || "",
    /ego-browser-sample\.txt/,
  );
  assert.equal(await download.text(), "ego-browser download fixture\n");
  assert.equal(after.requests, 1);
});

test("frames fixture embeds the OpenStreetMap iframe example", async () => {
  const app = createTestSiteApp("nested-map-test");
  const checkoutHtml = await (await app.request("/frames/content")).text();
  const mapResponse = await app.request("/frames/map");

  assert.match(
    checkoutHtml,
    /<iframe[^>]+title=["']Pickup location map["'][^>]*>/,
  );
  assert.match(
    checkoutHtml,
    /src=["']https:\/\/www\.openstreetmap\.org\/export\/embed\.html\?bbox=-0\.004017949104309083%2C51\.47612752641776%2C0\.00030577182769775396%2C51\.478569861898606&amp;layer=mapnik["']/,
  );
  assert.match(checkoutHtml, /loading=["']lazy["']/);
  assert.equal(mapResponse.status, 404);
});

test("Hono test site promotes its route list to the page heading", async () => {
  const response = await createTestSiteApp("heading-test").request("/");
  const html = await response.text();

  assert.match(html, /<h1>Test routes<\/h1>/);
  assert.doesNotMatch(html, /<h2>Test routes<\/h2>/);
});

test("every scenario exposes a visible navigation link back to home", async () => {
  const response = await createTestSiteApp("scenario-navigation-test").request(
    "/tests/clicks",
  );
  const html = await response.text();

  assert.match(html, /<nav[^>]*aria-label="Scenario navigation"/);
  assert.match(html, /<a[^>]*href="\/"[^>]*>← All fixtures<\/a>/);
  assert.match(
    html,
    /<nav[^>]*aria-label="Scenario navigation"[^>]*>.*?<\/nav><p class="eyebrow">/,
  );
});

test("Hono test site keeps the route panel close to the app bar", async () => {
  const styles = await readFile(
    new URL("./site/src/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(
    styles,
    /\.index-shell\s*\{[^}]*padding-block:\s*1rem 1\.25rem;/s,
  );
});

test("Hono test site fits all route rows into a compact desktop index", async () => {
  const styles = await readFile(
    new URL("./site/src/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(
    styles,
    /\.route-panel-heading\s*\{[^}]*padding:\s*0\.75rem 1rem;/s,
  );
  assert.match(
    styles,
    /\.route-row\s*\{[^}]*min-height:\s*4\.25rem;[^}]*padding:\s*0\.625rem 1rem;/s,
  );
});

test("Hono test site uses compact square progress markers", async () => {
  const styles = await readFile(
    new URL("./site/src/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(styles, /\.progress-dots\s*\{[^}]*gap:\s*0\.1875rem;/s);
  assert.match(
    styles,
    /\.progress-dot\s*\{[^}]*width:\s*0\.5rem;[^}]*height:\s*0\.5rem;[^}]*border-radius:\s*0\.125rem;/s,
  );
});

test("Hono test site separates aggregate progress from scenario controls", async () => {
  const app = createTestSiteApp("progress-test");
  const homeHtml = await (await app.request("/")).text();

  assert.match(homeHtml, /data-testid=["']test-progress-summary["']/);
  assert.match(homeHtml, /role=["']progressbar["']/);
  assert.equal(
    homeHtml.match(/\sdata-progress-dot=["']true["']/g)?.length,
    TEST_CASES.length,
  );
  assert.match(
    homeHtml,
    new RegExp(
      `data-progress-completed[^>]*>0<\\/output>\\s*\\/\\s*<span[^>]*data-progress-total[^>]*>${TEST_CASES.length}<\\/span>`,
    ),
  );
  assert.match(homeHtml, /src=["']\/assets\/progress\.js["']/);

  for (const testCase of TEST_CASES) {
    const html = await (await app.request(testCase.route)).text();
    const appHeader = html.match(
      /<header[^>]*data-testid=["']app-header["'][^>]*>[\s\S]*?<\/header>/,
    )?.[0];
    const scenarioHeader = html.match(
      /<header[^>]*class=["'][^"']*test-header[^"']*["'][^>]*>[\s\S]*?<\/header>/,
    )?.[0];

    assert.ok(appHeader, `${testCase.slug} renders the shared app header`);
    assert.match(appHeader, /class=["'][^"']*sticky-top/);
    assert.match(appHeader, /data-testid=["']test-progress-summary["']/);
    assert.equal(
      appHeader.match(/data-progress-dot/g)?.length,
      TEST_CASES.length,
    );
    assert.doesNotMatch(appHeader, /data-test-progress-controls/);
    assert.doesNotMatch(appHeader, />All fixtures</);

    assert.ok(scenarioHeader, `${testCase.slug} renders its scenario header`);
    assert.match(scenarioHeader, /data-testid=["']scenario-test-controls["']/);
    assert.match(scenarioHeader, /data-testid=["']start-test["']/);
    assert.match(scenarioHeader, /data-testid=["']finish-test["']/);
    assert.match(scenarioHeader, /data-testid=["']fail-test["']/);
    assert.match(
      scenarioHeader,
      new RegExp(`data-test-slug=["']${testCase.slug}["']`),
    );
    assert.match(html, /src=["']\/assets\/progress\.js["']/);
  }
});

test("Hono test site shares scenario progress between browser processes", async () => {
  const app = createTestSiteApp("shared-progress-test");
  const initial = await (await app.request("/api/test-progress")).json();
  assert.deepEqual(initial, { progress: {} });

  const update = await app.request("/api/test-progress/clicks", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "in-progress" }),
  });
  assert.equal(update.status, 200);
  assert.deepEqual(await update.json(), {
    progress: { clicks: "in-progress" },
  });

  const shared = await (await app.request("/api/test-progress")).json();
  assert.deepEqual(shared, { progress: { clicks: "in-progress" } });

  const invalid = await app.request("/api/test-progress/clicks", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "unknown" }),
  });
  assert.equal(invalid.status, 400);

  const client = await readFile(
    new URL("./site/src/progress/client.js", import.meta.url),
    "utf8",
  );
  assert.match(client, /new WebSocket\(/);
  assert.match(client, /\/api\/test-progress\/events/);
  assert.doesNotMatch(client, /new EventSource\(/);
  assert.doesNotMatch(client, /localStorage/);
});

test(
  "running test site broadcasts progress to more than six realtime clients",
  { timeout: 5_000 },
  async (t) => {
    const fixture = await startFixtureServer("realtime-progress-test");
    const clients = Array.from({ length: 8 }, () => {
      const socket = new WebSocket(
        fixture.baseUrl.replace(/^http/, "ws") + "/api/test-progress/events",
      );
      const messages = [];
      const waiters = [];
      socket.addEventListener("message", (event) => {
        const payload = JSON.parse(String(event.data));
        const waiter = waiters.shift();
        if (waiter) waiter(payload);
        else messages.push(payload);
      });
      return {
        socket,
        opened: new Promise((resolve, reject) => {
          socket.addEventListener("open", resolve, { once: true });
          socket.addEventListener("error", reject, { once: true });
        }),
        nextMessage() {
          if (messages.length > 0) return Promise.resolve(messages.shift());
          return new Promise((resolve) => waiters.push(resolve));
        },
      };
    });
    t.after(async () => {
      for (const client of clients) client.socket.close();
      await closeFixtureServer(fixture.server);
    });

    await Promise.all(clients.map((client) => client.opened));
    const initial = await Promise.all(
      clients.map((client) => client.nextMessage()),
    );
    assert.deepEqual(
      initial,
      Array.from({ length: 8 }, () => ({ progress: {} })),
    );

    const updates = clients.map((client) => client.nextMessage());
    const response = await fetch(
      `${fixture.baseUrl}/api/test-progress/clicks`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "in-progress" }),
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(
      await Promise.all(updates),
      Array.from({ length: 8 }, () => ({
        progress: { clicks: "in-progress" },
      })),
    );
  },
);

test("Hono test site exposes the health endpoint used by native Playwright e2e", async () => {
  const health = await createTestSiteApp("health-test").request("/healthz");
  assert.equal(health.status, 200);
  const payload = await health.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.taskName, "health-test");
  assert.equal(payload.fixture, "ego-browser-hono-test-site");
  assert.equal(typeof payload.now, "number");
});

test("document startup fixture serves real metadata, resources, and a no-script recovery path", async () => {
  const app = createTestSiteApp("document-startup-test");
  const response = await app.request("/tests/document-startup");
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /^<!doctype html><html[^>]+lang=["']en-SG["']/);
  assert.match(html, /<base[^>]+href=["']\/tests\/document-startup\/["']/);
  assert.match(html, /<meta[^>]+charset=["']utf-8["']/);
  assert.match(html, /<meta[^>]+name=["']viewport["']/);
  assert.match(html, /<meta[^>]+name=["']description["']/);
  assert.match(
    html,
    /<link[^>]+rel=["']stylesheet["'][^>]+href=["']theme\.css["']/,
  );
  assert.match(html, /<title>Northstar workspace · Ego Browser Lab<\/title>/);
  assert.match(html, /<style[^>]+data-startup-core=["']true["']/);
  assert.match(html, /<script[^>]+src=["']startup\.js["'][^>]*><\/script>/);
  assert.match(
    html,
    /<a[^>]+class=["']startup-action["'][^>]+href=["']workspace["'][^>]*>\s*Open the operations workspace\s*<\/a>/,
  );
  assert.match(
    html,
    /<noscript>[\s\S]*<a[^>]+href=["']recovery["'][^>]*>\s*Open the no-script recovery guide\s*<\/a>[\s\S]*<\/noscript>/,
  );
  assert.doesNotMatch(
    html,
    /scenario-test-controls|test-progress-summary|progress\.js/,
  );

  const stylesheet = await app.request("/tests/document-startup/theme.css");
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get("content-type") || "", /text\/css/);
  assert.match(
    await stylesheet.text(),
    /--startup-accent:\s*rgb\(15, 118, 110\)/,
  );

  const script = await app.request("/tests/document-startup/startup.js");
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type") || "", /javascript/);
  assert.match(await script.text(), /data-startup-state/);

  const workspace = await app.request("/tests/document-startup/workspace");
  assert.equal(workspace.status, 200);
  assert.match(await workspace.text(), /<h1>Operations workspace<\/h1>/);

  const recovery = await app.request("/tests/document-startup/recovery");
  assert.equal(recovery.status, 200);
  assert.match(await recovery.text(), /<h1>No-script recovery guide<\/h1>/);
});

test("document outline fixture composes one main landmark and every authored heading level", async () => {
  const response = await createTestSiteApp("document-outline-test").request(
    "/tests/document-outline",
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(html.match(/<main\b/g)?.length, 1);
  assert.equal(html.match(/<h1\b/g)?.length, 2);
  for (const element of [
    "address",
    "article",
    "aside",
    "footer",
    "header",
    "hgroup",
    "nav",
    "search",
    "section",
  ]) {
    assert.match(html, new RegExp(`<${element}\\b`), element);
  }
  for (let level = 1; level <= 6; level += 1) {
    assert.match(html, new RegExp(`<h${level}\\b`), `h${level}`);
  }
});

test("text content fixture renders the complete incident handoff document", async () => {
  const response = await createTestSiteApp("text-content-test").request(
    "/tests/text-content",
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  for (const element of [
    "blockquote",
    "dd",
    "div",
    "dl",
    "dt",
    "figcaption",
    "figure",
    "hr",
    "li",
    "menu",
    "ol",
    "p",
    "pre",
    "ul",
  ]) {
    assert.match(html, new RegExp(`<${element}\\b`), element);
  }
  assert.match(html, /data-testid=["']incident-review-status["']/);
  assert.match(html, /<button[^>]+data-confirm-evidence/);
  assert.match(
    html,
    /<button(?=[^>]*data-complete-handoff)(?=[^>]*disabled)[^>]*>/,
  );
});

test("inline semantics fixture renders the complete localization proof", async () => {
  const response = await createTestSiteApp("inline-semantics-test").request(
    "/tests/inline-semantics",
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Localized release proof/);
  assert.match(html, /Review terminology/);
  assert.match(html, /Open[\s\S]*pronunciation notes/);
  assert.match(html, /Approve localized release/);
  assert.match(html, /data-testid=["']localization-review-status["']/);
  assert.match(
    html,
    /<button(?=[^>]*data-approve-localization)(?=[^>]*disabled)[^>]*>/,
  );
});

test("media fixture renders native responsive, timed, mapped, and embedded content", async () => {
  const response = await createTestSiteApp("media-embeds-test").request(
    "/tests/media-embeds",
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Venue media readiness review/);
  assert.match(
    html,
    /<picture\b[\s\S]*<img\b[^>]*usemap=["']#venue-zones["']/i,
  );
  assert.match(html, /<map\b[^>]*name=["']venue-zones["']/);
  assert.match(html, /<video\b[^>]*controls/);
  assert.match(html, /<audio\b[^>]*controls/);
  assert.match(html, /<iframe\b[^>]*title=["']Safety checklist["']/);
  assert.match(html, /<object\b/);
  assert.match(html, /<embed\b/);
  assert.match(html, /<fencedframe\b/);
  assert.match(html, /data-testid=["']media-review-status["']/);
});

test("table fixture renders native grouped transfer commitments", async () => {
  const response = await createTestSiteApp("table-semantics-test").request(
    "/tests/table-semantics",
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Transfer commitments for 15 August 2026/);
  for (const element of [
    "table",
    "caption",
    "col",
    "colgroup",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
  ]) {
    assert.match(html, new RegExp(`<${element}\\b`), element);
  }
  assert.match(html, /scope=["']colgroup["']/);
  assert.match(html, /scope=["']rowgroup["']/);
  assert.match(html, /headers=["'][^"']*commitment-header/);
  assert.match(html, /aria-sort=["']none["']/);
  assert.match(html, /Review Singapore to Shanghai transfer/);
  assert.match(html, /data-testid=["']selected-cases["']/);
  assert.match(html, /data-testid=["']selected-value["']/);
  assert.match(html, /data-testid=["']transfer-review-status["']/);
  assert.doesNotMatch(
    html,
    /role=["'](?:table|rowgroup|row|columnheader|rowheader|cell|checkbox)["']/,
  );
});

test("native form fixture renders the complete cross-border release review", async () => {
  const response = await createTestSiteApp("native-form-controls-test").request(
    "/tests/native-form-controls",
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Cross-border release review/);
  for (const element of [
    "button",
    "datalist",
    "fieldset",
    "form",
    "input",
    "label",
    "legend",
    "meter",
    "optgroup",
    "option",
    "output",
    "progress",
    "select",
    "selectedcontent",
    "textarea",
  ]) {
    assert.match(html, new RegExp(`<${element}\\b`), element);
  }
  assert.match(
    html,
    /<input\b(?=[^>]*id=["']release-reference["'])(?=[^>]*required)(?=[^>]*pattern=)[^>]*>/,
  );
  assert.match(html, /list=["']launch-city-list["']/);
  assert.match(html, /<option\b[^>]*value=["']Shanghai["']/);
  assert.match(html, /<optgroup\b[^>]*label=["']Southeast Asia["']/);
  assert.match(html, /<optgroup\b[^>]*label=["']Greater China["']/);
  assert.match(html, /<selectedcontent\b/);
  assert.match(html, /for=["']risk-buffer["']/);
  assert.match(html, /for=["']review-progress["']/);
  assert.match(
    html,
    /<progress\b(?=[^>]*max=["']5["'])(?=[^>]*value=["']0["'])[^>]*>/,
  );
  assert.match(html, /<textarea\b[^>]*min[Ll]ength=["']30["']/);
  assert.match(html, /data-testid=["']native-form-data["']/);
  const formHtml =
    html.match(
      /<form\b[^>]*id=["']cross-border-release-review["'][\s\S]*?<\/form>/,
    )?.[0] || "";
  assert.doesNotMatch(formHtml, /\b(?:role|novalidate)=/);
});

test("web components fixture authors an inert shipment template and two hosts", async () => {
  const response = await createTestSiteApp("web-components-test").request(
    "/tests/web-components",
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Shipment component review/);
  assert.match(
    html,
    /<template\b[^>]*id=["']shipment-card-template["'][\s\S]*<slot\b[^>]*name=["']reference["']/,
  );
  assert.match(html, /<slot\b[^>]*name=["']route["']/);
  assert.match(html, /<slot>\s*No review notes supplied\./);
  assert.equal(html.match(/<shipment-card\b/g)?.length, 2);
  assert.match(html, /slot=["']reference["']/);
  assert.match(html, /slot=["']route["']/);
  assert.match(html, /data-testid=["']shadow-click-path["']/);
  assert.match(html, /data-testid=["']shadow-custom-event-path["']/);
  assert.doesNotMatch(html, /shadowrootmode=/);
});

test("contract amendment fixture renders both CR-482 revisions and review state", async () => {
  const response = await createTestSiteApp("contract-amendment-test").request(
    "/tests/contract-amendment",
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Contract amendment CR-482/);
  assert.match(
    html,
    /<del\b(?=[^>]*cite=["']\/change-requests\/CR-482["'])(?=[^>]*dateTime=["']2026-08-15T09:30:00\+08:00["'])[^>]*>\s*within 60 minutes of a severity-one incident\s*<\/del>/,
  );
  assert.match(
    html,
    /<ins\b(?=[^>]*cite=["']\/change-requests\/CR-482["'])(?=[^>]*dateTime=["']2026-08-15T09:30:00\+08:00["'])[^>]*>\s*within 30 minutes of a severity-one incident\s*<\/ins>/,
  );
  assert.match(html, />\s*Accept amendment\s*</);
  assert.match(
    html,
    /<button\b(?=[^>]*data-amendment-history)(?=[^>]*disabled)[^>]*>\s*Undo acceptance\s*<\/button>/,
  );
  assert.doesNotMatch(html, />\s*Restore acceptance\s*</);
  assert.match(html, /data-testid=["']amendment-review-status["']/);
  assert.match(html, /Pending legal acceptance for CR-482/);
  assert.doesNotMatch(html, /<(?:del|ins)\b[^>]*\brole=/);
});

test("interactive fixture renders native disclosure, geolocation, and dialog markup", async () => {
  const response = await createTestSiteApp("interactive-elements-test").request(
    "/tests/interactive-elements",
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Dispatch interaction review/);
  assert.match(html, /<details\b[\s\S]*<summary\b/);
  assert.match(
    html,
    /<geolocation\b[\s\S]*<button\b[^>]*data-manual-location-fallback/,
  );
  assert.match(html, /<dialog\b[^>]*id=["']dispatch-decision-dialog["']/);
  assert.match(html, /<form\b[^>]*method=["']dialog["']/);
  assert.match(
    html,
    /<button\b(?=[^>]*value=["']confirmed["'])(?=[^>]*autofocus)[^>]*>/,
  );
  assert.match(html, /data-testid=["']details-toggle-status["']/);
  assert.match(html, /data-testid=["']geolocation-validation-status["']/);
  assert.match(html, /data-testid=["']dialog-decision-status["']/);
  assert.doesNotMatch(
    html,
    /<(?:details|summary|geolocation|dialog)\b[^>]*\brole=/,
  );
});

test("Hono test site links and renders every dedicated browser scenario", async () => {
  const app = createTestSiteApp("routes-test");
  const home = await app.request("/");
  assert.equal(home.status, 200);
  const homeHtml = await home.text();

  for (const testCase of TEST_CASES) {
    assert.match(homeHtml, new RegExp(`href=["']${testCase.route}["']`));
    const response = await app.request(testCase.route);
    assert.equal(response.status, 200, testCase.route);
    const html = await response.text();
    assert.match(html, new RegExp(`<h1>${testCase.title}</h1>`));
    assert.match(html, new RegExp(`data-test-route=["']${testCase.route}["']`));
  }
});

test("interactive fixtures load served ES modules instead of inline scripts", async (t) => {
  const fixture = await startFixtureServer("module-test");
  t.after(() => closeFixtureServer(fixture.server));

  for (const slug of interactiveRoutes) {
    const response = await fetch(`${fixture.baseUrl}/tests/${slug}`);
    assert.equal(response.status, 200, slug);
    const html = await response.text();
    const modulePath = `/assets/${slug}.js`;

    assert.match(
      html,
      new RegExp(
        `<script[^>]+type=["']module["'][^>]+src=["']${modulePath}["'][^>]*></script>`,
      ),
      slug,
    );
    assert.doesNotMatch(html, /addEventListener\s*\(/, slug);

    const moduleResponse = await fetch(`${fixture.baseUrl}${modulePath}`);
    assert.equal(moduleResponse.status, 200, modulePath);
    assert.match(
      moduleResponse.headers.get("content-type") || "",
      /javascript/,
      modulePath,
    );
    assert.match(await moduleResponse.text(), /addEventListener/, modulePath);
  }
});

test("legacy supplier fixture renders imported deprecated markup and modern controls", async () => {
  const response = await createTestSiteApp("legacy-elements-test").request(
    "/tests/legacy-elements",
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Legacy supplier manifest compatibility/);
  assert.match(html, /not recommended for new documents/i);
  for (const element of [
    "acronym",
    "big",
    "center",
    "content",
    "dir",
    "font",
    "image",
    "marquee",
    "menuitem",
    "nobr",
    "noembed",
    "param",
    "rb",
    "rtc",
    "shadow",
    "strike",
    "tt",
    "xmp",
  ]) {
    assert.match(html, new RegExp(`<${element}\\b`), element);
  }
  assert.match(
    html,
    /<dir\b[\s\S]*<a\b[^>]*href=["']#manifest-line-sup-208["']/,
  );
  assert.match(html, /<image\b[^>]*alt=["']Scanned supplier seal["']/);
  assert.match(
    html,
    /<param\b(?=[^>]*name=["']archive["'])(?=[^>]*value=["']supplier-manifest-v3\.pdf["'])/,
  );
  assert.match(html, /<marquee\b[^>]*scrollamount=["']0["']/i);
  assert.match(html, /<xmp\b[\s\S]*<button\b[^>]*id=["']xmp-fake-approve["']/);
  assert.match(html, />\s*Review imported manifest\s*</);
  assert.match(
    html,
    /<button\b(?=[^>]*data-approve-legacy-manifest)(?=[^>]*disabled)[^>]*>\s*Approve supplier manifest\s*<\/button>/,
  );
  assert.match(html, /data-testid=["']legacy-manifest-status["']/);
  assert.doesNotMatch(
    html,
    /<(?:acronym|big|center|content|dir|font|image|marquee|menuitem|nobr|noembed|param|rb|rtc|shadow|strike|tt|xmp)\b[^>]*\brole=/,
  );
});
