export const networkRoutingCase = {
  name: "Playwright network routing",
  kind: "platform",
  body() {
    return `
      const task = await egoBrowser.useOrCreateTaskSpace(taskName);
      const page = task.page;
      await page.goto(baseUrl + "/tests/network?platform=routing", {
        waitUntil: "load",
        timeout: 20_000,
      });

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
    `;
  },
};
