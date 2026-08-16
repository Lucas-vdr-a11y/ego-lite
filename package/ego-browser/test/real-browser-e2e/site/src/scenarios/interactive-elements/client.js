const shipmentTerms = document.querySelector('[data-testid="shipment-terms"]');
const detailsStatus = document.querySelector(
  '[data-testid="details-toggle-status"]',
);
const geolocation = document.querySelector(
  '[data-testid="dispatch-geolocation"]',
);
const geolocationStatus = document.querySelector(
  '[data-testid="geolocation-validation-status"]',
);
const manualLocationFallback = document.querySelector(
  "[data-manual-location-fallback]",
);
const openDispatchDialog = document.querySelector(
  "[data-open-dispatch-dialog]",
);
const dispatchDialog = document.querySelector("#dispatch-decision-dialog");
const dialogStatus = document.querySelector(
  '[data-testid="dialog-decision-status"]',
);

shipmentTerms.addEventListener("toggle", () => {
  const state = shipmentTerms.open ? "expanded" : "collapsed";
  detailsStatus.dataset.toggleState = state;
  detailsStatus.textContent = "Shipment terms " + state + ".";
});

const geolocationSupported =
  "HTMLGeolocationElement" in window &&
  geolocation instanceof HTMLGeolocationElement;
const validationHistory = [];

function currentValidationStatus() {
  if (!geolocationSupported) return "unsupported";
  if (geolocation.isValid) return "valid";
  return geolocation.invalidReason || "pending";
}

function recordValidationStatus() {
  const status = currentValidationStatus();
  if (validationHistory.at(-1) !== status) validationHistory.push(status);
  geolocationStatus.dataset.validationHistory = validationHistory.join(" ");
  geolocationStatus.textContent =
    status === "valid"
      ? "Native geolocation control is valid; permission has not been requested."
      : "Native geolocation validation: " + status + ".";
}

if (geolocationSupported) {
  geolocation.addEventListener(
    "validationstatuschange",
    recordValidationStatus,
  );
  recordValidationStatus();
} else {
  geolocationStatus.dataset.validationHistory = "unsupported";
  geolocationStatus.textContent =
    "Native geolocation control unavailable; choose the manual dispatch zone.";
}

manualLocationFallback.addEventListener("click", () => {
  geolocationStatus.dataset.manualLocation = "selected";
  geolocationStatus.textContent = "Manual dispatch zone selected.";
});

openDispatchDialog.addEventListener("click", () => {
  dispatchDialog.returnValue = "";
  dispatchDialog.showModal();
});

dispatchDialog.addEventListener("close", () => {
  if (dispatchDialog.returnValue === "confirmed") {
    dialogStatus.textContent = "Dispatch readiness confirmed.";
    return;
  }
  if (dispatchDialog.returnValue === "cancel") {
    dialogStatus.textContent = "Dispatch decision cancelled.";
    return;
  }
  dialogStatus.textContent = "Dispatch decision dismissed with Escape.";
});
