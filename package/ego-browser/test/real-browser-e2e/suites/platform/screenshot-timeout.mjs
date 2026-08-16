export const screenshotTimeoutCase = {
  name: "Playwright screenshot timeout containment",
  kind: "platform",
  timeoutMs: 20_000,
  body() {
    return `
      const screenshotTimeoutMs = 1_000;
      const watchdogMs = 2_500;

      async function raceDeadline(promise, timeoutMs, timeoutValue) {
        let timer;
        try {
          return await Promise.race([
            promise,
            new Promise((resolve) => {
              timer = setTimeout(() => resolve(timeoutValue), timeoutMs);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }

      const scratch = await egoBrowser.newTaskSpace(
        taskName + " screenshot timeout containment",
      );
      const primary = scratch.page;
      let child;
      let screenshotOutcome;
      let screenshotAfterClose;
      let childCloseOutcome;
      let primaryHealth;
      let taskCloseResult;

      try {
        await primary.evaluate(() => {
          document.title = "screenshot containment primary";
        });

        child = await scratch.context.newPage();
        await child.goto(
          baseUrl + "/tests/text-content?screenshot-timeout=platform",
          { waitUntil: "commit", timeout: 5_000 },
        );
        await child
          .locator('html[data-progress-sync="idle"]')
          .waitFor({ timeout: 4_000 });
        await child
          .locator(".text-content-handoff")
          .waitFor({ state: "visible", timeout: 4_000 });

        const screenshotAttempt = child
          .screenshot({
            animations: "disabled",
            scale: "css",
            timeout: screenshotTimeoutMs,
          })
          .then(
            (image) => ({ kind: "resolved", bytes: image.length }),
            (error) => ({ kind: "rejected", message: error.message }),
          );

        screenshotOutcome = await raceDeadline(
          screenshotAttempt,
          watchdogMs,
          { kind: "watchdog" },
        );

        childCloseOutcome = await raceDeadline(
          child.close({ runBeforeUnload: false }).then(
            () => ({ kind: "closed" }),
            (error) => ({
              kind: "close-rejected",
              message: error.message,
            }),
          ),
          2_000,
          { kind: "close-watchdog" },
        );

        screenshotAfterClose =
          screenshotOutcome.kind === "watchdog"
            ? await raceDeadline(
                screenshotAttempt,
                2_000,
                { kind: "still-pending" },
              )
            : screenshotOutcome;

        primaryHealth = await raceDeadline(
          primary.title().then(
            (title) => ({ kind: "healthy", title }),
            (error) => ({
              kind: "health-rejected",
              message: error.message,
            }),
          ),
          2_000,
          { kind: "health-watchdog" },
        );
      } finally {
        taskCloseResult = await egoBrowser
          .closeTaskSpace(scratch.id)
          .catch((error) => ({ done: false, error: error.message }));
      }

      assertEqual(
        childCloseOutcome?.kind,
        "closed",
        "the disposable screenshot Page closes promptly",
      );
      assert(
        screenshotAfterClose?.kind !== "still-pending",
        "closing the disposable Page settles the screenshot RPC",
      );
      assertEqual(
        primaryHealth?.kind,
        "healthy",
        "screenshot cancellation leaves the primary Page usable",
      );
      assertEqual(
        taskCloseResult?.done,
        true,
        "the screenshot scratch TaskSpace closes cleanly",
      );

      assert(
        screenshotOutcome?.kind !== "watchdog",
        "screenshot resolves or rejects within its declared timeout instead of leaving an RPC pending",
      );

      if (screenshotOutcome.kind === "resolved") {
        assert(
          screenshotOutcome.bytes > 0,
          "a completed screenshot contains image bytes",
        );
      } else {
        assertIncludes(
          screenshotOutcome.message,
          "Timeout " + screenshotTimeoutMs + "ms exceeded",
          "a failed screenshot reports its own timeout",
        );
      }
    `;
  },
};
