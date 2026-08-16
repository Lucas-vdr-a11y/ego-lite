const reviewedZones = new Set();
const confirmedDocuments = new Set();
const approveMedia = document.querySelector("[data-approve-media]");
const audioBriefing = document.querySelector("#dispatcher-audio");
const videoBriefing = document.querySelector("#loading-video");
const zoneStatus = document.querySelector('[data-testid="zone-review-status"]');
const audioStatus = document.querySelector(
  '[data-testid="audio-review-status"]',
);
const videoStatus = document.querySelector(
  '[data-testid="video-review-status"]',
);
const embedStatus = document.querySelector(
  '[data-testid="embed-review-status"]',
);
const reviewStatus = document.querySelector(
  '[data-testid="media-review-status"]',
);

let audioPlayed = false;
let videoPlayed = false;
let approved = false;

function renderReviewState() {
  zoneStatus.textContent = `${reviewedZones.size} of 2 venue zones reviewed`;
  audioStatus.textContent = audioPlayed
    ? "Audio briefing played"
    : "Audio briefing pending";
  videoStatus.textContent = videoPlayed
    ? "Video briefing played"
    : "Video briefing pending";
  embedStatus.textContent = `${confirmedDocuments.size} of 3 documents confirmed`;

  const complete =
    reviewedZones.size === 2 &&
    audioPlayed &&
    videoPlayed &&
    confirmedDocuments.size === 3;
  approveMedia.disabled = approved || !complete;
}

function recordCurrentZone() {
  const zone = window.location.hash.slice(1);
  if (zone === "stage-zone" || zone === "loading-zone") {
    reviewedZones.add(zone);
  }
  renderReviewState();
}

window.addEventListener("hashchange", recordCurrentZone);
window.addEventListener("message", (event) => {
  if (
    event.origin !== window.location.origin ||
    event.data?.type !== "media-document-confirmed"
  ) {
    return;
  }
  confirmedDocuments.add(event.data.document);
  renderReviewState();
});

audioBriefing.addEventListener("play", () => {
  audioPlayed = true;
  renderReviewState();
});
videoBriefing.addEventListener("play", () => {
  videoPlayed = true;
  renderReviewState();
});
approveMedia.addEventListener("click", () => {
  if (approveMedia.disabled || approved) return;
  approved = true;
  reviewStatus.textContent = "Venue media approved for the APAC launch.";
  renderReviewState();
});

recordCurrentZone();
