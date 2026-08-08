export const nativeCallbackContainmentCase = {
  name: "native callback containment",
  kind: "platform",
  optIn: true,
  nativeCallbackContainment: true,
  holderTimeoutMs: 60_000,
  rounds: [
    () => `
      const holder = await egoBrowser.newTaskSpace(
        taskName + " native callback holder",
      );
      const holderUrl = baseUrl + "/tests/forms?native-callback=holder";
      await holder.page.goto(holderUrl, {
        waitUntil: "load",
        timeout: 20_000,
      });
      const holderTitle = await holder.page.title();
      assert(
        holderTitle.includes("Ego Browser Lab"),
        "the holder loaded the test fixture",
      );
      await writeFile(
        join(tempDir, "native-callback-holder-ready.json"),
        JSON.stringify({ pid: process.pid }),
      );

      const deadline = Date.now() + 50_000;
      let ticks = 0;
      let culpritDone = false;
      while (!culpritDone && Date.now() < deadline) {
        assertEqual(
          await holder.page.title(),
          holderTitle,
          "the holder keeps completing browser commands",
        );
        ticks += 1;
        try {
          await readFile(join(tempDir, "native-callback-culprit-done.json"));
          culpritDone = true;
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        if (!culpritDone) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      assert(culpritDone, "the culprit completed without aborting NodeService");
      assertEqual(
        await holder.page.title(),
        holderTitle,
        "the holder completes a browser command after the injected failure",
      );
      await writeFile(
        join(tempDir, "native-callback-holder-summary.json"),
        JSON.stringify({ pid: process.pid, ticks }),
      );
    `,
    () => `
      const culprit = await egoBrowser.newTaskSpace(
        taskName + " native callback culprit",
      );
      await culprit.page.goto(
        baseUrl + "/tests/clicks?native-callback=culprit",
        { waitUntil: "load", timeout: 20_000 },
      );

      await cdp("Target.getTargets", {});
      const injectionBase =
        700_000_000 + Math.floor(Math.random() * 100_000_000);
      const originalMapGet = Map.prototype.get;
      const originalSetIterator = Set.prototype[Symbol.iterator];
      const originalConsoleError = console.error;
      const guardEvents = [];
      console.error = (...args) => {
        guardEvents.push({
          label: String(args[0]),
          text: args
            .map((arg) => String(arg instanceof Error ? arg.message : arg))
            .join(" "),
        });
        originalConsoleError(...args);
      };

      async function waitForGuard(label, marker) {
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          if (
            guardEvents.some(
              (event) =>
                event.label === label + " failed:" &&
                event.text.includes(marker),
            )
          ) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return false;
      }

      try {
        const innerId = injectionBase;
        const innerMarker = "inner native callback probe " + innerId;
        Map.prototype.get = function (key) {
          if (key === innerId) throw new Error(innerMarker);
          return originalMapGet.call(this, key);
        };
        globalThis.ego.sendCDPMessage(
          JSON.stringify({
            id: innerId,
            method: "Target.getTargets",
            params: {},
          }),
        );
        assert(
          await waitForGuard("CDP message handling", innerMarker),
          "handleMessage failures reach the inner native callback guard",
        );
        Map.prototype.get = originalMapGet;

        const outerId = injectionBase + 1;
        const outerMarker = "outer native callback probe " + outerId;
        let throwFromTransportIteration = false;
        Map.prototype.get = function (key) {
          if (key === outerId) throwFromTransportIteration = true;
          return originalMapGet.call(this, key);
        };
        Set.prototype[Symbol.iterator] = function () {
          if (throwFromTransportIteration) {
            throwFromTransportIteration = false;
            throw new Error(outerMarker);
          }
          return originalSetIterator.call(this);
        };
        globalThis.ego.sendCDPMessage(
          JSON.stringify({
            id: outerId,
            method: "Target.getTargets",
            params: {},
          }),
        );
        assert(
          await waitForGuard("onCDPMessage", outerMarker),
          "dispatch failures reach the outer native callback guard",
        );
      } finally {
        Map.prototype.get = originalMapGet;
        Set.prototype[Symbol.iterator] = originalSetIterator;
        console.error = originalConsoleError;
      }

      const targets = await cdp("Target.getTargets", {});
      assert(
        Array.isArray(targets.targetInfos),
        "CDP remains usable after the guarded callback failure",
      );
      await writeFile(
        join(tempDir, "native-callback-culprit-summary.json"),
        JSON.stringify({
          pid: process.pid,
          targetCount: targets.targetInfos.length,
          guards: guardEvents.map((event) => event.label),
        }),
      );
      await writeFile(
        join(tempDir, "native-callback-culprit-done.json"),
        JSON.stringify({ done: true }),
      );
    `,
  ],
};
