export function pageLabelCreateCase() {
  return `
    const task = await taskSpace(taskName);
    const page = await task.newPage(baseUrl + "/secondary?managed=p1");
    assertEqual(page.label, "p1", "first managed page receives p1");
    assertEqual(page.spaceId, task.id, "page carries its task-space id");
    assertEqual(typeof page.targetId, "string", "new page exposes its target id");
    assertIncludes(await page.snapshot(), "Secondary tab", "p1 snapshot addresses the created page");
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
    await next.close();
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
