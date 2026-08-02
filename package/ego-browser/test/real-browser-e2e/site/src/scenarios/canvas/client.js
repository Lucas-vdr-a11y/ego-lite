import Konva from "konva";

const container = document.querySelector("#whiteboard-stage");
const layer = new Konva.Layer();
const stage = new Konva.Stage({
  container,
  width: container.clientWidth,
  height: container.clientHeight,
});
stage.add(layer);

const strokeOutput = document.querySelector('[data-testid="canvas-strokes"]');
const pointOutput = document.querySelector('[data-testid="canvas-points"]');
const toolOutput = document.querySelector('[data-testid="canvas-tool"]');
const brushOutput = document.querySelector('[data-testid="canvas-brush-size"]');
const saveOutput = document.querySelector('[data-testid="canvas-save-status"]');
const colorInput = document.querySelector("#canvas-color");
const brushInput = document.querySelector("#canvas-brush-size");
const undoButton = document.querySelector("#undo-canvas");
const redoButton = document.querySelector("#redo-canvas");
const saveButton = document.querySelector("#save-canvas");
const restoreButton = document.querySelector("#restore-canvas");
const clearButton = document.querySelector("#clear-canvas");
const exportPngButton = document.querySelector("#export-canvas-png");
const exportSvgButton = document.querySelector("#export-canvas-svg");
const exportOutput = document.querySelector(
  '[data-testid="canvas-export-status"]',
);
const toolButtons = Array.from(document.querySelectorAll("[data-canvas-tool]"));

const TOOL_STYLES = {
  pencil: {
    name: "Pencil",
    opacity: 0.78,
    scale: 0.6,
    tension: 0.05,
    lineCap: "round",
  },
  pen: {
    name: "Pen",
    opacity: 1,
    scale: 1,
    tension: 0.35,
    lineCap: "round",
  },
  brush: {
    name: "Brush",
    opacity: 0.88,
    scale: 1.4,
    tension: 0.5,
    lineCap: "round",
  },
  marker: {
    name: "Marker",
    opacity: 0.35,
    scale: 1.8,
    tension: 0.2,
    lineCap: "square",
  },
  eraser: {
    name: "Eraser",
    opacity: 1,
    scale: 1,
    tension: 0.25,
    lineCap: "round",
  },
};

let activeTool = "pen";
let drawing = false;
let currentStroke;
let strokes = [];
let redoStrokes = [];
let savedStrokes = [];

function copyStrokes(value) {
  return value.map((stroke) => ({ ...stroke, points: [...stroke.points] }));
}

function toolName(tool) {
  return TOOL_STYLES[tool].name;
}

function lineFor(stroke) {
  return new Konva.Line({
    points: stroke.points,
    stroke: stroke.color,
    strokeWidth: stroke.width,
    opacity: stroke.opacity,
    tension: stroke.tension,
    lineCap: stroke.lineCap,
    lineJoin: "round",
    globalCompositeOperation:
      stroke.tool === "eraser" ? "destination-out" : "source-over",
    listening: false,
  });
}

function updateState() {
  strokeOutput.textContent = String(strokes.length);
  pointOutput.textContent = String(
    strokes.reduce((total, stroke) => total + stroke.points.length / 2, 0),
  );
  undoButton.disabled = strokes.length === 0;
  redoButton.disabled = redoStrokes.length === 0;
  saveButton.disabled = strokes.length === 0;
  restoreButton.disabled = savedStrokes.length === 0;
  clearButton.disabled = strokes.length === 0;
  exportPngButton.disabled = strokes.length === 0;
  exportSvgButton.disabled = strokes.length === 0;
}

function render() {
  layer.destroyChildren();
  strokes.forEach((stroke) => layer.add(lineFor(stroke)));
  layer.batchDraw();
  updateState();
}

function markUnsaved() {
  saveOutput.textContent = "Unsaved changes";
}

function currentWidth() {
  const selected = Number(brushInput.value);
  if (activeTool === "eraser") return Math.max(selected, 24);
  return Math.max(1, selected * TOOL_STYLES[activeTool].scale);
}

toolButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeTool = button.dataset.canvasTool;
    toolButtons.forEach((candidate) => {
      const selected = candidate === button;
      candidate.classList.toggle("active-tool", selected);
      candidate.setAttribute("aria-pressed", String(selected));
    });
    colorInput.disabled = activeTool === "eraser";
    toolOutput.textContent = toolName(activeTool);
  });
});

brushInput.addEventListener("change", () => {
  brushOutput.textContent = `${brushInput.value} px`;
});

stage.on("mousedown touchstart", (event) => {
  if (event.evt.cancelable) event.evt.preventDefault();
  const position = stage.getPointerPosition();
  if (!position) return;
  drawing = true;
  redoStrokes = [];
  currentStroke = {
    tool: activeTool,
    color: activeTool === "eraser" ? "#000000" : colorInput.value,
    width: currentWidth(),
    opacity: TOOL_STYLES[activeTool].opacity,
    tension: TOOL_STYLES[activeTool].tension,
    lineCap: TOOL_STYLES[activeTool].lineCap,
    points: [position.x, position.y],
  };
  strokes.push(currentStroke);
  layer.add(lineFor(currentStroke));
  markUnsaved();
  updateState();
});

