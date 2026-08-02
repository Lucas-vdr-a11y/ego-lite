const target = document.querySelector("#hover-target");
const state = document.querySelector('[data-testid="hover-state"]');
const entries = document.querySelector('[data-testid="hover-entries"]');
const moves = document.querySelector('[data-testid="hover-moves"]');

let entryCount = 0;
let moveCount = 0;

target.addEventListener("mouseenter", () => {
  target.classList.add("is-hovered");
  target.querySelector(".hover-reveal span").textContent =
    "VIEWING SPECIFICATION";
  state.textContent = "inside";
  entries.textContent = String(++entryCount);
});
target.addEventListener("mousemove", () => {
  moves.textContent = String(++moveCount);
});
target.addEventListener("mouseleave", () => {
  target.classList.remove("is-hovered");
  target.querySelector(".hover-reveal span").textContent = "VIEW SPECIFICATION";
  state.textContent = "outside";
});
