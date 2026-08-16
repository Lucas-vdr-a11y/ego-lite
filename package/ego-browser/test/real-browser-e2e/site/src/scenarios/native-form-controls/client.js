const form = document.querySelector("#cross-border-release-review");
const status = document.querySelector('[data-testid="native-review-status"]');
const formDataOutput = document.querySelector(
  '[data-testid="native-form-data"]',
);
const reviewProgress = document.querySelector("#review-progress");
const riskBuffer = document.querySelector("#risk-buffer");
const requiredControlIds = [
  "release-reference",
  "launch-city",
  "primary-market",
  "release-template",
  "review-notes",
];
const reviewedControlIds = new Set();

function controlLabel(control) {
  const label = control.id
    ? document.querySelector(`label[for="${control.id}"]`)
    : undefined;
  return label?.textContent.trim() || control.name || "review field";
}

function updateReadiness(control) {
  if (requiredControlIds.includes(control.id)) {
    reviewedControlIds.add(control.id);
  }
  reviewProgress.value = requiredControlIds.filter((id) => {
    const candidate = document.querySelector(`#${id}`);
    return reviewedControlIds.has(id) && candidate.validity.valid;
  }).length;
  reviewProgress.textContent = `${reviewProgress.value} of ${reviewProgress.max} checks`;
  if (control.id === "primary-market") {
    riskBuffer.value = control.value === "cn-shanghai" ? 72 : 35;
    riskBuffer.textContent = `${riskBuffer.value} percent`;
  }
}

form.addEventListener(
  "invalid",
  (event) => {
    status.textContent = `Native validation blocked on ${controlLabel(event.target)}.`;
  },
  true,
);

form.addEventListener("input", (event) => {
  updateReadiness(event.target);
  status.textContent = "Draft changed; native validation pending.";
});

form.addEventListener("change", (event) => {
  updateReadiness(event.target);
  status.textContent = `${controlLabel(event.target)} updated; native validation pending.`;
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  for (const id of requiredControlIds) reviewedControlIds.add(id);
  updateReadiness(event.submitter);
  const submitted = Object.fromEntries(new FormData(form));
  formDataOutput.textContent = JSON.stringify(submitted);
  status.textContent = `${submitted.releaseReference} is ready for ${submitted.launchCity}.`;
});
