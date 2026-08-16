const points = Array.from(document.querySelectorAll("[data-forecast-week]"));
const formula = document.querySelector("math");
const formulaDemand = document.querySelector('[data-testid="formula-demand"]');
const formulaBuffer = document.querySelector('[data-testid="formula-buffer"]');
const formulaResult = document.querySelector('[data-testid="formula-result"]');
const selectedWeekOutput = document.querySelector(
  '[data-testid="selected-forecast-week"]',
);
const selectedDemandOutput = document.querySelector(
  '[data-testid="selected-forecast-demand"]',
);
const form = document.querySelector("[data-capacity-form]");
const bufferInput = document.querySelector("#capacity-buffer");
const formStatus = document.querySelector(
  '[data-testid="capacity-form-status"]',
);
const riskButton = document.querySelector("[data-capacity-risk-action]");
const riskStatus = document.querySelector(
  '[data-testid="capacity-risk-status"]',
);
const resetButton = document.querySelector("[data-capacity-reset]");

let selectedWeek = 2;
let appliedBuffer = 10;
let riskAcknowledged = false;

function selectedPoint() {
  return points.find(
    (point) => Number(point.dataset.forecastWeek) === selectedWeek,
  );
}

function requiredCapacity(demand, buffer) {
  return Math.ceil(demand * (1 + buffer / 100));
}

function renderFormula() {
  const demand = Number(selectedPoint().dataset.forecastDemand);
  const result = requiredCapacity(demand, appliedBuffer);
  formulaDemand.textContent = String(demand);
  formulaBuffer.textContent = String(appliedBuffer);
  formulaResult.textContent = String(result);
  formula.setAttribute(
    "aria-label",
    `Capacity formula: ${demand} shipments times one plus ${appliedBuffer} percent buffer equals ${result} shipments`,
  );
  return result;
}

function renderSelection() {
  const point = selectedPoint();
  const demand = Number(point.dataset.forecastDemand);
  for (const candidate of points) {
    const selected = candidate === point;
    candidate.setAttribute("aria-pressed", String(selected));
    candidate.classList.toggle("is-selected", selected);
  }
  selectedWeekOutput.textContent = `Week ${selectedWeek}`;
  selectedDemandOutput.textContent = `${demand} shipments`;
  return renderFormula();
}

function selectForecast(point) {
  selectedWeek = Number(point.dataset.forecastWeek);
  renderSelection();
}

for (const point of points) {
  point.addEventListener("click", () => selectForecast(point));
  point.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectForecast(point);
  });
}

riskButton.addEventListener("click", () => {
  riskAcknowledged = !riskAcknowledged;
  riskButton.setAttribute("aria-pressed", String(riskAcknowledged));
  riskStatus.textContent = riskAcknowledged
    ? "Week 4 capacity risk acknowledged"
    : "Risk not reviewed";
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const nextBuffer = Number(bufferInput.value);
  if (!Number.isFinite(nextBuffer) || nextBuffer < 0 || nextBuffer > 50) {
    bufferInput.setAttribute("aria-invalid", "true");
    formStatus.textContent = "Enter a buffer from 0% to 50%";
    return;
  }

  bufferInput.removeAttribute("aria-invalid");
  appliedBuffer = nextBuffer;
  const result = renderFormula();
  formStatus.textContent = `Required capacity updated to ${result} shipments`;
});

resetButton.addEventListener("click", () => {
  selectedWeek = 2;
  appliedBuffer = 10;
  riskAcknowledged = false;
  bufferInput.value = "10";
  bufferInput.removeAttribute("aria-invalid");
  riskButton.setAttribute("aria-pressed", "false");
  riskStatus.textContent = "Risk not reviewed";
  formStatus.textContent = "Reviewing Week 2 at 10% buffer";
  renderSelection();
});

renderSelection();
