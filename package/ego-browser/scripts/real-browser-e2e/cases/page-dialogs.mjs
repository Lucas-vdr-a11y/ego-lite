export function pageJavaScriptDialogsCase() {
  return `
    const task = await taskSpace(taskName);
    const page = await task.openPage(baseUrl + "/?page-dialogs=" + Date.now(), {
      as: "page-dialogs",
    });

    try {
    await page.evaluate(() => {
      const controls = document.createElement("section");
      controls.innerHTML =
        '<button id="dialog-alert">Alert</button>' +
        '<button id="dialog-confirm">Confirm</button>' +
        '<button id="dialog-prompt">Prompt</button>' +
        '<output id="dialog-result">idle</output>';
      document.body.prepend(controls);

      const result = controls.querySelector("#dialog-result");
      const record = (value) => {
        result.textContent = value;
        result.dataset.value = value;
      };

      controls.querySelector("#dialog-alert").addEventListener("click", () => {
        alert("Alert from real E2E");
        record("alert:continued");
      });
      controls.querySelector("#dialog-confirm").addEventListener("click", () => {
        record("confirm:" + confirm("Confirm from real E2E"));
      });
      controls.querySelector("#dialog-prompt").addEventListener("click", () => {
        record("prompt:" + prompt("Prompt from real E2E", "initial answer"));
      });
    });

    async function openDialog(selector, expectedType, expectedMessage) {
      const startedAt = Date.now();
      const receipt = await page.click(selector);
      assert(
        Date.now() - startedAt < 5_000,
        expectedType + " action returns before the CDP timeout"
      );
      assertEqual(receipt.dialog?.type, expectedType, expectedType + " receipt reports its type");
      assertEqual(
        receipt.dialog?.message,
        expectedMessage,
        expectedType + " receipt reports its message"
      );

      const info = await page.info();
      assertEqual(info.dialog?.type, expectedType, expectedType + " remains pending for the caller");
      assertEqual(
        info.dialog?.message,
        expectedMessage,
        expectedType + " is readable while the page JavaScript is blocked"
      );
      return receipt.dialog;
    }

    await openDialog("#dialog-alert", "alert", "Alert from real E2E");
    await page.cdp("Page.handleJavaScriptDialog", { accept: true });
    await page.waitForSelector('[data-value="alert:continued"]', { timeout: 2_000 });

    await openDialog("#dialog-confirm", "confirm", "Confirm from real E2E");
    await page.cdp("Page.handleJavaScriptDialog", { accept: false });
    await page.waitForSelector('[data-value="confirm:false"]', { timeout: 2_000 });

    const promptDialog = await openDialog(
      "#dialog-prompt",
      "prompt",
      "Prompt from real E2E"
    );
    assertEqual(
      promptDialog.defaultPrompt,
      "initial answer",
      "prompt receipt reports the default text"
    );
    await page.cdp("Page.handleJavaScriptDialog", {
      accept: true,
      promptText: "replacement answer",
    });
    await page.waitForSelector('[data-value="prompt:replacement answer"]', {
      timeout: 2_000,
    });
    assertEqual(
      await page.evaluate("document.querySelector('#dialog-result').textContent"),
      "prompt:replacement answer",
      "page JavaScript continues after the prompt is handled"
    );

    } finally {
      const pending = await page.info().catch(() => null);
      if (pending?.dialog) {
        await page.cdp("Page.handleJavaScriptDialog", { accept: false }).catch(() => {});
      }
      await page.close().catch(() => {});
    }
  `;
}
