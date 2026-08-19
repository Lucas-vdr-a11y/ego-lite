export function pageKeyboardInterfaceCase() {
  return `
    const task = await taskSpace(taskName);
    const page = await task.openPage(baseUrl + "/?workflow=page-keyboard-interface", {
      as: "page-keyboard-interface",
    });

    await page.evaluate(() => {
      const input = document.querySelector("#text-area");
      input.value = "";
      input.focus();
      window.__pageKeyboardContractEvents = [];
      for (const type of ["keydown", "keyup", "beforeinput", "input"]) {
        input.addEventListener(type, (event) => {
          window.__pageKeyboardContractEvents.push({
            type,
            key: event.key ?? null,
            code: event.code ?? null,
            location: event.location ?? null,
            repeat: event.repeat ?? false,
            shiftKey: event.shiftKey ?? false,
            data: event.data ?? null,
            trusted: event.isTrusted,
          });
        });
      }
    });

    // U+0020 through U+007E covers every printable ASCII character.
    const printable = Array.from(
      { length: 95 },
      (_, index) => String.fromCharCode(32 + index),
    ).join("");
    await page.keyboard.type(printable);
    assertEqual(
      await page.evaluate("document.querySelector('#text-area').value"),
      printable,
      "page.keyboard.type preserves every printable ASCII character"
    );

    const printableEvents = await page.evaluate("window.__pageKeyboardContractEvents");
    const printableDowns = printableEvents.filter((event) => event.type === "keydown");
    assertEqual(printableDowns.length, 95, "printable ASCII uses one keydown per character");
    assert(
      printableDowns.every((event) => event.trusted === true),
      "printable ASCII reaches the page as trusted keyboard input"
    );
    assertEqual(
      printableDowns
        .filter((event) => /^[0-9]$/.test(event.key))
        .map((event) => event.code)
        .join(","),
      Array.from({ length: 10 }, (_, digit) => "Digit" + digit).join(","),
      "digit characters use the main number row"
    );
    assertEqual(
      printableDowns.find((event) => event.key === ".")?.code,
      "Period",
      "period uses the main keyboard key"
    );
    assert(
      printableDowns.every((event) => !String(event.code).startsWith("Numpad")),
      "ordinary character typing never resolves to the numpad"
    );

    await page.evaluate(() => {
      const input = document.querySelector("#text-area");
      input.value = "";
      input.focus();
      window.__pageKeyboardContractEvents = [];
    });
    await page.keyboard.down("Shift");
    await page.keyboard.down("a");
    await page.keyboard.down("a");
    await page.keyboard.up("a");
    await page.keyboard.up("Shift");
    await page.keyboard.type("a");
    assertEqual(
      await page.evaluate("document.querySelector('#text-area').value"),
      "AAa",
      "down and up preserve then release modifier state"
    );
    const repeatedA = (await page.evaluate("window.__pageKeyboardContractEvents"))
      .filter((event) => event.type === "keydown" && event.code === "KeyA");
    assertEqual(repeatedA[0].repeat, false, "the first keydown is not a repeat");
    assertEqual(repeatedA[1].repeat, true, "a second down without up is a repeat");
    assertEqual(repeatedA[0].shiftKey, true, "held Shift modifies following keys");

    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("replaced");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Delete");
    assertEqual(
      await page.evaluate("document.querySelector('#text-area').value"),
      "replac",
      "press drives native selection, arrow, Backspace, and Delete behavior"
    );
    await page.keyboard.press("Enter");
    await page.keyboard.type("next");
    assertEqual(
      await page.evaluate("document.querySelector('#text-area').value"),
      "replac\\nnext",
      "named Enter inserts a line break"
    );

    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("A世界🙂");
    assertEqual(
      await page.evaluate("document.querySelector('#text-area').value"),
      "A世界🙂",
      "type falls back to native text insertion for non-US characters"
    );
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText("direct 世界🙂");
    assertEqual(
      await page.evaluate("document.querySelector('#text-area').value"),
      "direct 世界🙂",
      "insertText inserts one native text payload"
    );

    await page.evaluate("window.__pageKeyboardContractEvents = []");
    await page.keyboard.press("Numpad1");
    const numpadEvent = (await page.evaluate("window.__pageKeyboardContractEvents"))
      .find((event) => event.type === "keydown");
    assertEqual(numpadEvent.code, "Numpad1", "explicit numpad keys retain their physical code");
    assertEqual(numpadEvent.location, 3, "explicit numpad keys retain keypad location");
    assertEqual(numpadEvent.trusted, true, "explicit numpad keys remain trusted input");

    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("state");
    await assertRejects(
      () => page.keyboard.press("Shift+DefinitelyUnknown"),
      "Unknown key",
      "unknown keys reject"
    );
    await page.keyboard.type("a");
    assertEqual(
      await page.evaluate("document.querySelector('#text-area').value"),
      "statea",
      "a failed chord releases modifiers before the next action"
    );

    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("+");
    assertEqual(
      await page.evaluate("document.querySelector('#text-area').value"),
      "+",
      "a literal plus key is not mistaken for a chord separator"
    );

    await page.close();
  `;
}
