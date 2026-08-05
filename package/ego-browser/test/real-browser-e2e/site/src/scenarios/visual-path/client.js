import {
  ALL_TARGETS,
  CANVAS_INK,
  CANVAS_PAPER,
  swatchColor,
  targetById,
} from "./targets.mjs";

const canvas = document.querySelector("#visual-canvas");
const context = canvas.getContext("2d");
const out = (name) => document.querySelector(`[data-testid="${name}"]`);
const targetsDone = out("visual-targets-done");
const clickCount = out("visual-click-count");
const missCount = out("visual-miss-count");
const strokeCount = out("visual-canvas-strokes");
const lastClick = out("visual-last-click");
const viewportReadout = out("visual-viewport");

const marks = document.createElement("div");
marks.className = "visual-marks";
marks.dataset.testid = "visual-marks";
document.body.append(marks);

let clicks = 0;
let misses = 0;
let strokes = 0;

function paintCanvas() {
  context.fillStyle = swatchColor(CANVAS_PAPER);
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function render() {
  const done = document.querySelectorAll('[data-state="done"]').length;
  targetsDone.textContent = `${done} / ${ALL_TARGETS.length}`;
  clickCount.textContent = String(clicks);
  missCount.textContent = String(misses);
  strokeCount.textContent = String(strokes);
  viewportReadout.textContent = `${innerWidth}×${innerHeight} · dpr ${devicePixelRatio}`;
}

function addMark(pageX, pageY, hit) {
  const mark = document.createElement("div");
  mark.className = "visual-mark";
  mark.style.left = `${pageX}px`;
  mark.style.top = `${pageY}px`;
  mark.innerHTML = `
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="13" cy="13" r="11" fill="none" stroke="#e5241a" stroke-width="2"
              ${hit ? "" : 'stroke-dasharray="3 3"'} />
      <path d="M13 5v6M13 15v6M5 13h6M15 13h6" stroke="#e5241a" stroke-width="2" />
    </svg>
    <span class="visual-mark-index">${clicks}</span>`;
  marks.append(mark);
}

document.addEventListener(
  "click",
  (event) => {
    if (event.target.closest("#reset-visual")) return;
    if (!event.target.closest(".visual-path-layout")) return;
    clicks += 1;
    const swatch = event.target.closest("[data-target-id]");
    let hit = null;
    if (swatch) {
      hit = swatch.dataset.targetId;
      const target = targetById(hit);
      swatch.dataset.state = "done";
      swatch.style.background = swatchColor(target.done);
    } else if (event.target === canvas) {
      hit = "canvas";
    } else {
      misses += 1;
    }
    addMark(event.pageX, event.pageY, hit);
    lastClick.textContent = `${event.clientX},${event.clientY} ${hit || "miss"}`;
    render();
  },
  true,
);

let drawing = false;
canvas.addEventListener("pointerdown", (event) => {
  drawing = true;
  strokes += 1;
  context.strokeStyle = swatchColor(CANVAS_INK);
  context.lineWidth = 4;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(event.offsetX, event.offsetY);
  render();
});
canvas.addEventListener("pointermove", (event) => {
  if (!drawing) return;
  context.lineTo(event.offsetX, event.offsetY);
  context.stroke();
});
addEventListener("pointerup", () => {
  drawing = false;
});

document.querySelector("#reset-visual").addEventListener("click", () => {
  marks.replaceChildren();
  paintCanvas();
  for (const target of ALL_TARGETS) {
    const swatch = document.querySelector(`#swatch-${target.id}`);
    swatch.dataset.state = "pending";
    swatch.style.background = swatchColor(target.pending);
  }
  clicks = 0;
  misses = 0;
  strokes = 0;
  lastClick.textContent = "No click yet";
  render();
});

addEventListener("resize", render);
paintCanvas();
render();
