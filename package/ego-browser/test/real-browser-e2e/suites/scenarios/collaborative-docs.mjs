import { scenarioCase } from "./scenario-case.mjs";

export const collaborativeDocsScenarioCase = scenarioCase(
  "collaborative-docs",
  `
      await observedAction(page, page.getByRole("button", { name: "Reset document" }), "click");
      const resetDialog = page.getByRole("dialog", { name: "Reset shared document?" });
      assertEqual(await resetDialog.isVisible(), true, "destructive reset requires explicit confirmation");
      await observedAction(page, resetDialog.getByRole("button", { name: "Cancel" }), "click");
      assertEqual(await resetDialog.isVisible(), false, "cancel keeps the existing shared document open");
      await observedAction(page, page.getByRole("button", { name: "Reset document" }), "click");
      await observedAction(page, resetDialog.getByRole("button", { name: "Confirm reset" }), "click");

      const primaryEditor = page.getByRole("textbox", { name: "Collaborative document" });
      await observedAction(page, primaryEditor, "fill", "Pilot decision: proceed with the Singapore launch.");
      await observedAction(page, primaryEditor, "press", "ControlOrMeta+A");
      await observedAction(page, page.getByRole("button", { name: "Bold" }), "click");
      assertEqual(await page.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed"), "true", "document toolbar reports active formatting state");
      assertEqual(await page.getByTestId("sync-status").textContent(), "All changes synced", "primary editor persists its local CRDT state");

      const collaboratorPage = await task.context.newPage();
      try {
      await collaboratorPage.goto(baseUrl + "/tests/collaborative-docs?user=Aisha%20Rahman", {
        waitUntil: "load",
        timeout: 20_000,
      });
      const collaboratorEditor = collaboratorPage.getByRole("textbox", { name: "Collaborative document" });
      await collaboratorPage.waitForFunction(() =>
        document.querySelector('[aria-label="Collaborative document"]')?.textContent.includes("Singapore launch"),
      );
      await page.waitForFunction(() => document.querySelector('[data-testid="collaborator-count"]')?.textContent === "2 online");
      assertEqual(await page.getByTestId("collaborator-count").textContent(), "2 online", "primary tab reports both active collaborators");

      await observedAction(page, primaryEditor, "click");
      await observedAction(page, primaryEditor, "press", "Home");
      await observedAction(collaboratorPage, collaboratorEditor, "click");
      await observedAction(collaboratorPage, collaboratorEditor, "press", "End");
      await Promise.all([
        observedKeyboard(page, primaryEditor, "insertText", "Recorded by Mei. "),
        observedKeyboard(collaboratorPage, collaboratorEditor, "insertText", " Reviewed by Aisha."),
      ]);
      await page.waitForFunction(() => {
        const text = document.querySelector('[aria-label="Collaborative document"]')?.textContent || "";
        return text.includes("Recorded by Mei") && text.includes("Reviewed by Aisha");
      });
      await collaboratorPage.waitForFunction(() => {
        const text = document.querySelector('[aria-label="Collaborative document"]')?.textContent || "";
        return text.includes("Recorded by Mei") && text.includes("Reviewed by Aisha");
      });
      assertIncludes(await primaryEditor.textContent(), "Reviewed by Aisha", "concurrent remote text merges into the primary document");
      assertIncludes(await collaboratorEditor.textContent(), "Recorded by Mei", "concurrent primary text merges into the collaborator document");

      await observedAction(page, page.getByRole("button", { name: "Undo document change" }), "click");
      await collaboratorPage.waitForFunction(() =>
        !document.querySelector('[aria-label="Collaborative document"]')?.textContent.includes("Recorded by Mei"),
      );
      assertIncludes(await collaboratorEditor.textContent(), "Reviewed by Aisha", "undo removes only the primary author's local change");
      await observedAction(page, page.getByRole("button", { name: "Redo document change" }), "click");
      await collaboratorPage.waitForFunction(() =>
        document.querySelector('[aria-label="Collaborative document"]')?.textContent.includes("Recorded by Mei"),
      );
      await observedAction(collaboratorPage, collaboratorPage.getByRole("button", { name: "Save version" }), "click");
      assertEqual(await collaboratorPage.getByTestId("collab-version").textContent(), "Version 2", "collaborator creates a restorable document version");
      assertEqual(await collaboratorPage.getByTestId("version-history").getByRole("listitem").count(), 1, "saved version appears in visible version history");
      await page.waitForFunction(() => document.querySelector('[data-testid="collab-version"]')?.textContent === "Version 2");
      assertEqual(await page.getByTestId("version-history").getByRole("listitem").count(), 1, "primary tab receives the saved version history without reloading");

      await observedAction(collaboratorPage, collaboratorEditor, "fill", "Temporary replacement text");
      await observedAction(collaboratorPage, collaboratorPage.getByTestId("version-history").getByRole("button", { name: "Restore Version 2" }), "click");
      assertIncludes(await collaboratorEditor.textContent(), "Reviewed by Aisha", "saved version restores its actual document snapshot");
      await page.waitForFunction(() =>
        document.querySelector('[aria-label="Collaborative document"]')?.textContent.includes("Reviewed by Aisha"),
      );
      await page.reload({ waitUntil: "load" });
      assertIncludes(await page.getByRole("textbox", { name: "Collaborative document" }).textContent(), "Reviewed by Aisha", "restored shared document survives a full page reload");
      } finally {
        await observedClosePage(collaboratorPage, "collaborator page");
      }
      await page.waitForFunction(() => document.querySelector('[data-testid="collaborator-count"]')?.textContent === "1 online");
      assertEqual(await page.getByTestId("collaborator-count").textContent(), "1 online", "presence returns to one editor after the collaborator leaves");
      await observedAction(page, page.getByRole("button", { name: "Reset document" }), "click");
      const finalResetDialog = page.getByRole("dialog", { name: "Reset shared document?" });
      await observedAction(page, finalResetDialog.getByRole("button", { name: "Confirm reset" }), "click");
    `,
);
