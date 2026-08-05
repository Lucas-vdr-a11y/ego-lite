import {
  CANVAS_HEIGHT,
  CANVAS_INK,
  CANVAS_PAPER,
  CANVAS_WIDTH,
  PRECISION_CHIPS,
  PRIMARY_TARGETS,
  swatchRgb,
} from "../../site/src/scenarios/visual-path/targets.mjs";

import { scenarioCase } from "./scenario-case.mjs";

// The fixture and this case have to agree on every swatch colour, so the case
// reads the same module the page renders from instead of restating the values.
function describe(target) {
  return {
    id: target.id,
    width: target.width,
    height: target.height,
    pendingRgb: swatchRgb(target.pending),
    doneRgb: swatchRgb(target.done),
  };
}

const stage = {
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  paperRgb: swatchRgb(CANVAS_PAPER),
  inkRgb: swatchRgb(CANVAS_INK),
};

export const visualPathScenarioCase = scenarioCase(
  "visual-path",
  `
      const { decodePng, locateSwatch, pixelAt, toCssPoint } =
        await import(pixelToolsUrl);
      const PRIMARY = ${JSON.stringify(PRIMARY_TARGETS.map(describe))};
      const CHIPS = ${JSON.stringify(PRECISION_CHIPS.map(describe))};
      const STAGE = ${JSON.stringify(stage)};

      const environment = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        ratio: window.devicePixelRatio,
      }));
      const ratio = environment.ratio;
      assert(ratio >= 1, "the fixture reports a usable device pixel ratio");

      async function shoot(label) {
        return decodePng(await observedScreenshot(page, label));
      }

      async function shootWholePage() {
        const image = await page.screenshot({
          animations: "disabled",
          fullPage: true,
          timeout: 60_000,
        });
        return decodePng(image);
      }

      async function scrollPageTo(top) {
        await page.evaluate((value) => window.scrollTo(0, value), top);
        await new Promise((resolve) => setTimeout(resolve, 120));
        return page.evaluate(() => window.scrollY);
      }

      // Reads a target straight out of the image. Nothing here asks the DOM
      // where anything is: that is the whole point of the visual path.
      function sight(image, target) {
        const box = locateSwatch(image, target.pendingRgb);
        assert(box, target.id + " is visible in the screenshot");
        assertEqual(
          box.width,
          Math.round(target.width * ratio),
          target.id + " keeps its rendered width in the image",
        );
        assertEqual(
          box.height,
          Math.round(target.height * ratio),
          target.id + " keeps its rendered height in the image",
        );
        assert(
          box.fill > 0.98,
          target.id + " reads back as one solid block of its own colour",
        );
        return toCssPoint(box, ratio);
      }

      async function aim(target, point) {
        await observedPixelClick(page, "aiming at " + target.id, point);
        const readback = await page
          .getByTestId("visual-last-click")
          .textContent();
        const [coordinates, landedOn] = readback.split(" ");
        assertEqual(
          landedOn,
          target.id,
          "the click computed from pixels lands on " + target.id,
        );
        const [x, y] = coordinates.split(",").map(Number);
        assert(
          Math.abs(x - point.x) <= 1 && Math.abs(y - point.y) <= 1,
          target.id +
            " receives the aimed coordinate, off by at most a pixel: aimed " +
            point.x +
            "," +
            point.y +
            " received " +
            coordinates,
        );
      }

      await scrollPageTo(0);
      const board = await shoot("alignment board at rest");
      assertEqual(
        board.width,
        Math.round(environment.innerWidth * ratio),
        "a viewport screenshot spans the CSS viewport scaled by the device pixel ratio",
      );
      assertEqual(
        board.height,
        Math.round(environment.innerHeight * ratio),
        "a viewport screenshot is as tall as the CSS viewport scaled by the device pixel ratio",
      );

      // Records today's behaviour: Playwright would return CSS pixels here, and
      // the visual path would need no conversion at all. Once scale is honoured
      // this assertion fails and should be rewritten to expect CSS pixels.
      const cssScaled = decodePng(
        await page.screenshot({
          animations: "disabled",
          scale: "css",
          timeout: 60_000,
        }),
      );
      assertEqual(
        cssScaled.width,
        board.width,
        "scale:'css' still returns device pixels, so callers convert by the device pixel ratio themselves",
      );

      const clipped = decodePng(
        await page.screenshot({
          animations: "disabled",
          clip: { x: 0, y: 0, width: 80, height: 80 },
          timeout: 60_000,
        }),
      );
      assertEqual(
        clipped.width,
        Math.round(80 * ratio),
        "a clipped screenshot is the requested CSS box in device pixels",
      );
      assertEqual(
        pixelAt(clipped, Math.round(40 * ratio), Math.round(40 * ratio)).join(),
        pixelAt(board, Math.round(40 * ratio), Math.round(40 * ratio)).join(),
        "a clipped screenshot carries the same pixels as the matching part of the full screenshot",
      );

      // One clean image supplies every primary coordinate: click markers land on
      // the targets already hit, and re-reading between clicks would let a
      // marker eat into the neighbour that is measured next.
      const primaryPoints = PRIMARY.map((target) => sight(board, target));
      for (const [index, target] of PRIMARY.entries()) {
        await aim(target, primaryPoints[index]);
      }
      assertEqual(
        await page.getByTestId("visual-targets-done").textContent(),
        PRIMARY.length + " / " + (PRIMARY.length + CHIPS.length),
        "every primary target reports a hit",
      );

      const repainted = await shoot("primary targets marked");
      assert(
        locateSwatch(repainted, PRIMARY[0].doneRgb),
        "a hit target repaints itself in the very next screenshot",
      );
      assertEqual(
        locateSwatch(repainted, PRIMARY[0].pendingRgb),
        null,
        "the colour a hit target used to carry is gone from the image",
      );

      const missesBefore = await page.getByTestId("visual-miss-count").textContent();
      const lastBefore = await page.getByTestId("visual-last-click").textContent();
      await observedPixelClick(page, "aiming past the bottom of the viewport", {
        x: 40,
        y: environment.innerHeight + 200,
      });
      assertEqual(
        await page.getByTestId("visual-last-click").textContent(),
        lastBefore,
        "a coordinate below the viewport reaches no target",
      );
      assertEqual(
        await page.getByTestId("visual-miss-count").textContent(),
        missesBefore,
        "a coordinate below the viewport is not reported as a miss either",
      );

      const wholePage = await shootWholePage();
      assert(
        wholePage.height > board.height,
        "the fixture is taller than one viewport, so the page has to be scrolled",
      );
      const scrollbar = (board.width - wholePage.width) / ratio;
      assert(
        scrollbar >= 0 && scrollbar < 24,
        "a full-page screenshot drops only the scrollbar column, measured " +
          scrollbar +
          "px",
      );
      const chipOnPage = locateSwatch(wholePage, CHIPS[0].pendingRgb);
      assert(chipOnPage, "the first chip is visible in the full-page screenshot");
      const chipPageY = chipOnPage.centerY / ratio;
      const scrolled = await scrollPageTo(
        Math.max(0, Math.round(chipPageY - environment.innerHeight / 2)),
      );
      assert(scrolled > 0, "the page scrolled towards the precision chips");

      const chipBoard = await shoot("precision chips in view");
      const chipInView = locateSwatch(chipBoard, CHIPS[0].pendingRgb);
      assert(chipInView, "the first chip is visible after scrolling");
      assertEqual(
        Math.round(chipInView.centerY / ratio + scrolled),
        Math.round(chipPageY),
        "full-page screenshot coordinates are page coordinates, viewport screenshot coordinates are not",
      );

      const chipPoints = CHIPS.map((chip) => sight(chipBoard, chip));
      for (const [index, chip] of CHIPS.entries()) {
        await aim(chip, chipPoints[index]);
      }
      assertEqual(
        await page.getByTestId("visual-targets-done").textContent(),
        PRIMARY.length + CHIPS.length + " / " + (PRIMARY.length + CHIPS.length),
        "every calibration target down to the smallest chip reports a hit",
      );

      const stalePoint = chipPoints[chipPoints.length - 1];
      await scrollPageTo(scrolled + 140);
      await observedPixelClick(page, "aiming with a stale coordinate", stalePoint);
      const staleReadback = await page
        .getByTestId("visual-last-click")
        .textContent();
      assert(
        !staleReadback.endsWith(" " + CHIPS[CHIPS.length - 1].id),
        "a coordinate read before scrolling no longer points at its target: " +
          staleReadback,
      );

      const stageBoard = await shoot("canvas stage in view");
      const paper = locateSwatch(stageBoard, STAGE.paperRgb);
      assert(paper, "the canvas surface is visible in the screenshot");
      assertEqual(
        paper.width,
        Math.round(STAGE.width * ratio),
        "the canvas surface reads back at its rendered width",
      );
      const stageLeft = paper.minX / ratio;
      const stageTop = paper.minY / ratio;
      const stageWidth = paper.width / ratio;
      const stageHeight = paper.height / ratio;
      const from = {
        x: stageLeft + stageWidth * 0.15,
        y: stageTop + stageHeight * 0.25,
      };
      const via = {
        x: stageLeft + stageWidth * 0.5,
        y: stageTop + stageHeight * 0.7,
      };
      const to = {
        x: stageLeft + stageWidth * 0.82,
        y: stageTop + stageHeight * 0.4,
      };
      await observedGesture(page, "canvas before the stroke", async (pointer) => {
        await pointer.move(from.x, from.y);
        await pointer.down();
        await pointer.move(via.x, via.y, { steps: 8 });
        await pointer.move(to.x, to.y, { steps: 8 });
        await pointer.up();
      });
      assertEqual(
        await page.getByTestId("visual-canvas-strokes").textContent(),
        "1",
        "a pressed pointer path draws one stroke on a surface with no structure to read",
      );

      const inked = await shoot("canvas after the stroke");
      const ink = locateSwatch(inked, STAGE.inkRgb);
      assert(ink, "the stroke is visible in the screenshot");
      assert(
        Math.abs(ink.minX / ratio - from.x) <= 4,
        "the stroke starts at the pixel the pointer pressed on",
      );
      assert(
        Math.abs(ink.maxX / ratio - to.x) <= 4,
        "the stroke ends at the pixel the pointer released on",
      );
      assert(
        ink.height / ratio > stageHeight * 0.3,
        "the stroke follows the whole dragged path instead of joining two points",
      );
    `,
);
