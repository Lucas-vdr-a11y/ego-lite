export function pageJavaScriptDialogHandoffCase() {
  return `
    const task = await taskSpace(taskName);
    const page = await task.openPage(baseUrl + "/?page-dialogs=" + Date.now(), {
      as: "page-dialogs",
    });

    await page.evaluate(() => {
      const button = document.createElement("button");
      button.id = "dialog-alert";
      button.textContent = "Alert";
      const result = document.createElement("output");
      result.id = "dialog-result";
      result.textContent = "idle";
      button.addEventListener("click", () => {
        alert("Alert from real E2E");
        result.textContent = "alert:continued";
        result.dataset.value = "alert:continued";
      });
      document.body.prepend(button, result);
    });

    await writeFile(
      join(tempDir, "dialog-hard-stop.json"),
      JSON.stringify({ label: page.label, targetId: page.targetId })
    );

    // Ego Lite may hand control to the user, which terminates this script. If
    // it keeps Agent control, the Page layer must return the dialog instead of
    // waiting for the blocked input command to time out.
    const receipt = await page.click("#dialog-alert");
    assertEqual(receipt.dialog?.type, "alert", "the action reports the dialog type");
    assertEqual(
      receipt.dialog?.message,
      "Alert from real E2E",
      "the action reports the dialog message"
    );
    cliLog(JSON.stringify({ dialogReceipt: true }));
  `;
}

export function pageJavaScriptDialogRecoveryCase() {
  return `
    const saved = JSON.parse(
      await readFile(join(tempDir, "dialog-hard-stop.json"), "utf8")
    );
    // This is test-only simulation of the user explicitly asking the Agent to
    // resume. Production code never takes control back automatically.
    const task = await takeOverTaskSpace(taskName);
    const page = task.page(saved.label);

    await page.close();
    assertEqual(page.targetId, saved.targetId, "takeover restores the dialog Page");
    assert(
      !(await task.pages()).some((candidate) => candidate.label === saved.label),
      "recovery closes the blocked dialog Page"
    );
  `;
}
