const confirmEvidence = document.querySelector("[data-confirm-evidence]");
const completeHandoff = document.querySelector("[data-complete-handoff]");
const reviewStatus = document.querySelector(
  '[data-testid="incident-review-status"]',
);

let handoffComplete = false;

confirmEvidence.addEventListener("click", () => {
  if (handoffComplete) return;
  confirmEvidence.setAttribute("aria-pressed", "true");
  completeHandoff.disabled = false;
  reviewStatus.textContent =
    "Log evidence confirmed. Final handoff review is now available.";
});

completeHandoff.addEventListener("click", () => {
  handoffComplete = true;
  completeHandoff.setAttribute("aria-pressed", "true");
  completeHandoff.disabled = true;
  reviewStatus.textContent =
    "Handoff review complete. APAC Reliability retains overnight ownership.";
});
