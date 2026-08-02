export const ownershipLifecycleCase = {
  name: "TaskSpace ownership lifecycle",
  kind: "platform",
  body() {
    return `
      const scratch = await egoBrowser.newTaskSpace(taskName + " ownership lifecycle");
      let closed = false;

      async function waitForOwnership(expected) {
        const deadline = Date.now() + 5_000;
        while (true) {
          const spaces = await egoBrowser.listTaskSpaces();
          const current = spaces.find((space) => space.id === scratch.id);
          if (current?.ownership === expected) return current;
          if (Date.now() >= deadline) {
            throw new Error(
              "TaskSpace ownership did not become " + expected +
                "; current=" + JSON.stringify(current?.ownership),
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      try {
        await scratch.page.goto(baseUrl + "/tests/forms?ownership=lifecycle", {
          waitUntil: "load",
          timeout: 20_000,
        });
        await scratch.page.evaluate(() => {
          window.name = "ownership-preserved";
        });

        const completed = await egoBrowser.completeTaskSpace(scratch.id);
        assertEqual(
          completed.done,
          true,
          "completeTaskSpace preserves the TaskSpace for the user",
        );
        const userOwned = await waitForOwnership("user");
        assertEqual(
          userOwned.ownership, "user",
          "a completed TaskSpace becomes user-owned",
        );

        const claimed = await egoBrowser.claimTaskSpace(scratch.id);
        assertEqual(
          claimed.id,
          scratch.id,
          "claimTaskSpace returns the preserved TaskSpace",
        );
        const agentOwned = await waitForOwnership("agent");
        assertEqual(
          agentOwned.ownership, "agent",
          "claimTaskSpace restores agent ownership",
        );
        assertIncludes(
          claimed.page.url(),
          "/tests/forms?ownership=lifecycle",
          "claimTaskSpace preserves the completed page URL",
        );
        assertEqual(
          await claimed.page.evaluate(() => window.name),
          "ownership-preserved",
          "claimTaskSpace preserves renderer state",
        );

        const result = await egoBrowser.closeTaskSpace(scratch.id);
        assertEqual(result.done, true, "the claimed TaskSpace closes cleanly");
        closed = true;
        const remaining = await egoBrowser.listTaskSpaces();
        assert(
          !remaining.some((space) => space.id === scratch.id),
          "the ownership lifecycle leaves no TaskSpace behind",
        );
      } finally {
        if (!closed) {
          await egoBrowser.closeTaskSpace(scratch.id).catch(() => {});
        }
      }
    `;
  },
};
