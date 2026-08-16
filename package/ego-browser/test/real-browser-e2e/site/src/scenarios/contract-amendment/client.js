const amendment = document.querySelector(".contract-amendment");
const acceptAmendment = amendment.querySelector("[data-accept-amendment]");
const historyAction = amendment.querySelector("[data-amendment-history]");
const reviewStatus = amendment.querySelector(
  '[data-testid="amendment-review-status"]',
);

acceptAmendment.addEventListener("click", () => {
  amendment.dataset.amendmentState = "accepted";
  acceptAmendment.disabled = true;
  historyAction.disabled = false;
  historyAction.textContent = "Undo acceptance";
  reviewStatus.textContent =
    "Acceptance recorded for CR-482. The 30-minute clause is approved.";
});

historyAction.addEventListener("click", () => {
  if (amendment.dataset.amendmentState === "accepted") {
    amendment.dataset.amendmentState = "pending";
    acceptAmendment.disabled = false;
    historyAction.textContent = "Restore acceptance";
    reviewStatus.textContent = "Acceptance withdrawn; CR-482 is pending again.";
    return;
  }

  amendment.dataset.amendmentState = "accepted";
  acceptAmendment.disabled = true;
  historyAction.textContent = "Undo acceptance";
  reviewStatus.textContent =
    "Acceptance restored for CR-482. The 30-minute clause is approved.";
});
