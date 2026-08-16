const requiredSections = new Set(["terminology", "pronunciation"]);
const reviewedSections = new Set();
const approveRelease = document.querySelector("[data-approve-localization]");
const reviewStatus = document.querySelector(
  '[data-testid="localization-review-status"]',
);

let approved = false;

function renderReviewState() {
  if (approved) {
    reviewStatus.textContent =
      "Localized release approved for the Singapore launch.";
    return;
  }

  approveRelease.disabled = reviewedSections.size !== requiredSections.size;
  reviewStatus.textContent = `${reviewedSections.size} of ${requiredSections.size} proof sections reviewed`;
}

function recordCurrentSection() {
  const section = window.location.hash.slice(1);
  if (requiredSections.has(section)) reviewedSections.add(section);
  renderReviewState();
}

window.addEventListener("hashchange", recordCurrentSection);
approveRelease.addEventListener("click", () => {
  if (approveRelease.disabled || approved) return;
  approved = true;
  approveRelease.disabled = true;
  renderReviewState();
});

recordCurrentSection();
