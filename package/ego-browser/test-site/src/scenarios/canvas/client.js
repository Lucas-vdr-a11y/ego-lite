const canvas = document.querySelector("#draw-canvas");
const context = canvas.getContext("2d");
const strokeOutput = document.querySelector('[data-testid="canvas-strokes"]');
const pointOutput = document.querySelector('[data-testid="canvas-points"]');

let drawing = false;
let lastPoint;
let strokes = 0;
let points = 0;

function pointFor(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * canvas.width) / rect.width,
    y: ((event.clientY - rect.top) * canvas.height) / rect.height,
  };
}

canvas.addEventListener("mousedown", (event) => {
  drawing = true;
  lastPoint = pointFor(event);
  strokeOutput.textContent = String(++strokes);
  pointOutput.textContent = String(++points);
});
canvas.addEventListener("mousemove", (event) => {
  if (!drawing) return;
  const next = pointFor(event);
  context.strokeStyle = "#ff5c35";
  context.lineWidth = 8;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(lastPoint.x, lastPoint.y);
  context.lineTo(next.x, next.y);
  context.stroke();
  lastPoint = next;
  pointOutput.textContent = String(++points);
});

function stopDrawing() {
  drawing = false;
  lastPoint = undefined;
}

canvas.addEventListener("mouseup", stopDrawing);
canvas.addEventListener("mouseleave", stopDrawing);
document.querySelector("#clear-canvas").addEventListener("click", () => {
  context.clearRect(0, 0, canvas.width, canvas.height);
  strokes = 0;
  points = 0;
  strokeOutput.textContent = "0";
  pointOutput.textContent = "0";
});