stage.on("mousemove touchmove", (event) => {
  if (!drawing || !currentStroke) return;
  if (event.evt.cancelable) event.evt.preventDefault();
  const position = stage.getPointerPosition();
  if (!position) return;
  currentStroke.points.push(position.x, position.y);
  layer.getChildren().at(-1).points(currentStroke.points);
  layer.batchDraw();
  updateState();
});

function stopDrawing() {
  if (!drawing) return;
  drawing = false;
  if (currentStroke?.points.length === 2) {
    currentStroke.points.push(
      currentStroke.points[0] + 0.01,
      currentStroke.points[1] + 0.01,
    );
  }
  currentStroke = undefined;
  updateState();
}

stage.on("mouseup touchend mouseleave", stopDrawing);

undoButton.addEventListener("click", () => {
  const stroke = strokes.pop();
  if (stroke) redoStrokes.push(stroke);
  markUnsaved();
  render();
});

redoButton.addEventListener("click", () => {
  const stroke = redoStrokes.pop();
  if (stroke) strokes.push(stroke);
  markUnsaved();
  render();
});

saveButton.addEventListener("click", () => {
  savedStrokes = copyStrokes(strokes);
  saveOutput.textContent = `Saved ${strokes.length} ${strokes.length === 1 ? "stroke" : "strokes"}`;
  updateState();
});

restoreButton.addEventListener("click", () => {
  strokes = copyStrokes(savedStrokes);
  redoStrokes = [];
  saveOutput.textContent = `Restored ${strokes.length} ${strokes.length === 1 ? "stroke" : "strokes"}`;
  render();
});

clearButton.addEventListener("click", () => {
  strokes = [];
  redoStrokes = [];
  saveOutput.textContent = "Cleared";
  render();
});

function download(href, filename) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

function drawGrid(context, width, height, pixelRatio) {
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#cbd5e1";
  for (let x = 19; x < width / pixelRatio; x += 20) {
    for (let y = 19; y < height / pixelRatio; y += 20) {
      context.beginPath();
      context.arc(x * pixelRatio, y * pixelRatio, pixelRatio, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function exportPng() {
  const pixelRatio = 2;
  const output = document.createElement("canvas");
  output.width = Math.round(stage.width() * pixelRatio);
  output.height = Math.round(stage.height() * pixelRatio);
  const context = output.getContext("2d");
  drawGrid(context, output.width, output.height, pixelRatio);
  context.drawImage(stage.toCanvas({ pixelRatio }), 0, 0);
  const dataUrl = output.toDataURL("image/png");
  download(dataUrl, "villa-review.png");
  exportOutput.textContent = "Exported PNG";
}

function number(value) {
  return Number(value.toFixed(2));
}

function pathData(stroke) {
  const pairs = [];
  for (let index = 0; index < stroke.points.length; index += 2) {
    pairs.push(
      `${number(stroke.points[index])} ${number(stroke.points[index + 1])}`,
    );
  }
  return pairs
    .map((pair, index) => `${index === 0 ? "M" : "L"} ${pair}`)
    .join(" ");
}

function pathElement(stroke, index, color = stroke.color) {
  return [
    `<path data-stroke-index="${index}" data-tool="${stroke.tool}"`,
    `d="${pathData(stroke)}" fill="none" stroke="${color}"`,
    `stroke-width="${number(stroke.width)}" stroke-opacity="${stroke.opacity}"`,
    `stroke-linecap="${stroke.lineCap}" stroke-linejoin="round" />`,
  ].join(" ");
}

function svgSource() {
  const width = Math.round(stage.width());
  const height = Math.round(stage.height());
  const drawing = strokes
    .map((stroke, index) => ({ stroke, index }))
    .filter(({ stroke }) => stroke.tool !== "eraser")
    .map(({ stroke, index }) => pathElement(stroke, index))
    .join("");
  const erasers = strokes
    .map((stroke, index) => ({ stroke, index }))
    .filter(({ stroke }) => stroke.tool === "eraser")
    .map(({ stroke, index }) => pathElement(stroke, index, "#000000"))
    .join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-strokes="${strokes.length}">`,
    "<title>Ego Browser Lab whiteboard export</title>",
    "<desc>Editable vector strokes drawn on the review canvas.</desc>",
    '<defs><pattern id="dot-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="19" cy="19" r="1" fill="#cbd5e1" /></pattern>',
    `<mask id="eraser-mask"><rect width="${width}" height="${height}" fill="#ffffff" />${erasers}</mask></defs>`,
    `<rect width="${width}" height="${height}" fill="#ffffff" />`,
    `<rect width="${width}" height="${height}" fill="url(#dot-grid)" />`,
    `<g id="drawing" mask="url(#eraser-mask)">${drawing}</g>`,
    "</svg>",
  ].join("");
}

function exportSvg() {
  const source = svgSource();
  download(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`,
    "villa-review.svg",
  );
  exportOutput.textContent = "Exported SVG";
}

exportPngButton.addEventListener("click", exportPng);
exportSvgButton.addEventListener("click", exportSvg);

new ResizeObserver(() => {
  stage.width(container.clientWidth);
  stage.height(container.clientHeight);
  layer.batchDraw();
}).observe(container);

updateState();
