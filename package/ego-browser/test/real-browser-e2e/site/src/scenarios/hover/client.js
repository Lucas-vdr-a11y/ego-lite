const state = document.querySelector('[data-testid="hover-state"]');
const entries = document.querySelector('[data-testid="hover-entries"]');
const moves = document.querySelector('[data-testid="hover-moves"]');
const selection = document.querySelector('[data-testid="hover-selection"]');
const preview = document.querySelector('[data-testid="hover-preview"]');
const finish = document.querySelector('[data-testid="material-finish"]');
const durability = document.querySelector(
  '[data-testid="material-durability"]',
);
const leadTime = document.querySelector('[data-testid="material-lead-time"]');
const comparison = document.querySelector(
  '[data-testid="material-comparison"]',
);
const materials = Array.from(document.querySelectorAll("[data-material-id]"));
const pinned = new Set();

let entryCount = 0;
let moveCount = 0;

function previewMaterial(material) {
  preview.textContent = `${material.dataset.materialName} · ${material.dataset.materialId}`;
  finish.textContent = material.dataset.materialFinish;
  durability.textContent = material.dataset.materialDurability;
  leadTime.textContent = material.dataset.materialLeadTime;
}

function renderPinned() {
  const names = materials
    .filter((material) => pinned.has(material.dataset.materialId))
    .map((material) => material.dataset.materialName);
  if (names.length === 0) selection.textContent = "None";
  else if (names.length === 1) selection.textContent = `${names[0]} pinned`;
  else selection.textContent = `${names.length} materials pinned`;
  comparison.textContent = names.length
    ? names.join(" · ")
    : "No materials pinned";
}

materials.forEach((material) => {
  material.addEventListener("mouseenter", () => {
    material.classList.add("is-hovered");
    previewMaterial(material);
    state.textContent = "inside";
    entries.textContent = String(++entryCount);
  });
  material.addEventListener("mousemove", () => {
    moves.textContent = String(++moveCount);
  });
  material.addEventListener("mouseleave", () => {
    material.classList.remove("is-hovered");
    state.textContent = "outside";
  });
  material.addEventListener("focus", () => {
    material.classList.add("is-hovered");
    previewMaterial(material);
  });
  material.addEventListener("blur", () =>
    material.classList.remove("is-hovered"),
  );
});

document.querySelectorAll("[data-pin-material]").forEach((pin) => {
  pin.addEventListener("click", () => {
    const pressed = pin.getAttribute("aria-pressed") !== "true";
    pin.setAttribute("aria-pressed", String(pressed));
    const material = pin.closest("[data-material-name]");
    if (pressed) pinned.add(material.dataset.materialId);
    else pinned.delete(material.dataset.materialId);
    renderPinned();
  });
});
