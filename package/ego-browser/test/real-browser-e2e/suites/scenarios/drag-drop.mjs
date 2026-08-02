import { scenarioCase } from "./scenario-case.mjs";

export const dragDropScenarioCase = scenarioCase(
  "drag-drop",
  `
      const dragSource = page.locator("#mouse-drag-source");
      const dragTarget = page.locator("#mouse-drag-target");
      const dragHandle = page.getByRole("button", { name: "Drag checkout reassurance" });
      await page.locator(".kanban-board").waitFor({ state: "visible" });
      await page.waitForFunction(() => document.querySelector(".kanban-board")?.dataset.dragReady === "true");
      assertEqual(await dragSource.isVisible(), true, "sprint board exposes a visible drag source");
      assertEqual(await dragTarget.isVisible(), true, "sprint board exposes a visible review target");
      assertEqual(await dragHandle.isVisible(), true, "sprint card exposes a dedicated drag handle without sacrificing selectable text");
      const handleBox = await dragHandle.boundingBox();
      const targetBox = await dragTarget.boundingBox();
      assert(handleBox && targetBox, "drag handle and review column expose pointer coordinates");
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(10, 10, { steps: 12 });
      await page.mouse.up();
      assertEqual(await dragSource.getAttribute("data-column"), "progress", "invalid drop outside the board keeps the card in its original column");
      assertEqual(await page.getByTestId("progress-count").textContent(), "2", "invalid drop does not change workflow counts");
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height * 0.72, { steps: 12 });
      await page.mouse.up();
      assertEqual(await page.getByTestId("mouse-drag-status").textContent(), "Checkout reassurance moved to Review", "a real pointer gesture moves work into review");
      assertEqual(await dragSource.getAttribute("data-column"), "review", "pointer drop changes the card workflow column");
      assertEqual(await page.getByTestId("review-count").textContent(), "2", "pointer drop updates the review column count");
      assertEqual(await page.evaluate(() => getSelection().toString()), "", "dragging by the handle does not select card text");
      const htmlSource = page.locator("#html-drag-source");
      const htmlTarget = page.locator("#html-drop-target");
      assertEqual(await htmlSource.getAttribute("draggable"), "true", "board exposes a native draggable release card");
      await htmlSource.dragTo(htmlTarget);
      assertEqual(await page.getByTestId("html-drop-status").textContent(), "ego-payload", "native HTML drag and drop delivers its dataTransfer payload");
      assertEqual(await htmlSource.getAttribute("data-column"), "done", "native drop moves the release card into the destination");
      await page.getByRole("button", { name: "Reset board" }).click();
      assertEqual(await dragSource.getAttribute("data-column"), "progress", "reset restores the pointer card to its original column");
      assertEqual(await htmlSource.getAttribute("data-column"), "ready", "reset restores the native draggable card");
      const reverseCard = page.locator('[data-card-title="Keyboard order audit"]');
      const reverseHandle = page.getByRole("button", { name: "Drag keyboard order audit" });
      const reverseHandleBox = await reverseHandle.boundingBox();
      const progressTargetBox = await page.locator('[data-kanban-list][data-column="progress"]').boundingBox();
      assert(reverseHandleBox && progressTargetBox, "review card and progress column expose reverse drag coordinates");
      await page.mouse.move(reverseHandleBox.x + reverseHandleBox.width / 2, reverseHandleBox.y + reverseHandleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(reverseHandleBox.x + reverseHandleBox.width / 2 + 12, reverseHandleBox.y + reverseHandleBox.height / 2 + 12, { steps: 4 });
      await page.mouse.move(progressTargetBox.x + progressTargetBox.width / 2, progressTargetBox.y + Math.min(progressTargetBox.height * 0.5, 100), { steps: 20 });
      await page.waitForFunction(() =>
        document.querySelector('[data-card-title="Keyboard order audit"]')?.parentElement?.dataset.column === "progress",
      );
      await page.mouse.up();
      assertEqual(await reverseCard.getAttribute("data-column"), "progress", "reverse drag moves reviewed work back into progress");
      assertEqual(await page.getByTestId("progress-count").textContent(), "3", "reverse drag updates the source workflow count");
      assertEqual(await page.getByTestId("review-count").textContent(), "0", "reverse drag updates the review workflow count");
      await page.getByRole("button", { name: "Reset board" }).click();
      await page.getByRole("button", { name: "Move checkout reassurance to review" }).click();
      assertEqual(await dragSource.getAttribute("data-column"), "review", "accessible move action provides a keyboard alternative to dragging");
    `,
);
