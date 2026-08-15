// The native agent cursor is painted by the browser UI layer, outside anything
// a page screenshot or the DOM can observe. What this case can establish end to
// end is the half that lives in ego-browser: a real Playwright pointer action
// reaches the native overlay call, carries the coordinates of the element it is
// about to act on, and the native side accepts them and reports the cursor
// shown.
export const agentMouseOverlayCase = {
  name: "agent mouse overlay",
  kind: "platform",
  body() {
    return `
      const task = await openE2eTaskSpace(taskName);
      const page = task.page;
      await page.goto(baseUrl + "/tests/clicks?platform=agent-mouse-overlay", {
        waitUntil: "load",
        timeout: 20_000,
      });

      const ego = globalThis.ego;
      assertEqual(
        typeof ego.animationHighlightMouseToPosition,
        "function",
        "the native runtime exposes the agent mouse overlay call",
      );
      const nativeHighlight = ego.animationHighlightMouseToPosition;
      const moves = [];
      const observeHighlight = (x, y) => {
        const shown = nativeHighlight.call(ego, x, y);
        moves.push({ x, y, shown });
        return shown;
      };
      ego.animationHighlightMouseToPosition = observeHighlight;
      assertEqual(
        ego.animationHighlightMouseToPosition,
        observeHighlight,
        "the native overlay call is observable for this case",
      );

      function assertMoveWithin(move, box, label) {
        assert(
          move.x >= box.x &&
            move.x <= box.x + box.width &&
            move.y >= box.y &&
            move.y <= box.y + box.height,
          label +
            ": cursor went to (" + move.x + ", " + move.y + "), element covers (" +
            box.x + ", " + box.y + ") to (" + (box.x + box.width) + ", " +
            (box.y + box.height) + ")",
        );
      }

      try {
        const probe = page.getByRole("button", { name: "Test click events" });
        await probe.scrollIntoViewIfNeeded();
        const probeBox = await probe.boundingBox();
        await probe.click();

        assert(moves.length > 0, "a Playwright click moves the native agent cursor");
        const clickMove = moves.at(-1);
        assertMoveWithin(
          clickMove,
          probeBox,
          "the click takes the cursor onto the element it acts on, in css pixels",
        );
        assertIncludes(
          JSON.stringify(await clickMove.shown),
          "mouse highlight shown",
          "the native side accepts the position and shows the cursor",
        );
        assertEqual(
          await page.getByTestId("click-count").textContent(),
          "1",
          "the observed click still reaches the page",
        );

        const movesAfterClick = moves.length;
        const menu = page.getByRole("button", { name: "More actions" });
        await menu.scrollIntoViewIfNeeded();
        const menuBox = await menu.boundingBox();
        await menu.hover();

        assert(
          moves.length > movesAfterClick,
          "a Playwright hover moves the native agent cursor",
        );
        assertMoveWithin(
          moves.at(-1),
          menuBox,
          "the hover takes the cursor onto the hovered element",
        );

        const movesBeforeKeyboard = moves.length;
        await page.keyboard.press("Escape");
        assertEqual(
          await page.getByTestId("click-count").textContent(),
          "1",
          "keyboard work runs without a pointer action",
        );
        assertEqual(
          moves.length,
          movesBeforeKeyboard,
          "work that presses no pointer leaves the cursor where it is",
        );
      } finally {
        ego.animationHighlightMouseToPosition = nativeHighlight;
      }
    `;
  },
};
