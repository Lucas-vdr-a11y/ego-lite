export const networkRoutingCase = {
  name: "Playwright network routing",
  kind: "platform",
  body() {
    return `
      const task = await openE2eTaskSpace(taskName);
      const page = task.page;
      await page.goto(baseUrl + "/tests/network?platform=routing", {
        waitUntil: "load",
        timeout: 20_000,
      });

      const nodeResponse = await fetch(baseUrl + "/tests/network?mode=node-fetch");
      assertEqual(nodeResponse.status, 200, "the Node global fetch remains callable");
      const requestResponse = await task.context.request.get(
        baseUrl + "/tests/network?mode=context-request",
      );
      assertEqual(requestResponse.status(), 200, "BrowserContext.request can read cookies and perform a request");

      const routeUrl = baseUrl + "/api/echo?mode=platform-route";
      let intercepted = 0;
      const handler = async (route) => {
        intercepted += 1;
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            echo: "intercepted by Playwright",
            source: "page.route",
          }),
        });
      };

      await page.route(routeUrl, handler);
      const interceptedResponse = await page.evaluate(async (url) => {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "original request" }),
        });
        return { status: response.status, body: await response.json() };
      }, routeUrl);
      assertEqual(intercepted, 1, "page.route intercepts the matching request once");
      assertEqual(
        interceptedResponse.status,
        201,
        "route.fulfill controls the browser response status",
      );
      assertEqual(
        interceptedResponse.body.echo,
        "intercepted by Playwright",
        "route.fulfill controls the browser response body",
      );

      await page.unroute(routeUrl, handler);
      const serverResponse = await page.evaluate(async (url) => {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "served after unroute" }),
        });
        return { status: response.status, body: await response.json() };
      }, routeUrl);
      assertEqual(
        intercepted,
        1,
        "page.unroute removes the registered request handler",
      );
      assertEqual(
        serverResponse.status,
        200,
        "the request reaches the fixture server after page.unroute",
      );
      assertEqual(
        serverResponse.body.echo,
        "served after unroute",
        "the fixture response is restored after page.unroute",
      );
      assertEqual(
        serverResponse.body.source,
        "ego-browser-hono-test-site",
        "the unhandled request comes from the real test server",
      );

      const continueUrl = baseUrl + "/api/echo?mode=route-continue";
      const continuedUrl = baseUrl + "/api/echo?mode=route-continued";
      let continued = 0;
      const continueHandler = async (route) => {
        continued += 1;
        await route.continue({ url: continuedUrl });
      };
      await page.route(continueUrl, continueHandler);
      const continuedResponse = await page.evaluate(async (url) => {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "continued request" }),
        });
        return { status: response.status, body: await response.json() };
      }, continueUrl);
      await page.unroute(continueUrl, continueHandler);
      assertEqual(continued, 1, "route.continue handles the matching request once");
      assertEqual(continuedResponse.body.mode, "route-continued", "route.continue rewrites the request URL before it reaches the server");
      assertEqual(continuedResponse.status, 200, "a continued request receives the real server response");
      assertEqual(continuedResponse.body.echo, "continued request", "route.continue preserves the request body");

      const abortUrl = baseUrl + "/api/echo?mode=route-abort";
      const abortHandler = (route) => route.abort("failed");
      await page.route(abortUrl, abortHandler);
      const failedRequestPromise = page.waitForEvent("requestfailed", {
        predicate: (request) => request.url() === abortUrl,
        timeout: 5_000,
      });
      const abortedFetch = page.evaluate(async (url) => {
        try {
          await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ message: "must not reach the server" }),
          });
          return "resolved";
        } catch (error) {
          return error.name;
        }
      }, abortUrl);
      const failedRequest = await failedRequestPromise;
      assertEqual(await abortedFetch, "TypeError", "route.abort rejects the browser fetch");
      assertIncludes(failedRequest.failure()?.errorText || "", "ERR_FAILED", "requestfailed exposes the route.abort failure reason");
      await page.unroute(abortUrl, abortHandler);
    `;
  },
};
