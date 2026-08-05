export const taskSpaceProcessContentionCase = {
  name: "TaskSpace process contention",
  kind: "platform",
  optIn: true,
  processContention: true,
  holderTimeoutMs: 8_000,
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
      await new Promise((resolve) => setTimeout(resolve, 10_000));
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
      let contentionError;
      try {
        await egoBrowser.switchTaskSpace(saved.id);
      } catch (error) {
        contentionError = error;
      }
      assertIncludes(
        String(contentionError?.message || contentionError),
        "already controlled by another ego-browser process",
        "a concurrent heredoc is rejected before selecting the live holder's TaskSpace",
      );
      assertEqual(
        Date.now() - startedAt < 3_000,
        true,
        "TaskSpace contention fails promptly instead of waiting behind an abandoned command",
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
      const deadline = Date.now() + 15_000;
      let recovered;
      while (!recovered) {
        try {
          recovered = await egoBrowser.switchTaskSpace(saved.id);
        } catch (error) {
          if (
            !String(error?.message || error).includes(
              "already controlled by another ego-browser process",
            )
          ) {
            throw error;
          }
          if (Date.now() >= deadline) {
            throw new Error("TaskSpace recovery timed out after holder timeout");
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      assertEqual(
        recovered.page.url(),
        saved.ownerUrl,
        "the timed-out holder preserved the TaskSpace page",
      );
      assertEqual(
        recovered.name,
        saved.name,
        "the TaskSpace remains recoverable after the holder exits",
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
