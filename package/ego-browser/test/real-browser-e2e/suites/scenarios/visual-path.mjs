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

      async function shootObservedCss(label) {
        return decodePng(await observedScreenshot(page, label));
      }

      // Every coordinate this case aims with is read out of a scale:'css'
      // screenshot and handed to page.mouse unconverted, because page.mouse
      // speaks CSS pixels. That binds the clicks below to CSS pixel
      // screenshots: should they ever stop being honoured, the image comes
      // back in device pixels, every coordinate read out of it is one device
      // pixel ratio too large, and the aiming fails instead of passing on a
      // conversion this case did itself. A 1x display cannot tell the two
      // units apart; the ratio the fixture reports is asserted on below.
      async function shootCss(label, options) {
        const image = await page.screenshot({
          animations: "disabled",
          scale: "css",
          timeout: 60_000,
          ...options,
        });
        assert(image.length > 0, label + " screenshot contains image bytes");
        return decodePng(image);
      }

      async function shootDevice(label, options) {
        const image = await page.screenshot({
          animations: "disabled",
          scale: "device",
          timeout: 60_000,
          ...options,
        });
        assert(image.length > 0, label + " screenshot contains image bytes");
        return decodePng(image);
      }

      async function scrollPageTo(top) {
        await page.evaluate((value) => window.scrollTo(0, value), top);
        await new Promise((resolve) => setTimeout(resolve, 120));
        return page.evaluate(() => window.scrollY);
      }

      // Reads a target straight out of a CSS pixel image. Nothing here asks the
      // DOM where anything is: that is the whole point of the visual path. The
      // measured size is compared against the CSS box rather than the device
      // pixel one, so an image that came back in device pixels is caught here
      // before its centre is ever aimed at. A swatch edge that lands on a
      // fractional CSS pixel is antialiased away from its own colour, which
      // costs at most one row or column of the match.
      function sight(image, target) {
        const box = locateSwatch(image, target.pendingRgb);
        assert(box, target.id + " is visible in the screenshot");
        assert(
          Math.abs(box.width - target.width) <= 1,
          target.id +
            " keeps its CSS width in the image: measured " +
            box.width +
            " against a CSS width of " +
            target.width +
            " and a device pixel width of " +
            Math.round(target.width * ratio),
        );
        assert(
          Math.abs(box.height - target.height) <= 1,
          target.id +
            " keeps its CSS height in the image: measured " +
            box.height +
            " against a CSS height of " +
            target.height +
            " and a device pixel height of " +
            Math.round(target.height * ratio),
        );
        assert(
          box.fill > 0.98,
          target.id + " reads back as one solid block of its own colour",
        );
        // No division by the device pixel ratio: a centre read out of a CSS
        // pixel image is already the coordinate page.mouse takes.
        return { x: box.centerX, y: box.centerY };
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
      // observedScreenshot is the shared pre-gesture observation path. It
      // explicitly asks Playwright for CSS pixels, so its dimensions and every
      // coordinate read from it must stay in the same unit page.mouse accepts.
      const cssBoard = await shootObservedCss("alignment board at rest");
      assertEqual(
        cssBoard.width,
        environment.innerWidth,
        "the shared scale:'css' screenshot spans the CSS viewport, so an x read from it is already a page.mouse x",
      );
      assertEqual(
        cssBoard.height,
        environment.innerHeight,
        "the shared scale:'css' screenshot is as tall as the CSS viewport, so a y read from it is already a page.mouse y",
      );

      // A separate explicit device-scale capture proves the CSS result was
      // converted rather than merely compared against another CSS screenshot.
      // It is comparison evidence only; no aimed coordinate comes from it.
      const deviceBoard = await shootDevice(
        "alignment board at rest in device pixels",
      );
      assertEqual(
        deviceBoard.width,
        Math.round(environment.innerWidth * ratio),
        "an explicit scale:'device' screenshot spans the CSS viewport scaled by the device pixel ratio",
      );
      assertEqual(
        deviceBoard.height,
        Math.round(environment.innerHeight * ratio),
        "an explicit scale:'device' screenshot is as tall as the CSS viewport scaled by the device pixel ratio",
      );
      assertEqual(
        Math.round(cssBoard.width * ratio),
        deviceBoard.width,
        "the css screenshot is the device pixel screenshot divided by the device pixel ratio",
      );
      assert(
        ratio === 1 || cssBoard.width < deviceBoard.width,
        "scale:'css' is observably smaller than scale:'device' on a high-DPI display",
      );

      // The same swatch located in both images: aiming straight off the css
      // image is the same aim as the device pixel reading converted by hand,
      // which is what this case used to do for every click.
      const deviceAlpha = locateSwatch(deviceBoard, PRIMARY[0].pendingRgb);
      const cssAlpha = locateSwatch(cssBoard, PRIMARY[0].pendingRgb);
      assert(
        deviceAlpha && cssAlpha,
        PRIMARY[0].id + " is visible in both the device pixel and css images",
      );
      const convertedAlpha = toCssPoint(deviceAlpha, ratio);
      assert(
        Math.abs(convertedAlpha.x - cssAlpha.centerX) <= 1 &&
          Math.abs(convertedAlpha.y - cssAlpha.centerY) <= 1,
        "a centre read off the css image needs no conversion: css reads " +
          cssAlpha.centerX +
          "," +
          cssAlpha.centerY +
          " against a device pixel reading of " +
          deviceAlpha.centerX +
          "," +
          deviceAlpha.centerY +
          " converted to " +
          convertedAlpha.x +
          "," +
          convertedAlpha.y +
          " at ratio " +
          ratio,
      );

      // The css scale reaches every screenshot surface, not just the viewport
      // one. An element screenshot comes back as that element's CSS box, grown
      // outward to whole pixels when the box sits on a fraction, so each axis is
      // the rendered size or one pixel more.
      const alphaImage = decodePng(
        await page.locator("#swatch-" + PRIMARY[0].id).screenshot({
          animations: "disabled",
          scale: "css",
          timeout: 60_000,
        }),
      );
      assert(
        alphaImage.width === PRIMARY[0].width ||
          alphaImage.width === PRIMARY[0].width + 1,
        "a scale:'css' element screenshot is as wide as the element's CSS box: measured " +
          alphaImage.width +
          " against a rendered width of " +
          PRIMARY[0].width +
          " and a device pixel width of " +
          Math.round(PRIMARY[0].width * ratio),
      );
      assert(
        alphaImage.height === PRIMARY[0].height ||
          alphaImage.height === PRIMARY[0].height + 1,
        "a scale:'css' element screenshot is as tall as the element's CSS box: measured " +
          alphaImage.height +
          " against a rendered height of " +
          PRIMARY[0].height +
          " and a device pixel height of " +
          Math.round(PRIMARY[0].height * ratio),
      );

      const clipped = decodePng(
        await page.screenshot({
          animations: "disabled",
          clip: { x: 0, y: 0, width: 80, height: 80 },
          scale: "device",
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
        pixelAt(
          deviceBoard,
          Math.round(40 * ratio),
          Math.round(40 * ratio),
        ).join(),
        "a clipped screenshot carries the same pixels as the matching part of the full screenshot",
      );

      // One clean image supplies every primary coordinate: click markers land on
      // the targets already hit, and re-reading between clicks would let a
      // marker eat into the neighbour that is measured next.
      const primaryPoints = PRIMARY.map((target) => sight(cssBoard, target));
      for (const [index, target] of PRIMARY.entries()) {
        await aim(target, primaryPoints[index]);
      }
      assertEqual(
        await page.getByTestId("visual-targets-done").textContent(),
        PRIMARY.length + " / " + (PRIMARY.length + CHIPS.length),
        "every primary target reports a hit",
      );

      const repainted = await shootObservedCss("primary targets marked");
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

      const deviceWholePage = await shootDevice("the whole page in device pixels", {
        fullPage: true,
      });
      assert(
        deviceWholePage.height > deviceBoard.height,
        "the fixture is taller than one viewport, so the page has to be scrolled",
      );
      const scrollbar = (deviceBoard.width - deviceWholePage.width) / ratio;
      assert(
        scrollbar >= 0 && scrollbar < 24,
        "a full-page screenshot drops only the scrollbar column, measured " +
          scrollbar +
          "px",
      );

      const cssWholePage = await shootCss("the whole page in css pixels", {
        fullPage: true,
      });
      assert(
        Math.abs(cssWholePage.width * ratio - deviceWholePage.width) <= 1 &&
          Math.abs(cssWholePage.height * ratio - deviceWholePage.height) <= 1,
        "a full-page scale:'css' screenshot is the full-page device pixel screenshot in CSS pixels, measured " +
          cssWholePage.width +
          "x" +
          cssWholePage.height +
          " against " +
          deviceWholePage.width +
          "x" +
          deviceWholePage.height +
          " at ratio " +
          ratio,
      );
      assert(
        cssWholePage.height > cssBoard.height,
        "a full-page scale:'css' screenshot still spans the whole document rather than one viewport",
      );
      // The scroll target is a page coordinate, and window.scrollTo takes CSS
      // pixels too, so it is read off the css full-page image directly.
      const chipOnPage = locateSwatch(cssWholePage, CHIPS[0].pendingRgb);
      assert(chipOnPage, "the first chip is visible in the full-page screenshot");
      const chipPageY = chipOnPage.centerY;
      const scrolled = await scrollPageTo(
        Math.max(0, Math.round(chipPageY - environment.innerHeight / 2)),
      );
      assert(scrolled > 0, "the page scrolled towards the precision chips");

      const chipBoard = await shootCss("precision chips in view");
      const chipInView = locateSwatch(chipBoard, CHIPS[0].pendingRgb);
      assert(chipInView, "the first chip is visible after scrolling");
      assert(
        Math.abs(chipInView.centerY + scrolled - chipPageY) <= 1,
        "full-page screenshot coordinates are page coordinates, viewport screenshot coordinates are not: the chip sits at " +
          chipInView.centerY +
          " in a viewport scrolled to " +
          scrolled +
          " against a page position of " +
          chipPageY,
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

      const stageBoard = await shootCss("canvas stage in view");
      const paper = locateSwatch(stageBoard, STAGE.paperRgb);
      assert(paper, "the canvas surface is visible in the screenshot");
      assert(
        Math.abs(paper.width - STAGE.width) <= 1,
        "the canvas surface reads back at its CSS width: measured " +
          paper.width +
          " against a CSS width of " +
          STAGE.width +
          " and a device pixel width of " +
          Math.round(STAGE.width * ratio),
      );
      // Every point of the gesture below is a CSS pixel taken straight from the
      // image, the same unit page.mouse moves in.
      const stageLeft = paper.minX;
      const stageTop = paper.minY;
      const stageWidth = paper.width;
      const stageHeight = paper.height;
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

      const inked = await shootCss("canvas after the stroke");
      const ink = locateSwatch(inked, STAGE.inkRgb);
      assert(ink, "the stroke is visible in the screenshot");
      assert(
        Math.abs(ink.minX - from.x) <= 4,
        "the stroke starts at the pixel the pointer pressed on: the ink begins at " +
          ink.minX +
          " against a press at " +
          from.x,
      );
      assert(
        Math.abs(ink.maxX - to.x) <= 4,
        "the stroke ends at the pixel the pointer released on: the ink ends at " +
          ink.maxX +
          " against a release at " +
          to.x,
      );
      assert(
        ink.height > stageHeight * 0.3,
        "the stroke follows the whole dragged path instead of joining two points",
      );
    `,
);
