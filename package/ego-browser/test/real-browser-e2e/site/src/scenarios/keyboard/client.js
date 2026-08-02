const input = document.querySelector("#keyboard-input");
const rich = document.querySelector("#rich-editor");
const valueOutput = document.querySelector('[data-testid="keyboard-value"]');
const richOutput = document.querySelector('[data-testid="rich-value"]');
const keyOutput = document.querySelector('[data-testid="key-log"]');
const keys = [];

input.addEventListener("input", () => {
  valueOutput.textContent = input.value;
});
input.addEventListener("keydown", (event) => {
  keys.push(event.key);
  keyOutput.textContent = keys.join(" · ");
});
rich.addEventListener("input", () => {
  richOutput.textContent = rich.textContent || "—";
});
