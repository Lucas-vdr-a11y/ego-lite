import { homeCase } from "./shared.mjs";

export const playwrightAdvancedPageCases = [
  {
    name: "Playwright page routes scripts bindings and handles",
    body: homeCase(`
      const pageHandle = await page.evaluateHandle(() => ({ answer: 42 }));
      assertEqual((await pageHandle.jsonValue()).answer, 42, "page.evaluateHandle retains an object");
      await pageHandle.dispose();

      const bodyHandle = await page.evaluateHandle(() => document.body);
      const cyclic = {};
      cyclic.self = cyclic;
      const structured = await page.evaluate(({ body, date, regexp, bigint, typed, cyclic }) => ({
        bodyTag: body.tagName,
        date,
        regexp,
        bigint,
        typed,
        cyclic,
      }), {
        body: bodyHandle,
        date: new Date("2026-08-01T00:00:00.000Z"),
        regexp: /ego.+/gi,
        bigint: 9007199254740993n,
        typed: new Uint16Array([7, 9]),
        cyclic,
      });
      assertEqual(structured.bodyTag, "BODY", "page.evaluate accepts a nested ElementHandle");
      assertEqual(structured.date.toISOString(), "2026-08-01T00:00:00.000Z", "page.evaluate preserves Date values");
      assertEqual(structured.regexp.source, "ego.+", "page.evaluate preserves RegExp values");
      assertEqual(structured.bigint, 9007199254740993n, "page.evaluate preserves BigInt values");
      assertEqual([...structured.typed].join(","), "7,9", "page.evaluate preserves typed arrays");
      assertEqual(structured.cyclic.self, structured.cyclic, "page.evaluate preserves cyclic values");
      assertEqual(
        await page.evaluate((value) => typeof value, () => {}),
        "undefined",
        "page.evaluate serializes function arguments like Playwright"
      );
      assertEqual(
        (await page.evaluate(() => {
          class CustomValue {
            toJSON() { return { answer: 42 }; }
          }
          return new CustomValue();
        })).answer,
        42,
        "page.evaluate honors custom toJSON results like Playwright"
      );

      const nestedHandle = await page.evaluateHandle(({ body }) => ({ tagName: body.tagName }), {
        body: bodyHandle,
      });
      assertEqual((await nestedHandle.jsonValue()).tagName, "BODY", "page.evaluateHandle accepts a nested JSHandle");
      await nestedHandle.dispose();

      const connected = await page.waitForFunction(({ body }) => body.isConnected, {
        body: bodyHandle,
      });
      assertEqual(await connected.jsonValue(), true, "page.waitForFunction accepts a nested JSHandle");
      await connected.dispose();

      const locator = page.locator("#click-button");
      assertEqual(
        await locator.evaluate((element, { body }) => body.contains(element), { body: bodyHandle }),
        true,
        "locator.evaluate accepts a nested JSHandle"
      );
      assertEqual(locator.page(), page, "locator.page returns its owning Page");
      const locatorHandle = await locator.evaluateHandle((element) => ({ id: element.id }));
      assertEqual((await locatorHandle.jsonValue()).id, "click-button", "locator.evaluateHandle retains its result");
      await locatorHandle.dispose();

      const script = await page.addScriptTag({
        content: "globalThis.__egoAddedScript = 'ready'",
      });
      assertEqual(await script.evaluate((element) => element.tagName), "SCRIPT", "addScriptTag returns an ElementHandle");
      assertEqual(
        await script.evaluate((element, { body }) => body.ownerDocument === element.ownerDocument, { body: bodyHandle }),
        true,
        "ElementHandle.evaluate accepts a nested JSHandle"
      );
      assertEqual(await page.evaluate(() => globalThis.__egoAddedScript), "ready", "addScriptTag executes inline content");
      await script.dispose();

      const style = await page.addStyleTag({
        content: "#click-button { outline-width: 7px; outline-style: solid; }",
      });
      assertEqual(await style.getAttribute("type"), null, "addStyleTag returns an ElementHandle");
      assertEqual(
        await locator.evaluate((element) => getComputedStyle(element).outlineWidth),
        "7px",
        "addStyleTag applies inline CSS"
      );
      await style.dispose();
      await bodyHandle.dispose();

      await page.exposeFunction("__egoE2EAdd", (left, right) => left + right);
      assertEqual(
        await page.evaluate(() => globalThis.__egoE2EAdd(2, 3)),
        5,
        "exposeFunction connects page JavaScript to the harness"
      );
      await page.exposeBinding("__egoE2EBinding", (source, value) => ({
        samePage: source.page === page,
        value,
      }));
      const bindingResult = await page.evaluate(() => globalThis.__egoE2EBinding("bound"));
      assertEqual(bindingResult.samePage, true, "exposeBinding supplies the owning Page");
      assertEqual(bindingResult.value, "bound", "exposeBinding forwards serializable arguments");

      await page.setExtraHTTPHeaders({ "x-e2e": "page-header" });
      assertEqual(
        await page.evaluate((url) => fetch(url).then((response) => response.text()), baseUrl + "/api/header"),
        "page-header",
        "setExtraHTTPHeaders applies to page requests"
      );
      await page.setExtraHTTPHeaders({});

      await page.route("**/api/routed-e2e", (route, request) => {
        assertEqual(request.method(), "GET", "route receives a Request facade");
        return route.fulfill({ status: 201, json: { routed: true } });
      }, { times: 1 });
      try {
        const routed = await page.evaluate((url) => fetch(url).then(async (response) => ({
          status: response.status,
          json: await response.json(),
        })), baseUrl + "/api/routed-e2e");
        assertEqual(routed.status, 201, "route.fulfill controls the response status");
        assertEqual(routed.json.routed, true, "route.fulfill returns JSON content");
      } finally {
        await page.unrouteAll({ behavior: "wait" });
      }

      const harPath = join(artifactDir, "page-route.har");
      const harUrl = baseUrl + "/api/from-har";
      await writeFile(harPath, JSON.stringify({
        log: {
          entries: [{
            request: { url: harUrl, method: "GET" },
            response: {
              status: 202,
              headers: [{ name: "content-type", value: "text/plain" }],
              content: { text: "HAR replay body" },
            },
          }],
        },
      }));
      await page.routeFromHAR(harPath);
      try {
        assertEqual(
          await page.evaluate((url) => fetch(url).then((response) => response.text()), harUrl),
          "HAR replay body",
          "routeFromHAR replays an embedded response"
        );
      } finally {
        await page.unrouteAll({ behavior: "wait" });
      }

      await page.routeWebSocket("ws://example.invalid/ego-e2e", (socket) => {
        socket.onMessage((message) => socket.send("echo:" + message));
      });
      assertEqual(
        await page.evaluate(() => new Promise((resolve, reject) => {
          const socket = new WebSocket("ws://example.invalid/ego-e2e");
          socket.onopen = () => socket.send("hello");
          socket.onmessage = (event) => resolve(event.data);
          socket.onerror = () => reject(new Error("routed WebSocket failed"));
        })),
        "echo:hello",
        "routeWebSocket can mock a WebSocket without a server"
      );

      await page.addInitScript((value) => {
        globalThis.__egoInitValue = value;
      }, "installed-before-navigation");
      await page.reload({ timeout: 5000 });
      assertEqual(
        await page.evaluate(() => globalThis.__egoInitValue),
        "installed-before-navigation",
        "addInitScript runs before the next document script"
      );
    `),
  },
  {
    name: "Playwright page frames environment and GC",
    body: homeCase(`
      const mainFrame = page.mainFrame();
      const frames = page.frames();
      const childFrame = page.frame({ url: (url) => url.pathname === "/frame.html" });
      assert(frames.length >= 2, "page.frames returns the main and child frames");
      assertEqual(mainFrame.page(), page, "mainFrame.page returns the owning Page");
      assert(childFrame, "page.frame finds a frame by URL");
      assertEqual(childFrame.parentFrame(), mainFrame, "child Frame links to its main Frame");
      assertEqual(
        await childFrame.evaluate(() => document.querySelector("#iframe-marker")?.textContent),
        "iframe target",
        "Frame.evaluate runs in the child document"
      );
      const frameHandle = await childFrame.evaluateHandle(() => ({ frameTitle: document.title }));
      assert((await frameHandle.jsonValue()).frameTitle, "Frame.evaluateHandle retains a frame value");
      await frameHandle.dispose();
      const frameElement = await childFrame.evaluateHandle(() => document.querySelector("#iframe-marker"));
      assertEqual(
        await childFrame.evaluate(({ element }) => element.textContent, { element: frameElement }),
        "iframe target",
        "Frame.evaluate accepts a JSHandle created in that Frame"
      );
      await frameElement.dispose();

      try {
        await page.setViewportSize({ width: 900, height: 700 });
        assertEqual(page.viewportSize().width, 900, "setViewportSize changes the viewport width");
        assertEqual(page.viewportSize().height, 700, "setViewportSize changes the viewport height");
        await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
        assertEqual(
          await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches),
          true,
          "emulateMedia applies colorScheme"
        );
        assertEqual(
          await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
          true,
          "emulateMedia applies reducedMotion"
        );
      } finally {
        await page.emulateMedia({});
        await setStableViewport();
      }

      await page.requestGC();
      assertEqual(await page.evaluate(() => 2 + 2), 4, "requestGC leaves the Page usable");
    `),
  },
  {
    name: "Playwright target-bound page clock",
    body: homeCase(`
      const originalTab = await tabs.current();
      const space = await egoBrowser.switchTaskSpace(taskName);
      const clockTab = await space.tabs.open(baseUrl + "/secondary", {
        wait: true,
        timeout: 5000,
      });
      try {
        const clockPage = clockTab.page;
        await clockPage.clock.install({ time: 1700000000000 });
        await clockPage.evaluate(() => {
          globalThis.__egoClockFired = false;
          setTimeout(() => { globalThis.__egoClockFired = true; }, 5000);
        });
        const before = await clockPage.evaluate(() => Date.now());
        await clockPage.clock.fastForward(5000);
        const after = await clockPage.evaluate(() => Date.now());
        assert(after - before >= 5000, "clock.fastForward advances Date.now");
        assert(after - before < 5100, "clock.fastForward advances by the requested duration");
        assertEqual(
          await clockPage.evaluate(() => globalThis.__egoClockFired),
          true,
          "clock.fastForward fires scheduled timers"
        );
        await clockPage.close();
        assertEqual(clockPage.isClosed(), true, "target-bound clock Page can close itself");
      } finally {
        if (!clockTab.page.isClosed()) await clockTab.close();
        await tabs.activate(originalTab);
      }
    `),
  },
];
