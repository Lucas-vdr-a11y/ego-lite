import { scenarioCase } from "./scenario-case.mjs";

export const richTextScenarioCase = scenarioCase(
  "rich-text",
  `
      await observedAction(page, page.getByRole("button", { name: "Reset article" }), "click");
      const resetDialog = page.getByRole("dialog", { name: "Reset article?" });
      await observedAction(page, resetDialog.getByRole("button", { name: "Cancel" }), "click");
      assertEqual(await resetDialog.isVisible(), false, "cancel leaves the current article unchanged");
      await observedAction(page, page.getByRole("button", { name: "Reset article" }), "click");
      await observedAction(page, resetDialog.getByRole("button", { name: "Confirm reset" }), "click");
      const articleTitle = page.getByLabel("Article title");
      const saveArticle = page.getByRole("button", { name: "Save article" });
      assertEqual(await articleTitle.inputValue(), "August release", "confirm reset restores the starting article title");
      await observedAction(page, articleTitle, "fill", "Temporary title");
      await observedAction(page, articleTitle, "fill", "");
      assertEqual(await articleTitle.inputValue(), "", "article title accepts an empty boundary value");
      assertEqual(await saveArticle.isEnabled(), true, "clearing the article title enables validation");
      await observedAction(page, saveArticle, "click");
      await page.waitForFunction(() => document.querySelector('[data-testid="rich-text-error"]')?.textContent === "Article title is required", undefined, { timeout: 5_000 });
      assertEqual(await page.getByTestId("rich-text-error").textContent(), "Article title is required", "article cannot be saved without required metadata");

      const editor = page.getByRole("textbox", { name: "Rich text article" });
      async function replaceEditorText(text) {
        await observedAction(page, editor, "click");
        await observedAction(page, editor, "press", "ControlOrMeta+A");
        await observedAction(page, editor, "press", "Backspace");
        if (text) await observedKeyboard(page, editor, "insertText", text);
      }
      await replaceEditorText("");
      await page.waitForFunction(() => document.querySelector('[data-testid="rich-text-word-count"]')?.textContent === "0 words");
      await observedAction(page, articleTitle, "fill", "Singapore pilot release");
      await observedAction(page, page.getByLabel("Publishing status"), "selectOption", "review");
      assertEqual(await articleTitle.inputValue(), "Singapore pilot release", "article metadata accepts the release title");
      await observedAction(page, saveArticle, "click");
      await page.waitForFunction(() => document.querySelector('[data-testid="rich-text-error"]')?.textContent === "Article body is required", undefined, { timeout: 5_000 });
      assertEqual(await page.getByTestId("rich-text-error").textContent(), "Article body is required", "article cannot be saved without a document body");
      await replaceEditorText("Release owner confirmed");
      await observedAction(page, editor, "press", "ControlOrMeta+A");
      await observedAction(page, page.getByRole("button", { name: "Blockquote" }), "click");
      assertIncludes(await page.getByTestId("rich-text-html").textContent(), "<blockquote>", "blockquote action creates semantic quoted content");
      assertIncludes((await page.getByTestId("article-preview").textContent()).replace(/\\s+/gu, " "), "Release owner confirmed", "preview includes the quoted release ownership note");

      await replaceEditorText("Editorial quality gate");
      await observedAction(page, editor, "press", "ControlOrMeta+A");
      await observedAction(page, page.getByRole("button", { name: "Blockquote" }), "click");
      await observedAction(page, page.getByRole("button", { name: "Paragraph" }), "click");
      await observedAction(page, page.getByRole("button", { name: "Italic" }), "click");
      await observedAction(page, page.getByRole("button", { name: "Strike" }), "click");
      await observedAction(page, page.getByRole("button", { name: "Text color" }), "click");
      await observedAction(page, page.getByRole("button", { name: "Blue" }), "click");
      const inlineHtml = await page.getByTestId("rich-text-html").textContent();
      assertIncludes(inlineHtml, "<em", "italic control applies emphasized semantic text");
      assertIncludes(inlineHtml, "<s>", "strike control applies deleted semantic text");
      assertEqual(await page.getByTestId("article-preview").locator("em").evaluate((element) => getComputedStyle(element).color), "rgb(37, 99, 235)", "color picker visibly applies the selected blue text color");
      await observedAction(page, page.getByRole("button", { name: "Insert link" }), "click");
      await observedAction(page, page.getByLabel("Link URL"), "fill", "https://example.com/releases/editorial-quality");
      await observedAction(page, page.getByLabel("Link URL"), "press", "Enter");
      assertEqual(await page.getByTestId("article-preview").getByRole("link").getAttribute("href"), "https://example.com/releases/editorial-quality", "link editor applies the requested destination");
      await observedAction(page, editor, "press", "ControlOrMeta+A");
      await observedAction(page, page.getByRole("button", { name: "Clear formatting" }), "click");
      const clearedHtml = await page.getByTestId("rich-text-html").textContent();
      assertEqual(clearedHtml.includes("<em"), false, "clear formatting removes italic text");
      assertEqual(clearedHtml.includes("<s>"), false, "clear formatting removes struck text");
      assertEqual(clearedHtml.includes("<a "), false, "clear formatting removes links");
      assertEqual(clearedHtml.includes("color:"), false, "clear formatting removes text color");

      await replaceEditorText("Rollout runbook");
      await observedAction(page, editor, "press", "ControlOrMeta+A");
      await observedAction(page, page.getByRole("button", { name: "Heading 3" }), "click");
      assertIncludes(await page.getByTestId("rich-text-html").textContent(), "<h3", "heading 3 control changes the selected block");
      await observedAction(page, page.getByRole("button", { name: "Paragraph" }), "click");
      assertIncludes(await page.getByTestId("rich-text-html").textContent(), "<p", "paragraph control restores a normal text block");
      await observedAction(page, page.getByRole("button", { name: "Code block" }), "click");
      assertIncludes(await page.getByTestId("rich-text-html").textContent(), "<pre", "code block control creates preformatted content");
      await observedAction(page, page.getByRole("button", { name: "Paragraph" }), "click");
      await observedAction(page, page.getByRole("button", { name: "Numbered list" }), "click");
      assertIncludes(await page.getByTestId("rich-text-html").textContent(), "<ol>", "numbered list control creates an ordered list");
      await observedAction(page, page.getByRole("button", { name: "Undo" }), "click");
      assertEqual((await page.getByTestId("rich-text-html").textContent()).includes("<ol>"), false, "undo removes the numbered list transformation");
      await observedAction(page, page.getByRole("button", { name: "Redo" }), "click");
      assertIncludes(await page.getByTestId("rich-text-html").textContent(), "<ol>", "redo restores the numbered list transformation");
      await observedAction(page, page.getByRole("button", { name: "Numbered list" }), "click");

      await replaceEditorText("Regional pilot approved");
      await observedAction(page, editor, "press", "ControlOrMeta+A");
      await observedAction(page, page.getByRole("button", { name: "Bold" }), "click");
      await observedAction(page, page.getByRole("button", { name: "Underline" }), "click");
      await observedAction(page, page.getByRole("button", { name: "Heading 2" }), "click");
      const formattedHtml = await page.getByTestId("rich-text-html").textContent();
      assertIncludes(formattedHtml, "<h2", "toolbar applies semantic heading formatting");
      assertIncludes(formattedHtml, "<strong>", "toolbar applies bold formatting");
      assertIncludes(formattedHtml, "<u>", "extended toolbar applies underline formatting");
      await observedAction(page, page.getByRole("button", { name: "Align center" }), "click");
      assertEqual(await page.getByTestId("article-preview").locator("h2").evaluate((element) => getComputedStyle(element).textAlign), "center", "extended toolbar visibly centers the selected heading");

      await observedAction(page, editor, "press", "ArrowRight");
      await observedAction(page, editor, "press", "Enter");
      await observedKeyboard(page, editor, "insertText", "Notify regional reviewers");
      await observedAction(page, page.getByRole("button", { name: "Bullet list" }), "click");
      assertIncludes((await page.getByTestId("article-preview").textContent()).replace(/\\s+/gu, " "), "Notify regional reviewers", "live reader preview mirrors visible article content");
      await observedAction(page, page.getByRole("button", { name: "Undo" }), "click");
      assertEqual((await page.getByTestId("rich-text-html").textContent()).includes("<ul>"), false, "undo removes the latest list transformation");
      await observedAction(page, page.getByRole("button", { name: "Redo" }), "click");
      assertIncludes(await page.getByTestId("rich-text-html").textContent(), "<ul>", "redo restores the latest list transformation");
      const articleWords = (await editor.innerText()).trim().split(/\\s+/u).filter(Boolean).length;
      assertEqual(await page.getByTestId("rich-text-word-count").textContent(), String(articleWords) + (articleWords === 1 ? " word" : " words"), "editor word count reflects the expanded article");
      assertEqual(await page.getByTestId("rich-text-save-state").textContent(), "Unsaved changes", "content or metadata changes expose a dirty state");

      await observedAction(page, saveArticle, "click");
      assertEqual(await page.getByTestId("rich-text-save-state").textContent(), "All changes saved", "save clears the article dirty state");
      assertIncludes(await page.getByTestId("rich-text-result").textContent(), "Ready for review", "save result includes the selected publishing status");
      await page.reload({ waitUntil: "load" });
      assertEqual(await page.getByLabel("Article title").inputValue(), "Singapore pilot release", "saved article title survives a full page reload");
      assertEqual(await page.getByLabel("Publishing status").inputValue(), "review", "saved publishing status survives a full page reload");
      assertIncludes(await page.getByRole("textbox", { name: "Rich text article" }).textContent(), "Notify regional reviewers", "saved rich text survives a full page reload");
      await observedAction(page, page.getByRole("button", { name: "Reset article" }), "click");
      const finalResetDialog = page.getByRole("dialog", { name: "Reset article?" });
      await observedAction(page, finalResetDialog.getByRole("button", { name: "Confirm reset" }), "click");
    `,
);
