const clickTarget = document.querySelector("#click-target");
const contextTarget = document.querySelector("#context-target");
const clickCount = document.querySelector('[data-testid="click-count"]');
const doubleClickCount = document.querySelector(
  '[data-testid="double-click-count"]',
);
const rightClickCount = document.querySelector(
  '[data-testid="right-click-count"]',
);

let clicks = 0;
let doubles = 0;
let rightClicks = 0;

clickTarget.addEventListener("click", () => {
  clickCount.textContent = String(++clicks);
});
clickTarget.addEventListener("dblclick", () => {
  doubleClickCount.textContent = String(++doubles);
});
contextTarget.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  rightClickCount.textContent = String(++rightClicks);
});
