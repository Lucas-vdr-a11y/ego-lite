export function taskSpaceControlCase() {
  return `
    const task = await egoBrowser.useOrCreateTaskSpace(taskName);
    assertEqual(task.name, taskName, "egoBrowser.useOrCreateTaskSpace selects named task");
    await task.page.goto(baseUrl + "/?task-space=same-space-reuse", {
      waitUntil: "load",
      timeout: 20_000,
    });

    const reusedTask = await egoBrowser.useOrCreateTaskSpace(taskName);
    assertEqual(reusedTask.id, task.id, "egoBrowser.useOrCreateTaskSpace reuses an existing named task");
    assertEqual(task.page.isClosed(), false, "same-space reuse keeps the existing Page open");
    assertEqual(reusedTask.page.url(), task.page.url(), "same-space reuse returns the current Page URL");
    assertEqual(await task.page.title(), "Ego Browser Lab", "the existing Page remains operable after same-space reuse");

    const spaces = await egoBrowser.listTaskSpaces();
    assert(spaces.some((space) => space.name === taskName), "egoBrowser.listTaskSpaces includes e2e task");
    const listed = spaces.find((space) => space.name === taskName);
    assertEqual(typeof listed.id, "number", "egoBrowser.listTaskSpaces returns numeric ids");
    assertEqual(listed.taskId !== undefined, true, "egoBrowser.listTaskSpaces returns taskId");
    assertEqual(typeof listed.ownership, "string", "egoBrowser.listTaskSpaces returns ownership");

    const switched = await egoBrowser.switchTaskSpace(task.id);
    assertEqual(switched.id, task.id, "egoBrowser.switchTaskSpace selects by numeric id");
    const switchedByName = await egoBrowser.switchTaskSpace(taskName);
    assertEqual(switchedByName.id, task.id, "egoBrowser.switchTaskSpace selects by name");
    const switchedByNumericString = await egoBrowser.switchTaskSpace(String(task.id));
    assertEqual(switchedByNumericString.id, task.id, "egoBrowser.switchTaskSpace selects by numeric string id");

    await egoBrowser.waitForAgentControlTaskSpace(taskName, { interval: 100, timeout: 3_000 });
    await egoBrowser.takeOverTaskSpace(taskName);
    await egoBrowser.waitForAgentControlTaskSpace(taskName, { interval: 100, timeout: 3_000 });

    if (!keepTaskSpace) {
      const scratch = await egoBrowser.newTaskSpace(taskName + " scratch");
      assertEqual(scratch.name, taskName + " scratch", "egoBrowser.newTaskSpace creates a scratch space");
      assertEqual(typeof scratch.tabs, "undefined", "TaskSpace does not expose legacy tabs");
      assertEqual(typeof scratch.page.goto, "function", "TaskSpace exposes a native Playwright Page");
      assertEqual(typeof scratch.context.newPage, "function", "TaskSpace exposes a native Playwright BrowserContext");
      await scratch.page
        .goto(baseUrl + "/tests/forms?task-space=scratch", {
          waitUntil: "load",
          timeout: 10_000,
        })
        .catch((error) => {
          error.message += "; current URL: " + scratch.page.url();
          throw error;
        });
      assertIncludes(scratch.page.url(), "/tests/forms", "TaskSpace Page navigates with Playwright");

      const scratchByName = await egoBrowser.switchTaskSpace(scratch.name);
      assertEqual(scratchByName.id, scratch.id, "egoBrowser switches by TaskSpace name");
      assertIncludes(scratchByName.page.url(), "/tests/forms", "TaskSpace preserves its Playwright Page");

      const closed = await egoBrowser.closeTaskSpace(scratch.id);
      assertEqual(closed.done, true, "egoBrowser.closeTaskSpace reports successful scratch task destruction");

      await assertRejects(
        () => egoBrowser.closeTaskSpace(scratch.id),
        "task space not found",
        "egoBrowser.closeTaskSpace reports already-closed task space"
      );
    }

    const stableTask = await egoBrowser.switchTaskSpace(taskName);
    const stableUrl = stableTask.page.url();
    await assertRejects(
      () => egoBrowser.switchTaskSpace(taskName + " missing"),
      "task space not found",
      "egoBrowser.switchTaskSpace reports missing task space"
    );
    await assertRejects(
      () => egoBrowser.useOrCreateTaskSpace(99999999),
      "task space not found",
      "egoBrowser.useOrCreateTaskSpace rejects missing numeric id"
    );
    assertEqual(stableTask.page.isClosed(), false, "failed TaskSpace selection preserves the current Page");
    assertEqual(stableTask.page.url(), stableUrl, "failed TaskSpace selection preserves the current URL");
    assertEqual(await stableTask.page.title(), "Ego Browser Lab", "the current Page remains operable after failed selection");
    await assertRejects(
      () => egoBrowser.completeTaskSpace(""),
      "requires a task space name or id",
      "egoBrowser.completeTaskSpace validates empty task id"
    );
    await assertRejects(
      () => egoBrowser.closeTaskSpace(""),
      "requires a task space name or id",
      "egoBrowser.closeTaskSpace validates empty task id"
    );
    await assertRejects(
      () => egoBrowser.waitForAgentControlTaskSpace("", { timeout: 100 }),
      "requires a task space name or id",
      "egoBrowser.waitForAgentControlTaskSpace validates task space id"
    );
    await assertRejects(
      () => egoBrowser.takeOverTaskSpace(taskName + " missing"),
      "task space not found",
      "egoBrowser.takeOverTaskSpace reports missing task space"
    );
    await assertRejects(
      () => egoBrowser.claimTaskSpace(taskName + " missing"),
      "task space not found",
      "egoBrowser.claimTaskSpace reports missing task space"
    );
    await assertRejects(
      () => egoBrowser.handOffTaskSpace(taskName + " missing"),
      "task space not found",
      "egoBrowser.handOffTaskSpace reports missing task space"
    );

    // handOffTaskSpace -> takeOverTaskSpace cycle: verify ownership transitions.
    const handOffResult = await egoBrowser.handOffTaskSpace();
    assertEqual(handOffResult.done, true, "egoBrowser.handOffTaskSpace reports successful handoff");
    const afterHandoff = await egoBrowser.listTaskSpaces();
    const handedOff = afterHandoff.find((s) => s.name === taskName);
    assertEqual(handedOff.ownership, "agentDelegatedToUser", "egoBrowser.handOffTaskSpace records delegated ownership");

    let waitFinished = false;
    const delayedTakeover = new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          assertEqual(waitFinished, false, "waitForAgentControl remains pending while control is delegated");
          egoBrowser.takeOverTaskSpace().then(resolve, reject);
        } catch (error) {
          reject(error);
        }
      }, 150);
    });
    const waitResult = await egoBrowser.waitForAgentControlTaskSpace(taskName, { interval: 25, timeout: 5_000 });
    waitFinished = true;
    const takeOverResult = await delayedTakeover;
    assertEqual(takeOverResult.done, true, "egoBrowser.takeOverTaskSpace reports restored control");
    const afterTakeover = await egoBrowser.listTaskSpaces();
    const taken = afterTakeover.find((s) => s.name === taskName);
    assertEqual(taken.ownership, "agent", "egoBrowser.takeOverTaskSpace restores agent ownership");
    assertEqual(waitResult.done, true, "egoBrowser.waitForAgentControlTaskSpace reports agent control");

    // Repeat with explicit name parameter
    await egoBrowser.handOffTaskSpace(taskName);
    const afterHandoff2 = await egoBrowser.listTaskSpaces();
    assertEqual(afterHandoff2.find((s) => s.name === taskName).ownership, "agentDelegatedToUser", "egoBrowser.handOffTaskSpace(name) records delegated ownership");

    await egoBrowser.takeOverTaskSpace(taskName);
    const afterTakeover2 = await egoBrowser.listTaskSpaces();
    assertEqual(afterTakeover2.find((s) => s.name === taskName).ownership, "agent", "egoBrowser.takeOverTaskSpace(name) restores agent ownership");

    await egoBrowser.waitForAgentControlTaskSpace(taskName, { interval: 100, timeout: 5_000 });
  `;
}
