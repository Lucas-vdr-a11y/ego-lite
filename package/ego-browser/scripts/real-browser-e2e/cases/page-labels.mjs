export function pageLabelCreateCase() {
  return `
    const task = await taskSpace(taskName);
    await openOrReuseTab(baseUrl + "/?inventory=unknown", { wait: true, timeout: 10 });
    const page = await task.newPage(baseUrl + "/secondary?managed=p1");
    assertEqual(page.label, "p1", "first managed page receives p1");
    assertEqual(page.spaceId, task.id, "page carries its task-space id");
    assertEqual(typeof page.targetId, "string", "new page exposes its target id");
    assertIncludes(await page.snapshot(), "Secondary tab", "p1 snapshot addresses the created page");
    const inventory = await task.listPages();
    const managed = inventory.find((item) => item.label === page.label);
    assertEqual(managed.page.targetId, page.targetId, "listPages returns the managed Page handle");
    assertEqual(managed.openedBy, "agent", "listPages identifies managed page origin");
    assert(
      inventory.some((item) => item.label === undefined && item.openedBy === "unknown"),
      "listPages preserves untracked browser tabs as unknown"
    );
    await writeFile(
      join(tempDir, "managed-page.json"),
      JSON.stringify({ label: page.label, targetId: page.targetId })
    );
  `;
}

export function pageLabelRestoreCase() {
  return `
    const saved = JSON.parse(await readFile(join(tempDir, "managed-page.json"), "utf8"));
    const task = await taskSpace(taskName);
    const page = task.page(saved.label);
    const before = await listTabs();
    await page.goto(baseUrl + "/nav-target?managed=restored");
    const after = await listTabs();

    assertEqual(page.targetId, saved.targetId, "a new process restores the same target");
    assertEqual(after.length, before.length, "goto reuses the page instead of opening another tab");
    assertIncludes(await page.snapshot(), "Navigation target", "restored page can navigate and snapshot");
  `;
}

export function pageLabelCloseCase() {
  return `
    const saved = JSON.parse(await readFile(join(tempDir, "managed-page.json"), "utf8"));
    const task = await taskSpace(taskName);
    await task.page(saved.label).close();
    const afterClose = await listTabs();
    assert(
      !afterClose.some((tab) => tab.targetId === saved.targetId),
      "close removes the managed browser target"
    );
    await assertRejects(
      () => task.page(saved.label).goto(baseUrl + "/closed"),
      "page p1 was closed",
      "a closed label fails closed"
    );

    const next = await task.newPage(baseUrl + "/secondary?managed=p2");
    assertEqual(next.label, "p2", "closed labels are never reused");
    await closeTab(next.targetId);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!(await listTabs()).some((tab) => tab.targetId === next.targetId)) break;
      await wait(0.05);
    }
    const reconciled = await task.listPages();
    assert(
      !reconciled.some((item) => item.label === "p2"),
      "listPages removes a managed page closed outside the object API"
    );
    await assertRejects(
      () => task.page("p2").snapshot(),
      "page p2 was closed",
      "reconciliation permanently retires an externally closed label"
    );
    const afterExternalClose = await task.newPage(baseUrl + "/secondary?managed=p3");
    assertEqual(afterExternalClose.label, "p3", "reconciliation frees budget without reusing labels");
    await afterExternalClose.close();
  `;
}

export function pageLabelHardStopCase() {
  return `
    const task = await taskSpace(taskName);
    const page = await task.newPage(baseUrl + "/secondary?managed=hard-stop");
    await writeFile(
      join(tempDir, "hard-stop-page.json"),
      JSON.stringify({ label: page.label, targetId: page.targetId })
    );
    process.kill(process.pid, "SIGKILL");
  `;
}

export function pageLabelHardStopRestoreCase() {
  return `
    const saved = JSON.parse(await readFile(join(tempDir, "hard-stop-page.json"), "utf8"));
    const task = await taskSpace(taskName);
    const page = task.page(saved.label);
    await page.goto(baseUrl + "/nav-target?managed=after-hard-stop");
    assertEqual(page.targetId, saved.targetId, "hard-stopped round persisted the same target");
    assertIncludes(await page.snapshot(), "Navigation target", "page remains usable after a hard stop");
    await page.close();
  `;
}

export function pageBudgetCase() {
  return `
    assertEqual(process.env.EGO_BROWSER_PAGE_BUDGET, "3", "budget configuration reaches the SDK process");
    const task = await taskSpace(taskName);
    const managed = [];
    for (let index = 0; index < 3; index += 1) {
      managed.push(await task.newPage(baseUrl + "/secondary?budget=" + index));
      const inventory = await task.listPages();
      assertEqual(
        inventory.filter((item) => item.label !== undefined).length,
        index + 1,
        "each newPage is visible to managed-page inventory"
      );
    }
    const beforeReject = await listTabs();
    await assertRejects(
      () => task.newPage(baseUrl + "/secondary?budget=blocked"),
      "Page budget reached (3/3)",
      "newPage applies managed-page backpressure"
    );
    const afterReject = await listTabs();
    assertEqual(afterReject.length, beforeReject.length, "budget rejects before creating a browser tab");
    const inventory = await task.listPages();
    assertEqual(
      inventory.filter((item) => item.label !== undefined).length,
      3,
      "listPages reports every managed page at the budget limit"
    );
    for (const page of managed) await page.close();
  `;
}
