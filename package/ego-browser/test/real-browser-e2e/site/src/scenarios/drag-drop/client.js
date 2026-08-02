let mousePressed = false;
const mouseSource = document.querySelector("#mouse-drag-source");
const mouseTarget = document.querySelector("#mouse-drag-target");
const htmlSource = document.querySelector("#html-drag-source");
const htmlTarget = document.querySelector("#html-drop-target");

mouseSource.addEventListener("mousedown", () => {
  mousePressed = true;
});
mouseSource.addEventListener("mouseup", () => {
  mousePressed = false;
});
mouseTarget.addEventListener("mouseup", () => {
  if (mousePressed) {
    document.querySelector('[data-testid="mouse-drag-status"]').textContent =
      "Card moved to review";
  }
  mousePressed = false;
});
htmlSource.addEventListener("dragstart", (event) => {
  event.dataTransfer.setData("text/plain", "ego-payload");
});
htmlTarget.addEventListener("dragover", (event) => {
  event.preventDefault();
});
htmlTarget.addEventListener("drop", (event) => {
  event.preventDefault();
  document.querySelector('[data-testid="html-drop-status"]').textContent =
    event.dataTransfer.getData("text/plain");
});
