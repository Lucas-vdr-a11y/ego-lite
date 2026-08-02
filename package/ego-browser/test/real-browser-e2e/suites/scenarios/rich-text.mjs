import { scenarioCase } from "./scenario-case.mjs";

export const richTextScenarioCase = scenarioCase(
  "rich-text",
  `
      await page.getByRole("button", { name: "Reset article" }).click();
      const resetDialog = page.getByRole("dialog", { name: "Reset article?" });
      await resetDialog.getByRole("button", { name: "Cancel" }).click();
      assertEqual(await resetDialog.isVisible(), false, "cancel leaves the current article unchanged");
      await page.getByRole("button", { name: "Reset article" }).click();
      await resetDialog.getByRole("button", { name: "Confirm reset" }).click();
      await page.getByLabel("Article title").fill("");
      await page.getByRole("button", { name: "Save article" }).click();
      assertEqual(await page.getByTestId("rich-text-error").textContent(), "Article title is required", "article cannot be saved without required metadata");

      await page.getByLabel("Article title").fill("Singapore pilot release");
      await page.getByLabel("Publishing status").selectOption("review");
      const editor = page.getByRole("textbox", { name: "Rich text article" });
      await editor.fill("");
      await page.getByRole("button", { name: "Save article" }).click();
      assertEqual(await page.getByTestId("rich-text-error").textContent(), "Article body is required", "article cannot be saved without a document body");
      await editor.fill("Release owner confirmed");
      await editor.press("ControlOrMeta+A");
      await page.getByRole("button", { name: "Blockquote" }).click();
      assertIncludes(await page.getByTestId("rich-text-html").textContent(), "<blockquote>", "blockquote action creates semantic quoted content");
      assertIncludes(await page.getByTestId("article-preview").textContent(), "Release owner confirmed", "preview includes the quoted release ownership note");
      await editor.fill("Regional pilot approved");
      await editor.press("ControlOrMeta+A");
      await page.getByRole("button", { name: "Bold" }).click();
      await page.getByRole("button", { name: "Heading 2" }).click();
      assertIncludes(await page.getByTestId("rich-text-html").textContent(), "<h2><strong>Regional pilot approved</strong></h2>", "toolbar composes semantic heading and bold formatting");

      await editor.press("ArrowRight");
      await editor.press("Enter");
      await page.keyboard.type("Notify regional reviewers");
      await page.getByRole("button", { name: "Bullet list" }).click();
      assertIncludes(await page.getByTestId("article-preview").textContent(), "Notify regional reviewers", "live reader preview mirrors visible article content");
      await page.getByRole("button", { name: "Undo" }).click();
      assertEqual((await page.getByTestId("rich-text-html").textContent()).includes("<ul>"), false, "undo removes the latest list transformation");
      await page.getByRole("button", { name: "Redo" }).click();
      assertIncludes(await page.getByTestId("rich-text-html").textContent(), "<ul>", "redo restores the latest list transformation");
      const articleWords = (await editor.innerText()).trim().split(/\\s+/u).filter(Boolean).length;
      assertEqual(await page.getByTestId("rich-text-word-count").textContent(), String(articleWords) + (articleWords === 1 ? " word" : " words"), "editor word count reflects the expanded article");
      assertEqual(await page.getByTestId("rich-text-save-state").textContent(), "Unsaved changes", "content or metadata changes expose a dirty state");

      await page.getByRole("button", { name: "Save article" }).click();
      assertEqual(await page.getByTestId("rich-text-save-state").textContent(), "All changes saved", "save clears the article dirty state");
      assertIncludes(await page.getByTestId("rich-text-result").textContent(), "Ready for review", "save result includes the selected publishing status");
      await page.reload({ waitUntil: "load" });
      assertEqual(await page.getByLabel("Article title").inputValue(), "Singapore pilot release", "saved article title survives a full page reload");
      assertEqual(await page.getByLabel("Publishing status").inputValue(), "review", "saved publishing status survives a full page reload");
      assertIncludes(await page.getByRole("textbox", { name: "Rich text article" }).textContent(), "Notify regional reviewers", "saved rich text survives a full page reload");
      await page.getByRole("button", { name: "Reset article" }).click();
      await page.getByRole("dialog", { name: "Reset article?" }).getByRole("button", { name: "Confirm reset" }).click();
    `,
);
