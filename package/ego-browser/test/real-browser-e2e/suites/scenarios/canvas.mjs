import { scenarioCase } from "./scenario-case.mjs";

export const canvasScenarioCase = scenarioCase(
  "canvas",
  `
      const canvas = page.getByTestId("whiteboard-stage");
      const pencil = page.getByRole("button", { name: "Pencil", exact: true });
      const pen = page.getByRole("button", { name: "Pen", exact: true });
      const brush = page.getByRole("button", { name: "Brush", exact: true });
      const marker = page.getByRole("button", { name: "Marker", exact: true });
      const eraser = page.getByRole("button", { name: "Eraser", exact: true });
      assertEqual(await canvas.getAttribute("data-background"), "dot-grid", "whiteboard exposes a dot-grid work surface");
      for (const tool of [pencil, pen, brush, marker, eraser]) {
        assertEqual(await tool.isVisible(), true, "whiteboard exposes five distinct drawing tools");
      }

      const toolbarSections = await Promise.all([
        page.getByRole("group", { name: "Drawing tools" }).boundingBox(),
        page.getByRole("group", { name: "Brush settings" }).boundingBox(),
        page.getByRole("group", { name: "Review actions" }).boundingBox(),
        page.getByRole("group", { name: "Export actions" }).boundingBox(),
      ]);
      assert(toolbarSections.every(Boolean), "every canvas toolbar section has a visible box");
      const toolbarCenters = toolbarSections.map((section) => section.y + section.height / 2);
      assert(
        Math.max(...toolbarCenters) - Math.min(...toolbarCenters) < 6,
        "drawing, settings, review and export controls share one toolbar row",
      );
      const reviewDocumentBox = await page.locator(".review-document").boundingBox();
      const exportActionsBox = toolbarSections.at(-1);
      assert(
        exportActionsBox.x + exportActionsBox.width <= reviewDocumentBox.x + reviewDocumentBox.width,
        "the complete single-row toolbar is visible without horizontal scrolling",
      );

      const box = await canvas.boundingBox();
      assert(box && box.width > 100 && box.height > 100, "whiteboard has a usable drawing area");

      async function draw(normalizedPoints) {
        const points = normalizedPoints.map(([x, y]) => ({
          x: box.x + box.width * x,
          y: box.y + box.height * y,
        }));
        await observedGesture(page, "whiteboard before drawing stroke", async (pointer) => {
          await pointer.move(points[0].x, points[0].y);
          await pointer.down();
          for (const point of points.slice(1)) {
            await pointer.move(point.x, point.y, { steps: 3 });
          }
          await pointer.up();
        });
      }

      function ellipse(cx, cy, rx, ry, segments = 16) {
        return Array.from({ length: segments + 1 }, (_, index) => {
          const angle = (Math.PI * 2 * index) / segments;
          return [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry];
        });
      }

      const color = page.getByLabel("Brush color");
      const size = page.getByLabel("Brush size");

      await observedAction(page, pencil, "click");
      await observedAction(page, color, "fill", "#334155");
      await observedAction(page, size, "selectOption", "4");
      assertEqual(await pencil.getAttribute("aria-pressed"), "true", "villa construction uses the precise pencil tool");
      assertEqual(await color.inputValue(), "#334155", "villa construction uses slate architectural ink");
      await draw([[0.08, 0.43], [0.3, 0.12], [0.53, 0.43]]);
      await draw([[0.14, 0.36], [0.14, 0.84], [0.49, 0.84], [0.49, 0.36]]);
      await draw([[0.49, 0.43], [0.61, 0.25], [0.74, 0.43]]);
      await draw([[0.49, 0.43], [0.49, 0.84], [0.71, 0.84], [0.71, 0.43]]);
      await draw([[0.2, 0.5], [0.28, 0.5], [0.28, 0.62], [0.2, 0.62], [0.2, 0.5]]);
      await draw([[0.36, 0.5], [0.44, 0.5], [0.44, 0.62], [0.36, 0.62], [0.36, 0.5]]);
      await draw([[0.29, 0.84], [0.29, 0.65], [0.38, 0.65], [0.38, 0.84]]);

      await observedAction(page, marker, "click");
      await observedAction(page, color, "fill", "#c2410c");
      await observedAction(page, size, "selectOption", "12");
      assertEqual(await marker.getAttribute("aria-pressed"), "true", "villa roofs use the broad marker tool");
      assertEqual(await color.inputValue(), "#c2410c", "villa roofs use terracotta color");
      await draw([[0.09, 0.42], [0.3, 0.14], [0.52, 0.42]]);
      await draw([[0.5, 0.42], [0.61, 0.27], [0.73, 0.42]]);

      await observedAction(page, brush, "click");
      await observedAction(page, color, "fill", "#2563eb");
      await observedAction(page, size, "selectOption", "8");
      assertEqual(await brush.getAttribute("aria-pressed"), "true", "car body uses the expressive brush tool");
      assertEqual(await color.inputValue(), "#2563eb", "car body uses cobalt blue");
      await draw([[0.46, 0.75], [0.51, 0.66], [0.64, 0.66], [0.69, 0.73], [0.76, 0.75], [0.77, 0.83], [0.44, 0.83], [0.45, 0.76], [0.46, 0.75]]);

      await observedAction(page, pen, "click");
      await observedAction(page, color, "fill", "#0f172a");
      await observedAction(page, size, "selectOption", "8");
      assertEqual(await pen.getAttribute("aria-pressed"), "true", "car details use the solid pen tool");
      assertEqual(await color.inputValue(), "#0f172a", "car details use near-black ink");
      await draw([[0.53, 0.67], [0.56, 0.73], [0.66, 0.73], [0.63, 0.67]]);
      await draw(ellipse(0.51, 0.83, 0.035, 0.055));
      await draw(ellipse(0.7, 0.83, 0.035, 0.055));

      assertEqual(await page.getByTestId("canvas-strokes").textContent(), "13", "real pointer gestures create a detailed villa and parked car");
      assert(Number(await page.getByTestId("canvas-points").textContent()) >= 120, "the villa scene contains enough sampled points to preserve its geometry");
      assertEqual(await page.getByRole("button", { name: "Undo last stroke" }).isEnabled(), true, "drawing enables the undo action");
      await observedAction(page, page.getByRole("button", { name: "Undo last stroke" }), "click");
      assertEqual(await page.getByTestId("canvas-strokes").textContent(), "12", "undo removes the most recent wheel");
      assertEqual(await page.getByRole("button", { name: "Redo stroke" }).isEnabled(), true, "undo enables redo");
      await observedAction(page, page.getByRole("button", { name: "Redo stroke" }), "click");
      assertEqual(await page.getByTestId("canvas-strokes").textContent(), "13", "redo restores the parked car wheel");
      await observedAction(page, page.getByRole("button", { name: "Save review" }), "click");
      assertEqual(await page.getByTestId("canvas-save-status").textContent(), "Saved 13 strokes", "save review records the complete villa scene");
      await observedAction(page, eraser, "click");
      assertEqual(await eraser.getAttribute("aria-pressed"), "true", "eraser becomes the active drawing tool");
      assertEqual(await color.isDisabled(), true, "eraser disables the irrelevant brush color control");
      await draw([[0.48, 0.76], [0.58, 0.76], [0.68, 0.76], [0.75, 0.76]]);
      assertEqual(await page.getByTestId("canvas-strokes").textContent(), "14", "a real pointer eraser gesture is recorded after the saved drawing");
      assertEqual(await page.getByTestId("canvas-save-status").textContent(), "Unsaved changes", "erasing marks the saved review as changed");

      const { readFile, stat } = await import("node:fs/promises");
      await cdp("Page.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: artifactDir,
      });

      async function waitForFile(path) {
        const deadline = Date.now() + 15_000;
        let previousSize = -1;
        while (Date.now() < deadline) {
          try {
            const current = await stat(path);
            if (current.size > 0 && current.size === previousSize) return current;
            previousSize = current.size;
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error("download did not complete: " + path);
      }

      const pngPath = join(artifactDir, "villa-review.png");
      await observedAction(page, page.getByRole("button", { name: "Export PNG" }), "click");
      await waitForFile(pngPath);
      assertEqual(await page.getByTestId("canvas-export-status").textContent(), "Exported PNG", "PNG export completes for a human-triggered download");
      const pngBytes = await readFile(pngPath);
      assertEqual(pngBytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG export writes a valid PNG signature");
      assert(pngBytes.length > 10_000, "PNG export contains the rendered villa scene");

      const svgPath = join(artifactDir, "villa-review.svg");
      await observedAction(page, page.getByRole("button", { name: "Export SVG" }), "click");
      await waitForFile(svgPath);
      assertEqual(await page.getByTestId("canvas-export-status").textContent(), "Exported SVG", "SVG export completes for a human-triggered download");
      const svgSource = await readFile(svgPath, "utf8");
      const { XMLParser } = await import(xmlParserUrl);
      const document = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
      }).parse(svgSource);
      const svg = document.svg;
      const paths = Array.isArray(svg.g.path) ? svg.g.path : [svg.g.path].filter(Boolean);
      assertEqual(svg["data-strokes"], "14", "SVG records drawing strokes and the eraser gesture");
      assertEqual(paths.length, 13, "SVG contains one vector path per villa-scene stroke");
      assertEqual(new Set(paths.map((path) => path["data-tool"])).size, 4, "SVG preserves the four selected drawing tools");
      assertEqual(svg.defs.mask.id, "eraser-mask", "SVG export applies a dedicated eraser mask");
      assertEqual(svg.defs.mask.path["data-tool"], "eraser", "SVG export preserves the real eraser gesture");
      for (const expectedColor of ["#334155", "#c2410c", "#2563eb", "#0f172a"]) {
        assert(paths.some((path) => path.stroke === expectedColor), "SVG preserves selected scene colors: " + expectedColor);
      }

      function bounds(path) {
        const numbers = String(path.d).match(/-?\\d+(?:\\.\\d+)?/g).map(Number);
        const xs = numbers.filter((_, index) => index % 2 === 0);
        const ys = numbers.filter((_, index) => index % 2 === 1);
        return {
          minX: Math.min(...xs), maxX: Math.max(...xs),
          minY: Math.min(...ys), maxY: Math.max(...ys),
        };
      }

      const width = Number(svg.width);
      const height = Number(svg.height);
      const roof = paths.find((path) => path["data-tool"] === "marker" && bounds(path).minX < width * 0.12);
      const car = paths.find((path) => path["data-tool"] === "brush" && path.stroke === "#2563eb");
      const wheels = paths.filter((path) => path["data-tool"] === "pen" && bounds(path).minY > height * 0.72);
      const roofBounds = bounds(roof);
      const carBounds = bounds(car);
      assert(roofBounds.minY < height * 0.2 && roofBounds.maxX - roofBounds.minX > width * 0.4, "SVG geometry contains the villa's large pitched roof");
      assert(carBounds.minY > height * 0.6 && carBounds.maxX - carBounds.minX > width * 0.28, "SVG geometry contains a wide car parked in front");
      assertEqual(wheels.length, 2, "SVG geometry contains two separate car wheels");
      assert(wheels.every((wheel) => bounds(wheel).maxY > height * 0.84), "both SVG wheels sit below the car body");
      await observedAction(page, page.getByRole("button", { name: "Clear markup" }), "click");
      assertEqual(await page.getByTestId("canvas-strokes").textContent(), "0", "clear markup removes every drawing and eraser stroke");
      assertEqual(await page.getByTestId("canvas-save-status").textContent(), "Cleared", "clear markup exposes a visible empty-state result");
      await observedAction(page, page.getByRole("button", { name: "Restore saved review" }), "click");
      assertEqual(await page.getByTestId("canvas-strokes").textContent(), "13", "restore returns to the last saved drawing without the later eraser gesture");
      assertEqual(await page.getByTestId("canvas-save-status").textContent(), "Restored 13 strokes", "restore reports the recovered saved review");
    `,
);
