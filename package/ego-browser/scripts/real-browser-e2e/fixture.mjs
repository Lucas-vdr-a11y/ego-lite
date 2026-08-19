import { createServer } from "node:http";

export async function closeFixtureServer(fixtureServer) {
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1000);
    timer.unref?.();
    fixtureServer.close(() => {
      clearTimeout(timer);
      resolve();
    });
    fixtureServer.closeIdleConnections?.();
    fixtureServer.closeAllConnections?.();
  });
}

export async function startFixtureServer(taskName) {
  let crossSiteBaseUrl = "";
  const fixtureServer = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/healthz") {
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(
        JSON.stringify({
          ok: true,
          taskName,
          fixture: "ego-browser-real-e2e",
          now: Date.now(),
        }),
      );
      return;
    }
    if (url.pathname === "/api/json") {
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify({ ok: true, value: "json fixture" }));
      return;
    }
    if (url.pathname === "/api/text") {
      res.writeHead(200, {
        "content-type": "text/plain",
        "access-control-allow-origin": "*",
      });
      res.end("server text fixture");
      return;
    }
    if (url.pathname === "/api/header") {
      res.writeHead(200, {
        "content-type": "text/plain",
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
      });
      res.end(req.headers["x-e2e"] || "");
      return;
    }
    if (url.pathname === "/api/redirect") {
      res.writeHead(302, {
        location: "/api/text",
        "access-control-allow-origin": "*",
      });
      res.end();
      return;
    }
    if (url.pathname === "/api/echo") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        res.writeHead(200, {
          "content-type": "text/plain",
          "access-control-allow-origin": "*",
        });
        res.end(`echo:${req.method}:${body}`);
      });
      return;
    }
    if (url.pathname === "/api/request-info") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        res.writeHead(201, {
          "content-type": "application/json",
          "x-fixture-response": "page-fetch",
        });
        res.end(
          JSON.stringify({
            method: req.method,
            path: url.pathname,
            cookie: req.headers.cookie || "",
            origin: req.headers.origin || "",
            requestHeader: req.headers["x-page-fetch"] || "",
            body,
          }),
        );
      });
      return;
    }
    if (url.pathname === "/api/error") {
      res.writeHead(500, {
        "content-type": "text/plain",
        "access-control-allow-origin": "*",
      });
      res.end("server error fixture");
      return;
    }
    if (url.pathname === "/api/slow") {
      const delayMs = Number(url.searchParams.get("ms") || 250);
      setTimeout(() => {
        res.writeHead(200, {
          "content-type": "text/plain",
          "access-control-allow-origin": "*",
        });
        res.end("slow fixture");
      }, delayMs);
      return;
    }
    if (url.pathname === "/api/status") {
      const code = Number(url.searchParams.get("code") || 200);
      res.writeHead(code, {
        "content-type": "text/plain",
        "access-control-allow-origin": "*",
      });
      res.end(`status ${code}`);
      return;
    }
    if (url.pathname === "/api/bytes") {
      const n = Math.max(0, Number(url.searchParams.get("n") || 0));
      res.writeHead(200, {
        "content-type": "text/plain",
        "access-control-allow-origin": "*",
      });
      res.end("a".repeat(n));
      return;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "*",
      });
      res.end();
      return;
    }
    if (url.pathname === "/frame.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(pageHtml("frame", { iframeUrl: null }));
      return;
    }
    if (url.pathname === "/nav-target") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(pageHtml("nav-target"));
      return;
    }
    if (url.pathname === "/secondary") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(pageHtml("secondary"));
      return;
    }
    if (url.pathname === "/visual") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(visualPageHtml());
      return;
    }
    if (url.pathname === "/slow-page") {
      const delayMs = Number(url.searchParams.get("ms") || 250);
      setTimeout(() => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          "<!doctype html><html><head><title>slow page</title></head>" +
            '<body><h1 id="slow-marker">slow document loaded</h1></body></html>',
        );
      }, delayMs);
      return;
    }
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(pageHtml("home", { iframeUrl: `${crossSiteBaseUrl}/frame.html` }));
  });

  await new Promise((resolve, reject) => {
    fixtureServer.once("error", reject);
    fixtureServer.listen(0, "127.0.0.1", () => resolve());
  });
  const address = fixtureServer.address();
  crossSiteBaseUrl = `http://localhost:${address.port}`;
  return {
    server: fixtureServer,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

function pageHtml(kind, { iframeUrl = "/frame.html" } = {}) {
  const title =
    kind === "nav-target"
      ? "ego-lite nav target"
      : kind === "secondary"
        ? "ego-lite secondary"
        : kind === "frame"
          ? "ego-lite iframe"
          : "ego-lite helper e2e";
  const heading =
    kind === "nav-target"
      ? "Navigation target"
      : kind === "secondary"
        ? "Secondary tab"
        : kind === "frame"
          ? "Iframe fixture"
          : "Helper e2e fixture";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 24px; }
      button, input { font: inherit; }
      #hover-zone, #drag-source, #drag-target {
        align-items: center;
        border: 1px solid #777;
        display: inline-flex;
        height: 64px;
        justify-content: center;
        margin: 8px;
        width: 160px;
      }
      #drag-target { background: #eef7ee; }
      #rich-editor {
        border: 1px solid #777;
        min-height: 48px;
        padding: 8px;
        width: 320px;
      }
      #context-menu-zone {
        align-items: center;
        background: #f7eef7;
        border: 1px dashed #777;
        display: inline-flex;
        height: 48px;
        justify-content: center;
        margin: 8px;
        width: 160px;
      }
      #dynamic-container { min-height: 24px; margin: 8px 0; }
      .tab-stop {
        border: 1px solid #999;
        display: inline-block;
        margin: 4px;
        padding: 4px 12px;
      }
      .tab-stop:focus { outline: 2px solid #44f; }
      #inner-scroll {
        border: 1px solid #777;
        height: 120px;
        margin-top: 12px;
        overflow: auto;
        width: 320px;
      }
      #inner-scroll-content { height: 620px; padding-top: 520px; }
      #scroll-area { height: 1800px; padding-top: 16px; }
      #bottom-marker { margin-top: 1450px; }
      #delayed { display: none; }
    </style>
  </head>
  <body>
    <main>
      <h1>${heading}</h1>
      <p data-testid="status">ready</p>
      <button id="click-button" aria-label="Increment counter">Click counter</button>
      <button class="duplicate-action" type="button">Duplicate action</button>
      <button class="duplicate-action" type="button">Duplicate action</button>
      <a id="nav-link" href="/nav-target">Go to nav target</a>
      <span id="click-count">0</span>
      <div id="hover-zone">Hover zone</div>
      <div id="drag-source">Drag source</div>
      <div id="drag-target">Drag target</div>
      <label>Text input <input id="text-input" value="initial"></label>
      <label>Append input <input id="append-input" value="base"></label>
      <label>Text area <textarea id="text-area">seed</textarea></label>
      <label for="file-input">File input</label>
      <input id="file-input" type="file" multiple hidden>
      <button id="dynamic-file-button" type="button">Choose files dynamically</button>
      <div id="dynamic-file-container"></div>
      <div id="file-name"></div>
      <div id="key-log"></div>
      <label>Dropdown <select id="dropdown">
        <option value="alpha">Alpha</option>
        <option value="beta">Beta</option>
        <option value="gamma">Gamma</option>
      </select></label>
      <label><input type="checkbox" id="checkbox"> Toggle checkbox</label>
      <div id="rich-editor" contenteditable="true">edit me</div>
      <div id="context-menu-zone">Right-click here</div>
      <button id="add-element" type="button">Add element</button>
      <button id="remove-element" type="button">Remove element</button>
      <div id="dynamic-container"></div>
      <div id="tab-trap">
        <span class="tab-stop" tabindex="0" data-tab="first">First</span>
        <span class="tab-stop" tabindex="0" data-tab="second">Second</span>
        <span class="tab-stop" tabindex="0" data-tab="third">Third</span>
      </div>
      <div id="delayed">Delayed element</div>
      <div id="never-visible" style="display:none">Never visible</div>
      ${iframeUrl ? `<iframe id="fixture-frame" src="${iframeUrl}"></iframe>` : ""}
      <div id="inner-scroll"><div id="inner-scroll-content">Inner scroll marker</div></div>
      <section id="scroll-area"><div id="bottom-marker">Bottom marker</div></section>
      <label>Email input <input id="email-input" type="email" value="old@example.com"></label>
      <label>Number input <input id="number-input" type="number" value="123"></label>
      <label>Controlled input <input id="controlled-input" type="text"></label>
      <span id="controlled-state"></span>
      ${kind === "frame" ? '<div id="iframe-marker" data-iframe="true" style="border:2px solid #44f;padding:8px;margin-top:8px;">iframe target</div>' : ""}
    </main>
    <script>
      window.__fixtureState = {
        clicks: 0,
        doubleClicks: 0,
        dragged: false,
        hovered: false,
        keyEvents: [],
        keys: [],
        lastClickDetail: 0,
        lastDoubleClickDetail: 0,
        pointerEvents: [],
        rightClicked: false,
        dynamicElementExists: false,
        tabOrder: [],
        checkboxChecked: false,
        dropdownValue: "alpha",
        valueEvents: {},
      };
      const count = document.querySelector("#click-count");
      const clickButton = document.querySelector("#click-button");
      for (const type of ["mousemove", "mousedown", "mouseup", "click", "dblclick"]) {
        document.addEventListener(
          type,
          (event) => {
            window.__fixtureState.pointerEvents.push({
              type,
              target: event.target.id || event.target.tagName,
              detail: event.detail,
              x: event.clientX,
              y: event.clientY,
              trusted: event.isTrusted,
            });
          },
          true,
        );
      }
      clickButton.addEventListener("click", (event) => {
        window.__fixtureState.clicks += 1;
        window.__fixtureState.lastClickDetail = event.detail;
        count.textContent = String(window.__fixtureState.clicks);
      });
      clickButton.addEventListener("dblclick", (event) => {
        window.__fixtureState.doubleClicks += 1;
        window.__fixtureState.lastDoubleClickDetail = event.detail;
      });
      for (const type of ["mousemove", "mouseover"]) {
        document.querySelector("#hover-zone").addEventListener(type, () => {
          window.__fixtureState.hovered = true;
        });
      }
      let dragging = false;
      document.querySelector("#drag-source").addEventListener("mousedown", () => {
        dragging = true;
      });
      document.querySelector("#drag-target").addEventListener("mouseup", () => {
        if (dragging) window.__fixtureState.dragged = true;
        dragging = false;
      });
      document.querySelector("#text-input").addEventListener("keydown", (event) => {
        window.__fixtureState.keys.push(event.key);
        window.__fixtureState.keyEvents.push({
          type: event.type,
          key: event.key,
          value: event.target.value,
        });
        document.querySelector("#key-log").textContent = window.__fixtureState.keys.join(",");
      });
      for (const type of ["beforeinput", "input", "keyup"]) {
        document.querySelector("#text-input").addEventListener(type, (event) => {
          window.__fixtureState.keyEvents.push({
            type,
            key: event.key || event.inputType || "",
            value: event.target.value,
          });
        });
      }
      document.querySelector("#file-input").addEventListener("change", (event) => {
        document.querySelector("#file-name").textContent =
          Array.from(event.target.files).map((file) => file.name).join(",");
      });
      document.querySelector("#dynamic-file-button").addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.dataset.dynamicUpload = "true";
        document.querySelector("#dynamic-file-container").replaceChildren(input);
        input.click();
      });

      /* value inputs (email/number) — track input/change for fillInput regressions */
      for (const id of ["email-input", "number-input"]) {
        const valueInput = document.querySelector("#" + id);
        for (const type of ["input", "change"]) {
          valueInput.addEventListener(type, () => {
            (window.__fixtureState.valueEvents[id] ||= []).push(type);
          });
        }
      }

      /* react-style controlled input — every input event writes value back through
         the native prototype setter, mirroring React/Vue controlled components.
         Guards fillInput's persistence on inputs that fight back. */
      (function () {
        const el = document.querySelector("#controlled-input");
        const stateEl = document.querySelector("#controlled-state");
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set;
        let state = "";
        function render() {
          if (el.value !== state) setter.call(el, state);
          stateEl.textContent = state;
        }
        el.addEventListener("input", () => {
          state = el.value;
          render();
        });
        el.addEventListener("change", () => {
          stateEl.textContent = state + " (change)";
        });
        render();
      })();

      /* context menu zone — captures right-click */
      const contextZone = document.querySelector("#context-menu-zone");
      contextZone.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        window.__fixtureState.rightClicked = true;
      });

      /* dynamic DOM — add/remove elements */
      document.querySelector("#add-element").addEventListener("click", () => {
        const container = document.querySelector("#dynamic-container");
        if (!document.querySelector("#dynamic-element")) {
          const el = document.createElement("div");
          el.id = "dynamic-element";
          el.setAttribute("role", "status");
          el.textContent = "Dynamic!";
          el.style.cssText = "background:#efe;border:1px solid #7a7;padding:4px 8px;";
          container.appendChild(el);
          window.__fixtureState.dynamicElementExists = true;
        }
      });
      document.querySelector("#remove-element").addEventListener("click", () => {
        const el = document.querySelector("#dynamic-element");
        if (el) {
          el.remove();
          window.__fixtureState.dynamicElementExists = false;
        }
      });

      /* checkbox */
      document.querySelector("#checkbox").addEventListener("change", (event) => {
        window.__fixtureState.checkboxChecked = event.target.checked;
      });

      /* dropdown */
      document.querySelector("#dropdown").addEventListener("change", (event) => {
        window.__fixtureState.dropdownValue = event.target.value;
      });

      /* tab-trap focus tracking */
      for (const stop of document.querySelectorAll(".tab-stop")) {
        stop.addEventListener("focus", () => {
          window.__fixtureState.tabOrder.push(stop.dataset.tab);
        });
      }

      /* delayed element */
      setTimeout(() => {
        const delayed = document.querySelector("#delayed");
        delayed.style.display = "block";
      }, 350);
    </script>
  </body>
</html>`;
}

function visualPageHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>ego-lite visual fixture</title>
    <style>
      html, body { height: 100%; margin: 0; overflow: hidden; }
      body { background: #f4f6fa; }
      canvas { left: 100px; position: fixed; top: 100px; }
    </style>
  </head>
  <body>
    <canvas id="visual-canvas" width="320" height="180"></canvas>
    <script>
      const canvas = document.querySelector("#visual-canvas");
      const context = canvas.getContext("2d");
      window.__visualClicks = 0;

      function draw(active) {
        context.fillStyle = "#172033";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = active ? "#2563eb" : "#dc2626";
        context.fillRect(20, 20, 120, 60);
        context.fillStyle = "#ffffff";
        context.font = "20px sans-serif";
        context.fillText(active ? "DONE" : "CLICK", 45, 58);
      }

      canvas.addEventListener("click", (event) => {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        if (x >= 20 && x <= 140 && y >= 20 && y <= 80) {
          window.__visualClicks += 1;
          window.__visualTrusted = event.isTrusted;
          draw(true);
        }
      });
      draw(false);
    </script>
  </body>
</html>`;
}
