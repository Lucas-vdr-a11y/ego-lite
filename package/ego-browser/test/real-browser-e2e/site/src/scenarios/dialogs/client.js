const result = document.querySelector('[data-testid="dialog-result"]');
const count = document.querySelector('[data-testid="dialog-count"]');
let completedDialogs = 0;
let noticePreviewed = false;
let approved = false;
let releaseName = "";
const publish = document.querySelector("#publish-release");
const workflowState = document.querySelector(
  '[data-testid="release-workflow-state"]',
);

function renderWorkflow() {
  document.querySelector('[data-testid="release-notice"]').textContent =
    noticePreviewed ? "Previewed" : "Not previewed";
  document.querySelector('[data-testid="release-approval"]').textContent =
    approved ? "Approved" : "Pending";
  document.querySelector('[data-testid="release-name"]').textContent =
    releaseName || "Not set";
  publish.disabled = !(noticePreviewed && approved && releaseName);
}

function record(value) {
  result.textContent = value;
  count.textContent = String(++completedDialogs);
}

document.querySelector("#alert-button").addEventListener("click", () => {
  alert("ego alert");
  noticePreviewed = true;
  renderWorkflow();
  record("alert closed");
});
document.querySelector("#confirm-button").addEventListener("click", () => {
  const accepted = confirm("approve ego test?");
  if (accepted) approved = true;
  renderWorkflow();
  record(accepted ? "confirmed" : "dismissed");
});
document.querySelector("#prompt-button").addEventListener("click", () => {
  const value = prompt("name this run", "ego");
  if (value?.trim()) releaseName = value.trim();
  renderWorkflow();
  record(value ?? "cancelled");
});
publish.addEventListener("click", () => {
  workflowState.textContent = `Published ${releaseName}`;
  result.textContent = `published ${releaseName}`;
  publish.disabled = true;
});
document.querySelector("#reset-dialogs").addEventListener("click", () => {
  completedDialogs = 0;
  count.textContent = "0";
  result.textContent = "waiting";
  noticePreviewed = false;
  approved = false;
  releaseName = "";
  workflowState.textContent = "READY TO PUBLISH";
  renderWorkflow();
});
renderWorkflow();
