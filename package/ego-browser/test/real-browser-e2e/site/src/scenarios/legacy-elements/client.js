const surface = document.querySelector(".legacy-elements");
const reviewManifest = surface.querySelector("[data-review-legacy-manifest]");
const approveManifest = surface.querySelector("[data-approve-legacy-manifest]");
const reviewStatus = surface.querySelector(
  '[data-testid="legacy-manifest-status"]',
);

reviewManifest.addEventListener("click", (event) => {
  if (!event.isTrusted) return;
  surface.dataset.compatibilityState = "reviewed";
  surface.dataset.reviewInput = event.detail === 0 ? "keyboard" : "pointer";
  approveManifest.disabled = false;
  reviewStatus.textContent =
    "Legacy manifest SUP-208 reviewed; approval is now available.";
});

approveManifest.addEventListener("click", (event) => {
  if (!event.isTrusted) return;
  surface.dataset.compatibilityState = "approved";
  surface.dataset.approvalInput = event.detail === 0 ? "keyboard" : "pointer";
  approveManifest.disabled = true;
  reviewStatus.textContent =
    "Legacy manifest SUP-208 approved for the Shanghai compatibility queue.";
});
