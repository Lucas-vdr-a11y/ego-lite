export function taskSpaceCase() {
  return `
    const task = await taskSpaces.useOrCreate(taskName);
    assertEqual(task.name, taskName, "taskSpaces.useOrCreate selects named task");

    const reusedTask = await taskSpaces.useOrCreate(taskName);
    assertEqual(reusedTask.id, task.id, "taskSpaces.useOrCreate reuses an existing named task");

    const spaces = await taskSpaces.list();
    assert(spaces.some((space) => space.name === taskName), "taskSpaces.list includes e2e task");
    const listed = spaces.find((space) => space.name === taskName);
    assertEqual(typeof listed.id, "number", "taskSpaces.list returns numeric ids");
    assertEqual(listed.taskId !== undefined, true, "taskSpaces.list returns taskId");
    assertEqual(typeof listed.ownership, "string", "taskSpaces.list returns ownership");

    const switched = await taskSpaces.switch(task.id);
    assertEqual(switched.id, task.id, "taskSpaces.switch selects by numeric id");
    const switchedByName = await taskSpaces.switch(taskName);
    assertEqual(switchedByName.id, task.id, "taskSpaces.switch selects by name");
    const switchedByNumericString = await taskSpaces.switch(String(task.id));
    assertEqual(switchedByNumericString.id, task.id, "taskSpaces.switch selects by numeric string id");

    await taskSpaces.waitForAgentControl(taskName, { interval: 100, timeout: 3_000 });
    await taskSpaces.takeOver(taskName);
    await taskSpaces.waitForAgentControl(taskName, { interval: 100, timeout: 3_000 });

    if (!keepTaskSpace) {
      const scratch = await egoBrowser.newTaskSpace(taskName + " scratch");
      assertEqual(scratch.name, taskName + " scratch", "egoBrowser.newTaskSpace creates a scratch space");
      assertEqual(typeof scratch.tabs.open, "function", "TaskSpace exposes bound tabs");
      const scratchByName = await egoBrowser.switchTaskSpace(scratch.name);
      assertEqual(scratchByName.id, scratch.id, "egoBrowser switches by TaskSpace name");
      const scratchTab = await scratch.tabs.open(baseUrl + "/secondary?task-space=scratch", {
        wait: true,
        timeout: 10_000,
      });
      assertEqual(scratchTab.page.targetId, scratchTab.targetId, "TaskSpace tabs expose target-bound Pages");

      await egoBrowser.switchTaskSpace(task.id);
      assertIncludes(await scratchTab.page.url(), "/secondary", "a bound Tab Page reselects its TaskSpace");
      await egoBrowser.switchTaskSpace(task.id);
      assertIncludes(
        await scratchTab.page.snapshot(),
        "Secondary tab",
        "a bound Tab Page snapshots its own target"
      );
      await egoBrowser.switchTaskSpace(task.id);
      await assertRejects(
        () => tabs.activate(scratchTab),
        "tabs.activate target not found",
        "tabs.activate rejects a target from another task space"
      );
      await assertRejects(
        () => tabs.close(scratchTab),
        "tabs.close target not found",
        "tabs.close rejects a target from another task space"
      );
      await assertRejects(
        () => tabs.evaluate(scratchTab, "document.title"),
        "tabs.evaluate target not found",
        "tabs.evaluate rejects a target from another task space"
      );

      const closed = await egoBrowser.closeTaskSpace(scratch.id);
      assertEqual(closed, undefined, "egoBrowser.closeTaskSpace resolves void after destroying scratch task");

      await assertRejects(
        () => egoBrowser.closeTaskSpace(scratch.id),
        "task space not found",
        "egoBrowser.closeTaskSpace reports already-closed task space"
      );
    }

    await taskSpaces.switch(taskName);
    await assertRejects(
      () => taskSpaces.switch(taskName + " missing"),
      "task space not found",
      "taskSpaces.switch reports missing task space"
    );
    await assertRejects(
      () => taskSpaces.useOrCreate(99999999),
      "task space not found",
      "taskSpaces.useOrCreate rejects missing numeric id"
    );
    await assertRejects(
      () => taskSpaces.complete(taskName, {}),
      "requires { keep: boolean }",
      "taskSpaces.complete validates keep option"
    );
    await assertRejects(
      () => taskSpaces.complete("", { keep: false }),
      "requires a task space name or id",
      "taskSpaces.complete validates empty task id"
    );
    await assertRejects(
      () => taskSpaces.waitForAgentControl("", { timeout: 100 }),
      "requires a task space name or id",
      "taskSpaces.waitForAgentControl validates task space id"
    );
    await assertRejects(
      () => taskSpaces.takeOver(taskName + " missing"),
      "task space not found",
      "taskSpaces.takeOver reports missing task space"
    );
    await assertRejects(
      () => taskSpaces.claim(taskName + " missing"),
      "task space not found",
      "taskSpaces.claim reports missing task space"
    );
    await assertRejects(
      () => taskSpaces.handOff(taskName + " missing"),
      "task space not found",
      "taskSpaces.handOff reports missing task space"
    );

    // taskSpaces.handOff -> taskSpaces.takeOver cycle: verify ownership transitions via taskSpaces.list
    await taskSpaces.handOff();
    const afterHandoff = await taskSpaces.list();
    const handedOff = afterHandoff.find((s) => s.name === taskName);
    assert(handedOff.ownership !== "agent", "taskSpaces.handOff transfers ownership away from agent");

    await taskSpaces.takeOver();
    const afterTakeover = await taskSpaces.list();
    const taken = afterTakeover.find((s) => s.name === taskName);
    assertEqual(taken.ownership, "agent", "taskSpaces.takeOver restores agent ownership");

    await taskSpaces.waitForAgentControl(taskName, { interval: 100, timeout: 5_000 });

    // Repeat with explicit name parameter
    await taskSpaces.handOff(taskName);
    const afterHandoff2 = await taskSpaces.list();
    assert(afterHandoff2.find((s) => s.name === taskName).ownership !== "agent", "taskSpaces.handOff(name) transfers ownership away from agent");

    await taskSpaces.takeOver(taskName);
    const afterTakeover2 = await taskSpaces.list();
    assertEqual(afterTakeover2.find((s) => s.name === taskName).ownership, "agent", "taskSpaces.takeOver(name) restores agent ownership");

    await taskSpaces.waitForAgentControl(taskName, { interval: 100, timeout: 5_000 });
  `;
}
