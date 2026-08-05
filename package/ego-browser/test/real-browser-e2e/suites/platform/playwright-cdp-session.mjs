export const playwrightCdpSessionCase = {
  name: "Playwright CDP session",
  kind: "platform",
  body() {
    return `
      const task = await openE2eTaskSpace(taskName);
      const page = task.page;
      await page.goto(baseUrl + "/tests/network?platform=cdp-session", {
        waitUntil: "load",
        timeout: 20_000,
      });

      const browserSession = await task.context
        .browser()
        .newBrowserCDPSession();
      try {
        const browserVersion = await browserSession.send("Browser.getVersion");
        assertEqual(browserVersion.protocolVersion, "1.3", "browser CDPSession receives compatibility responses on its own session");
        assertIncludes(browserVersion.product, "Chrome/", "browser CDPSession preserves compatibility response payloads");
      } finally {
        await browserSession.detach();
      }

      const session = await task.context.newCDPSession(page);
      const bindingName = "__egoCdpSessionProbe_" + Date.now().toString(36);
      const bindingPayload = "playwright-cdp-event";

      function waitForCdpEvent(eventName, predicate, timeoutMs = 5_000) {
        return new Promise((resolve, reject) => {
          const onEvent = (event) => {
            if (!predicate(event)) return;
            clearTimeout(timer);
            session.off(eventName, onEvent);
            resolve(event);
          };
          const timer = setTimeout(() => {
            session.off(eventName, onEvent);
            reject(new Error("timed out waiting for CDP event " + eventName));
          }, timeoutMs);
          session.on(eventName, onEvent);
        });
      }

      try {
        const evaluation = await session.send("Runtime.evaluate", {
          expression: "({ title: document.title, url: location.href })",
          returnByValue: true,
        });
        assertIncludes(
          evaluation.result.value.title,
          "Ego Browser Lab",
          "Playwright CDPSession sends commands to the selected page",
        );
        assertIncludes(
          evaluation.result.value.url,
          "/tests/network?platform=cdp-session",
          "Playwright CDPSession is scoped to the current TaskSpace page",
        );

        await session.send("Runtime.enable");
        await session.send("Runtime.addBinding", { name: bindingName });
        const bindingEventPromise = waitForCdpEvent(
          "Runtime.bindingCalled",
          (event) =>
            event.name === bindingName && event.payload === bindingPayload,
        );
        await page.evaluate(
          ({ name, payload }) => globalThis[name](payload),
          { name: bindingName, payload: bindingPayload },
        );
        const bindingEvent = await bindingEventPromise;
        assertEqual(
          bindingEvent.name,
          bindingName,
          "Playwright CDPSession emits subscribed protocol events",
        );
        assertEqual(
          bindingEvent.payload,
          bindingPayload,
          "Playwright CDPSession preserves protocol event payloads",
        );
        assertEqual(
          typeof bindingEvent.executionContextId,
          "number",
          "Playwright CDPSession reports the event execution context",
        );

        await session.send("Network.enable");
        const requestUrl = baseUrl + "/api/echo?mode=cdp-session";
        const responseEventPromise = waitForCdpEvent(
          "Network.responseReceived",
          (event) => event.response?.url === requestUrl,
        );
        const browserResponse = await page.evaluate(async (url) => {
          const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ message: "cdp network event" }),
          });
          return { status: response.status, body: await response.json() };
        }, requestUrl);
        const responseEvent = await responseEventPromise;
        assertEqual(
          responseEvent.response.status,
          200,
          "Playwright CDPSession receives browser network events",
        );
        assertEqual(
          browserResponse.status,
          200,
          "the request observed through CDP completes in the page",
        );
        assertEqual(
          browserResponse.body.echo,
          "cdp network event",
          "the observed request preserves its application payload",
        );

        const secondarySession = await task.context.newCDPSession(page);
        const currentTitle = await page.title();
        let concurrentEvaluations;
        try {
          concurrentEvaluations = await Promise.all([
            session.send("Runtime.evaluate", {
              expression: "'primary-' + document.title",
              returnByValue: true,
            }),
            secondarySession.send("Runtime.evaluate", {
              expression: "'secondary-' + document.title",
              returnByValue: true,
            }),
          ]);
        } finally {
          await secondarySession.detach();
        }
        assertEqual(concurrentEvaluations[0].result.value, "primary-" + currentTitle, "the primary CDP session completes while another session is attached");
        assertEqual(concurrentEvaluations[1].result.value, "secondary-" + currentTitle, "a second CDP session independently completes commands");
        const primaryAfterSecondaryDetach = await session.send("Runtime.evaluate", {
          expression: "location.pathname",
          returnByValue: true,
        });
        assertEqual(primaryAfterSecondaryDetach.result.value, "/tests/network", "detaching the second CDP session preserves the primary session");
      } finally {
        await session.detach();
      }

      let detachedError;
      try {
        await session.send("Runtime.evaluate", { expression: "1" });
      } catch (error) {
        detachedError = error;
      }
      assert(
        detachedError && /closed|detached|session/i.test(detachedError.message),
        "detached CDP session rejects later commands",
      );

      await page.goto(baseUrl + "/tests/forms?platform=cdp-session-remapped", {
        waitUntil: "load",
        timeout: 20_000,
      });
      const remappedSession = await task.context.newCDPSession(page);
      try {
        const remappedEvaluation = await remappedSession.send(
          "Runtime.evaluate",
          {
            expression: "location.href",
            returnByValue: true,
          },
        );
        assertIncludes(
          remappedEvaluation.result.value,
          "/tests/forms?platform=cdp-session-remapped",
          "Playwright CDPSession follows a later native target replacement",
        );
      } finally {
        await remappedSession.detach();
      }
    `;
  },
};
