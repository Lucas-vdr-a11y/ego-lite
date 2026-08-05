import { scenarioCase } from "./scenario-case.mjs";

export const keyboardScenarioCase = scenarioCase(
  "keyboard",
  `
      const title = page.getByLabel("Story title");
      await observedAction(page, title, "click");
      await observedKeyboard(page, title, "press", "ControlOrMeta+a");
      await observedKeyboard(page, title, "insertText", "Rooms that breathe");
      assertEqual(await page.getByTestId("keyboard-value").textContent(), "Rooms that breathe", "platform select-all and insertText replace the title");
      await observedKeyboard(page, title, "press", "Backspace");
      assertEqual(await page.getByTestId("keyboard-value").textContent(), "Rooms that breath", "Backspace edits the focused title");
      assertIncludes(await page.getByTestId("key-log").textContent(), "Backspace", "keyboard event log records editing keys");
      const body = page.getByLabel("Story body");
      await observedAction(page, body, "fill", "Shade changes the pace of a public room.");
      assertIncludes(await page.getByTestId("rich-value").textContent(), "Shade changes", "contenteditable input updates the document inspector");
      assertEqual(await page.getByTestId("word-count").textContent(), "8", "editor reports a deterministic body word count");
      await observedAction(page, body, "click");
      await observedAction(page, body, "press", "ControlOrMeta+a");
      await observedAction(page, page.getByRole("button", { name: "Bold" }), "click");
      assertEqual(await page.getByTestId("format-status").textContent(), "Bold applied", "rich text toolbar reports a formatting operation");
      assertEqual(await body.locator("b, strong").count(), 1, "real keyboard selection creates semantic bold content");
      await observedAction(page, body, "click");
      await observedAction(page, body, "press", "ControlOrMeta+a");
      await observedAction(page, page.getByRole("button", { name: "Italic" }), "click");
      assertEqual(await page.getByTestId("format-status").textContent(), "Italic applied", "italic formatting reports its user-visible result");
      assertEqual(await body.locator("i, em").count(), 1, "real keyboard selection creates semantic italic content");
      await observedAction(page, body, "click");
      await observedAction(page, body, "press", "End");
      await observedAction(page, body, "press", "Enter");
      await observedKeyboard(page, body, "type", "Material notes");
      await observedAction(page, page.getByRole("button", { name: "Bulleted list" }), "click");
      assertEqual(await page.getByTestId("format-status").textContent(), "Bulleted list applied", "list toolbar action reports its result");
      assertEqual(await body.locator("ul li").count(), 1, "keyboard-created line becomes a semantic bulleted list item");
      await observedPageKey(page, "Material notes", "ControlOrMeta+s");
      assertEqual(await page.getByTestId("save-status").textContent(), "Saved locally", "platform save shortcut persists the draft");
      await observedAction(page, page.getByRole("button", { name: "Save draft" }), "click");
      assertEqual(await page.getByTestId("save-status").textContent(), "Saved locally", "visible save action persists the same complete draft");
      await page.reload({ waitUntil: "load" });
      assertEqual(await page.getByLabel("Story title").inputValue(), "Rooms that breath", "saved title survives a reload");
      assertIncludes(await page.getByLabel("Story body").textContent(), "Shade changes", "saved body survives a reload");
      assert((await page.getByLabel("Story body").locator("b, strong").count()) >= 1, "saved draft preserves rich text markup across reload");
      assertEqual(await page.getByLabel("Story body").locator("ul li").count(), 1, "saved draft preserves list structure across reload");
      await observedAction(page, page.getByRole("button", { name: "Clear draft" }), "click");
      assertEqual(await page.getByLabel("Story title").inputValue(), "seed", "clear draft restores the seeded title");
      assertEqual(await page.getByTestId("word-count").textContent(), "0", "clear draft resets the word count");
    `,
);
