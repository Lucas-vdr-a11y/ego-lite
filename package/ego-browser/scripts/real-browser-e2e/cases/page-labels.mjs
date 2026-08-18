export function pageLabelCreateCase() {
  return `
    const task = await taskSpace(taskName);
    await openOrReuseTab(baseUrl + "/?inventory=unknown", { wait: true, timeout: 10 });
    const page = await task.newPage(baseUrl + "/?managed=p1");
    assertEqual(page.label, "p1", "first managed page receives p1");
    assertEqual(page.spaceId, task.id, "page carries its task-space id");
    assertEqual(typeof page.targetId, "string", "new page exposes its target id");
    const snapshot = await page.snapshot();
    assertIncludes(snapshot, "Helper e2e fixture", "p1 snapshot addresses the created page");
    const refLine = snapshot.split("\\n").find((line) => line.includes("Increment counter"));
    const refMatch = refLine && refLine.match(/\\[ref=([0-9]+)/);
    assert(refMatch, "snapshot exposes a ref for the cross-round action");
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
      JSON.stringify({ label: page.label, targetId: page.targetId, ref: "@" + refMatch[1] })
    );
  `;
}

export function pageLabelRestoreCase() {
  return `
    const saved = JSON.parse(await readFile(join(tempDir, "managed-page.json"), "utf8"));
    const task = await taskSpace(taskName);
    const page = task.page(saved.label);
    await page.click(saved.ref);
    assertEqual(
      await page.evaluate("window.__fixtureState.clicks"),
      1,
      "a ref printed in the previous process resolves in the restored Page"
    );
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

export function pageAdoptionCase() {
  return `
    const task = await taskSpace(taskName);
    const source = await openOrReuseTab(baseUrl + "/?adopt=source", {
      wait: true,
      timeout: 10,
    });
    const beforeAdopt = await task.listPages();
    const untracked = beforeAdopt.find(
      (item) => item.targetId === source.targetId && item.label === undefined
    );
    assert(Boolean(untracked), "listPages reports the source tab as untracked");
    assertEqual(untracked.page.targetId, source.targetId, "untracked handle keeps the target id");
    assertEqual(untracked.page.snapshot, undefined, "untracked handle cannot snapshot directly");
    assertEqual(untracked.page.goto, undefined, "untracked handle cannot navigate directly");
    assertEqual(untracked.page.close, undefined, "untracked handle cannot close directly");

    const adopted = await task.adopt(untracked.page, { as: "borrowed" });
    assertEqual(adopted.label, "borrowed", "adopt assigns the requested durable label");
    assertEqual(adopted.openedBy, "unknown", "adopt preserves conservative origin attribution");
    assertIncludes(await adopted.snapshot(), "Helper e2e fixture", "adopted page supports Page operations");

    const released = await task.release(adopted.label);
    assertEqual(released.targetId, source.targetId, "release returns the same untracked target");
    assert(
      (await listTabs()).some((tab) => tab.targetId === source.targetId),
      "release leaves the browser tab open"
    );
    assertEqual(
      (await task.listPages()).find((item) => item.targetId === source.targetId).label,
      undefined,
      "release removes the durable label"
    );
    await assertRejects(
      () => adopted.snapshot(),
      "page borrowed was released",
      "the released label fails closed"
    );

    const adoptedAgain = await task.adopt(released, { as: "borrowed-again" });
    assertEqual(adoptedAgain.targetId, source.targetId, "a released tab can be adopted again");
    await task.release(adoptedAgain.label);

    const agentPage = await task.newPage(baseUrl + "/secondary?release=agent", {
      as: "agent-owned",
    });
    await assertRejects(
      () => task.release(agentPage.label),
      "was created by the agent; close it instead",
      "agent-created pages cannot become untracked orphans"
    );
    await agentPage.close();
  `;
}

export function pageBasicOperationsCase() {
  return `
    const task = await taskSpace(taskName);
    const first = await task.newPage(baseUrl + "/?page-api=first", {
      as: "page-api-first",
    });
    const second = await task.newPage(baseUrl + "/secondary?page-api=second", {
      as: "page-api-second",
    });
    assertEqual((await currentTab()).targetId, second.targetId, "second page starts active");

    assertIncludes(await first.url(), "page-api=first", "page.url reads its own target");
    assertEqual(await first.title(), "ego-lite helper e2e", "page.title reads its own target");
    const info = await first.info();
    assertIncludes(info.url, "page-api=first", "page.info reads its own URL");
    assert(info.w > 0 && info.h > 0, "page.info reports a usable viewport");
    assertEqual((await currentTab()).targetId, second.targetId, "metadata reads do not activate their page");
    assertEqual(
      await first.evaluate("document.querySelector('h1').textContent"),
      "Helper e2e fixture",
      "string evaluate runs on the addressed page"
    );
    assertEqual((await currentTab()).targetId, first.targetId, "page.evaluate activates its page");
    const evaluated = await first.evaluate(
      async ({ selector, suffix }) => ({
        text: document.querySelector(selector)?.textContent?.trim(),
        suffix,
        title: document.title,
      }),
      { selector: "h1", suffix: "ok" }
    );
    assertEqual(evaluated.text, "Helper e2e fixture", "function evaluate receives one JSON argument");
    assertEqual(evaluated.suffix, "ok", "function evaluate preserves argument values");
    assertEqual(evaluated.title, "ego-lite helper e2e", "function evaluate stays target-scoped");
    await assertRejects(
      () => first.evaluate(() => { throw new Error("page evaluate boom"); }),
      "page evaluate boom",
      "function evaluate surfaces page exceptions"
    );

    const screenshotPath = join(tempDir, "page-api-first.png");
    assertEqual(
      await first.screenshot(screenshotPath, { full: false }),
      screenshotPath,
      "page.screenshot returns its explicit path"
    );
    assert((await stat(screenshotPath)).size > 0, "page.screenshot writes a non-empty PNG");
    assertEqual(
      (await currentTab()).targetId,
      first.targetId,
      "page.screenshot activates the page it captures"
    );

    await first.close();
    await second.close();
  `;
}

export function pageActionsAndPopupCase() {
  return `
    const task = await taskSpace(taskName);
    await openOrReuseTab(baseUrl + "/?page-actions=unknown", {
      wait: true,
      timeout: 10,
    });
    const unknownBefore = (await task.listPages())
      .filter((item) => item.label === undefined)
      .map((item) => item.targetId);
    const source = await task.newPage(baseUrl + "/?page-actions=source", {
      as: "page-actions-source",
    });
    const comparison = await task.newPage(baseUrl + "/secondary?page-actions=comparison", {
      as: "page-actions-comparison",
    });
    const budgetFiller = await task.newPage(baseUrl + "/secondary?page-actions=budget", {
      as: "page-actions-budget",
    });

    assertEqual((await currentTab()).targetId, budgetFiller.targetId, "the budget page starts active");
    assertEqual(await source.fill("#text-input", "page-filled").then(() => source.evaluate("document.querySelector('#text-input').value")), "page-filled", "page.fill writes into the addressed page");
    assertEqual((await currentTab()).targetId, source.targetId, "page.fill activates and keeps its page current");

    await source.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "2200px";
      const button = document.createElement("button");
      button.id = "page-offscreen-button";
      button.textContent = "Offscreen trusted action";
      button.addEventListener("click", (event) => {
        window.__pageOffscreenClickTrusted = event.isTrusted;
      });
      document.body.append(spacer, button);
    });
    await source.click("#page-offscreen-button");
    const offscreenResult = await source.evaluate(() => ({
      trusted: window.__pageOffscreenClickTrusted,
      scrollY,
    }));
    assertEqual(offscreenResult.trusted, true, "offscreen Page click remains a trusted browser event");
    assert(offscreenResult.scrollY > 0, "Page click scrolls an offscreen element into view");

    await source.evaluate((popupUrl) => {
      const link = document.createElement("a");
      link.id = "page-popup-link";
      link.href = popupUrl;
      link.target = "_blank";
      link.textContent = "Open managed popup";
      link.style.cssText = "position:fixed;left:16px;top:16px;z-index:2147483647";
      window.__pagePopupClickTrusted = null;
      link.addEventListener("click", (event) => {
        window.__pagePopupClickTrusted = event.isTrusted;
      });
      document.body.append(link);
    }, baseUrl + "/secondary?page-actions=popup");
    const receipt = await source.click("#page-popup-link");

    assertEqual(receipt.popups.length, 1, "page.click reports the popup it opened");
    assertEqual(
      await source.evaluate("window.__pagePopupClickTrusted"),
      true,
      "page.click reaches the site as a trusted browser event"
    );
    const popup = receipt.popups[0];
    assertEqual(typeof popup.label, "string", "the popup receives a durable label");
    assertIncludes(
      await task.page(popup.label).url(),
      "page-actions=popup",
      "the receipt label resolves the popup Page"
    );
    const inventory = await task.listPages();
    assertEqual(
      inventory.find((item) => item.targetId === popup.targetId).openedBy,
      "agent",
      "the popup is recorded as agent-created"
    );
    assert(
      unknownBefore.every(
        (targetId) => inventory.find((item) => item.targetId === targetId)?.label === undefined
      ),
      "tabs that existed before the action remain untracked"
    );
    await assertRejects(
      () => task.newPage(baseUrl + "/secondary?page-actions=blocked"),
      "Page budget reached (4/3)",
      "an adopted popup can exceed the budget and backpressure later newPage calls"
    );

    await task.page(popup.label).close();
    await source.close();
    await comparison.close();
    await budgetFiller.close();
  `;
}

export function pageComplexEvaluateCase() {
  return `
    const task = await taskSpace(taskName);
    const source = await task.newPage(baseUrl + "/?page-evaluate=complex", {
      as: "complex-evaluate-source",
    });
    const comparison = await task.newPage(baseUrl + "/secondary?page-evaluate=comparison", {
      as: "complex-evaluate-comparison",
    });
    assertEqual((await currentTab()).targetId, comparison.targetId, "comparison page starts active");

    const complexInput = {
      marker: "复杂输入 😀 café",
      specialText: [
        'double-"quote"',
        "single-'quote'",
        String.fromCharCode(96) + "template tick" + String.fromCharCode(96),
        "line\\nbreak",
        "slash\\\\path",
        "</script>",
        String.fromCharCode(0x2028) + String.fromCharCode(0x2029),
      ].join("|"),
      config: {
        multiplier: 7,
        enabled: true,
        nullable: null,
        flags: [true, false, null],
        labels: { zh: "中文", en: "English", emoji: "🧪" },
        nested: { one: { two: { three: { value: "deep-value" } } } },
      },
      longText: Array.from({ length: 256 }, (_, index) => "segment-" + index + "-数据").join("|"),
      rows: Array.from({ length: 96 }, (_, index) => ({
        id: index,
        label: "条目 " + index + " / " + (index % 2 ? "beta" : "alpha"),
        tags: Array.from({ length: 8 }, (_, tag) => "tag-" + ((index + tag) % 13)),
        metrics: {
          value: index * 3,
          valid: index % 3 !== 0,
          ratio: index / 7,
        },
      })),
    };
    const expectedChecksum = complexInput.rows.reduce(
      (sum, row) => sum + row.metrics.value * complexInput.config.multiplier + row.tags.length,
      0
    );

    const result = await source.evaluate(async (input) => {
      class RowModel {
        constructor(row, multiplier) {
          this.row = row;
          this.multiplier = multiplier;
        }

        get slug() {
          return String(this.row.label)
            .normalize("NFKC")
            .replace(/[^a-z0-9]+/gi, "-")
            .replace(/^-|-$/g, "")
            .toLowerCase();
        }

        score() {
          return this.row.metrics.value * this.multiplier + this.row.tags.length;
        }
      }

      const models = input.rows.map((row) => new RowModel(row, input.config.multiplier));
      const root = document.createElement("section");
      root.id = "complex-evaluate-root";
      root.dataset.config = JSON.stringify(input.config);
      root.dataset.marker = input.marker;
      const fragment = document.createDocumentFragment();
      for (const model of models) {
        const article = document.createElement("article");
        article.dataset.rowId = String(model.row.id);
        article.dataset.slug = model.slug;
        article.dataset.valid = String(model.row.metrics.valid);
        article.textContent = model.row.label + " | " + model.row.tags.join(",");
        fragment.append(article);
      }
      root.append(fragment);

      const receivedEvents = [];
      root.addEventListener("ego-complex-evaluate", (event) => {
        receivedEvents.push(structuredClone(event.detail));
      });
      document.body.append(root);

      const checksum = models.reduce((sum, model) => sum + model.score(), 0);
      root.dispatchEvent(new CustomEvent("ego-complex-evaluate", {
        bubbles: true,
        detail: {
          marker: input.marker,
          checksum,
          lastRow: models.at(-1).row.id,
        },
      }));

      await new Promise((resolve) => {
        requestAnimationFrame(() => queueMicrotask(resolve));
      });

      return {
        marker: input.marker,
        specialText: input.specialText,
        longTextLength: input.longText.length,
        rowCount: models.length,
        checksum,
        first: {
          id: models[0].row.id,
          slug: models[0].slug,
          score: models[0].score(),
          tags: models[0].row.tags.slice(0, 3),
        },
        last: {
          id: models.at(-1).row.id,
          score: models.at(-1).score(),
          ratio: models.at(-1).row.metrics.ratio,
        },
        configClone: structuredClone(input.config),
        event: receivedEvents[0],
        projection: models.slice(0, 12).map((model) => ({
          id: model.row.id,
          slug: model.slug,
          valid: model.row.metrics.valid,
          score: model.score(),
        })),
        documentState: {
          visibility: document.visibilityState,
          hasFocus: document.hasFocus(),
          articleCount: root.querySelectorAll("article").length,
          htmlLength: root.outerHTML.length,
        },
      };
    }, complexInput);

    assertEqual((await currentTab()).targetId, source.targetId, "complex evaluate activates its page");
    assertEqual(result.marker, complexInput.marker, "Unicode argument round-trips through evaluate");
    assertEqual(result.specialText, complexInput.specialText, "quotes, slashes, and line separators round-trip");
    assertEqual(result.longTextLength, complexInput.longText.length, "large string input reaches the page intact");
    assertEqual(result.rowCount, complexInput.rows.length, "large nested array reaches the page intact");
    assertEqual(result.checksum, expectedChecksum, "class methods and array reductions execute correctly");
    assertEqual(result.first.id, 0, "complex return includes the first nested record");
    assertEqual(result.last.id, 95, "complex return includes the last nested record");
    assertEqual(result.projection.length, 12, "complex return preserves nested array objects");
    assertEqual(result.configClone.nested.one.two.three.value, "deep-value", "deep input survives structuredClone");
    assertEqual(result.configClone.flags[2], null, "null values survive nested serialization");
    assertEqual(result.event.marker, complexInput.marker, "custom event receives the complex marker");
    assertEqual(result.event.checksum, expectedChecksum, "custom event receives computed data");
    assertEqual(result.documentState.visibility, "visible", "evaluate runs in the active document");
    assertEqual(result.documentState.hasFocus, true, "evaluate runs in the focused document");
    assertEqual(result.documentState.articleCount, 96, "complex script writes every DOM record");
    assert(result.documentState.htmlLength > 10000, "complex script produces a substantial DOM result");

    const domResult = await source.evaluate(() => {
      const root = document.querySelector("#complex-evaluate-root");
      const articles = Array.from(root.querySelectorAll("article"));
      return {
        marker: root.dataset.marker,
        config: JSON.parse(root.dataset.config),
        count: articles.length,
        firstText: articles[0].textContent,
        lastRowId: articles.at(-1).dataset.rowId,
      };
    });
    assertEqual(domResult.marker, complexInput.marker, "injected DOM keeps Unicode dataset values");
    assertEqual(domResult.config.labels.emoji, "🧪", "injected DOM keeps nested JSON data");
    assertEqual(domResult.count, 96, "a later evaluate can read the injected DOM");
    assertIncludes(domResult.firstText, "条目 0", "injected DOM keeps non-ASCII text");
    assertEqual(domResult.lastRowId, "95", "injected DOM keeps the final row identity");

    await source.close();
    await comparison.close();
  `;
}
