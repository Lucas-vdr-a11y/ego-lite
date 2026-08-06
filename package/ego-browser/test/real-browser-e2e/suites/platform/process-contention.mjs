export const taskSpaceProcessContentionCase = {
  name: "TaskSpace process contention",
  kind: "platform",
  processContention: true,
  holderTimeoutMs: 10_000,
  rounds: [
    () => `
      const readyPath = join(tempDir, "process-contention-ready.json");
      const ownerUrl = baseUrl + "/tests/forms?process-contention=owner";
      const task = await egoBrowser.newTaskSpace(
        taskName + " process contention",
      );
      try {
        await task.page.goto(ownerUrl, {
          waitUntil: "load",
          timeout: 20_000,
        });
        assertEqual(
          task.page.url(),
          ownerUrl,
          "the setup round establishes the TaskSpace page",
        );
        await writeFile(
          readyPath,
          JSON.stringify({ id: task.id, name: task.name, ownerUrl }),
        );
      } catch (error) {
        await egoBrowser.closeTaskSpace(task.id).catch(() => {});
        throw error;
      }
    `,
    () => `
      const { readFile } = await import("node:fs/promises");
      const saved = JSON.parse(
        await readFile(
          join(tempDir, "process-contention-ready.json"),
          "utf8",
        ),
      );
      const holder = await egoBrowser.switchTaskSpace(saved.id);
      assertEqual(
        holder.page.url(),
        saved.ownerUrl,
        "the holder takes control of the existing TaskSpace",
      );
      await writeFile(
        join(tempDir, "process-contention-holder-ready.json"),
        JSON.stringify({ id: holder.id }),
      );
      // The orphaned-holder shape behind real lease deadlocks: an await that
      // never resolves while pending work keeps the event loop alive. The
      // interval stands in for that pending native work — without it Node
      // treats the unsettled top-level await as a clean exit (code 13) and
      // the lease is released before any contender arrives.
      setInterval(() => {}, 1_000);
      await new Promise(() => {});
    `,
    () => `
      const { readFile } = await import("node:fs/promises");
      const saved = JSON.parse(
        await readFile(
          join(tempDir, "process-contention-ready.json"),
          "utf8",
        ),
      );
      const startedAt = Date.now();
      const contender = await egoBrowser.switchTaskSpace(saved.id);
      assertEqual(
        Date.now() - startedAt < 5_000,
        true,
        "the takeover completes promptly instead of waiting behind the holder",
      );
      assertEqual(
        contender.page.url(),
        saved.ownerUrl,
        "the contender takes over the holder's TaskSpace with its page intact",
      );
      // Without this the round also passes when the holder died early and
      // released the lease — a free acquire, not a takeover.
      const { readFileSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const owner = JSON.parse(
        readFileSync(
          join(
            tmpdir(),
            "ego-browser-taskspace-leases-" + process.getuid(),
            String(saved.id),
            "owner.json",
          ),
          "utf8",
        ),
      );
      assertEqual(
        typeof owner.takenOverFrom,
        "object",
        "the contender's lease records the takenOverFrom audit",
      );
    `,
    () => `
      const { readFile } = await import("node:fs/promises");
      const saved = JSON.parse(
        await readFile(
          join(tempDir, "process-contention-ready.json"),
          "utf8",
        ),
      );
      const recovered = await egoBrowser.switchTaskSpace(saved.id);
      assertEqual(
        recovered.name,
        saved.name,
        "the TaskSpace remains addressable after the takeover",
      );
      const recoveryUrl = baseUrl + "/tests/clicks?process-contention=recovered";
      await recovered.page.goto(recoveryUrl, {
        waitUntil: "load",
        timeout: 20_000,
      });
      assertEqual(
        recovered.page.url(),
        recoveryUrl,
        "the recovered TaskSpace accepts new page operations",
      );
    `,
  ],
};
