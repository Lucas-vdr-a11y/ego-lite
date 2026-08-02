function bind(
  selector,
  output,
  event = "input",
  value = (element) => element.value || "—",
) {
  document
    .querySelector(selector)
    .addEventListener(event, ({ currentTarget }) => {
      document.querySelector(`[data-testid="${output}"]`).textContent = String(
        value(currentTarget),
      );
    });
}

bind("#text-input", "form-text");
bind("#notes-input", "form-notes");
bind("#priority-select", "form-priority", "change");
bind(
  "#approval-checkbox",
  "form-approved",
  "change",
  (element) => element.checked,
);

document.querySelectorAll('input[name="plan"]').forEach((input) => {
  input.addEventListener("change", (event) => {
    if (event.target.checked) {
      document.querySelector('[data-testid="form-plan"]').textContent =
        event.target.value;
    }
  });
});

document.querySelector("#toggle-dynamic").addEventListener("click", () => {
  const slot = document.querySelector("#dynamic-slot");
  const existing = document.querySelector("#dynamic-node");
  if (existing) {
    existing.remove();
    return;
  }
  const node = document.createElement("strong");
  node.id = "dynamic-node";
  node.textContent = "Stakeholder: Mei Lin · Product";
  slot.append(node);
});
