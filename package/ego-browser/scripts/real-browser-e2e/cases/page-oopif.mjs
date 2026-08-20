export function pageOopifActionCase() {
  return `
    const task = await taskSpace(taskName);
    const page = await task.openPage(baseUrl + "/?page-api=oopif", {
      as: "oopif-page",
    });
    const snapshot = await page.snapshot({ scope: "full_page" });
    assertIncludes(snapshot, "Run iframe action", "snapshot includes cross-site iframe content");
    assertIncludes(snapshot, "Iframe field", "snapshot includes the iframe input");
    await page.click('loc=role:button[name="Run iframe action"]');
    await page.fill('loc=css:#iframe-field', "filled through Page");

    const frame = (await task.cdp("Target.getTargets")).targetInfos.find(
      (target) =>
        target.type === "iframe" &&
        target.parentId === page.targetId &&
        target.url.includes("/frame.html")
    )?.targetId;
    assert(frame, "the cross-site iframe remains addressable after Page actions");
    assertEqual(
      await js("return document.querySelector('#iframe-result')?.textContent", frame),
      "clicked:true",
      "Page.click dispatches a trusted click in the iframe session"
    );
    assertEqual(
      await js("return document.querySelector('#iframe-field')?.value", frame),
      "filled through Page",
      "Page.fill writes through the iframe session"
    );

    const sameOrigin = await task.openPage(baseUrl + "/same-origin-frame", {
      as: "same-origin-frame",
    });
    assertIncludes(
      await sameOrigin.snapshot({ scope: "full_page" }),
      "Run iframe action",
      "snapshot includes same-process iframe content"
    );
    await sameOrigin.click('loc=role:button[name="Run iframe action"]');
    await sameOrigin.fill('loc=role:textbox[name="Iframe field"]', "same process");
    const sameOriginState = await sameOrigin.evaluate(() => {
      const frame = document.querySelector("#fixture-frame");
      return {
        result: frame?.contentDocument?.querySelector("#iframe-result")?.textContent,
        value: frame?.contentDocument?.querySelector("#iframe-field")?.value,
      };
    });
    assertEqual(sameOriginState.result, "clicked:true", "Page.click works in a same-process iframe");
    assertEqual(sameOriginState.value, "same process", "Page.fill works in a same-process iframe");
    await sameOrigin.close();
  `;
}

export function pageOopifRestoreCase() {
  return `
    const task = await taskSpace(taskName);
    const page = task.page("oopif-page");
    const snapshot = await page.snapshot({ scope: "full_page" });
    assertIncludes(snapshot, "Run iframe action", "a later round observes the iframe");
    await page.click('text="Run iframe action"');

    const frame = (await task.cdp("Target.getTargets")).targetInfos.find(
      (target) =>
        target.type === "iframe" &&
        target.parentId === page.targetId &&
        target.url.includes("/frame.html")
    )?.targetId;
    assert(frame, "the restored Page keeps its cross-site iframe target");
    assertEqual(
      await js("return document.querySelector('#iframe-result')?.textContent", frame),
      "clicked:true",
      "the restored Page routes the iframe action to the child session"
    );
    await page.close();
    await assertRejects(
      () => page.snapshot(),
      "page oopif-page was closed",
      "closing the Page retires its OOPIF-capable handle"
    );
  `;
}
