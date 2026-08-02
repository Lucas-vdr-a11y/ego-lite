const actor = document.querySelector("#review-actor");
const reviewer = document.querySelector("#lead-reviewer");
const dueDate = document.querySelector("#review-due-date");
const assign = document.querySelector("#assign-review");
const severity = document.querySelector("#finding-severity");
const finding = document.querySelector("#review-finding");
const addFinding = document.querySelector("#add-finding");
const requestChanges = document.querySelector("#request-changes");
const resolveFindings = document.querySelector("#resolve-findings");
const approve = document.querySelector("#approve-review");
const status = document.querySelector('[data-testid="review-status"]');
const result = document.querySelector('[data-testid="review-result"]');
const findingCount = document.querySelector('[data-testid="finding-count"]');
const findingList = document.querySelector("#review-findings");
const auditLog = document.querySelector("#review-audit-log");

const state = { stage: "draft", findings: [], reviewer: "" };

const stageLabels = {
  draft: "Draft",
  review: "In review",
  changes: "Changes requested",
  ready: "Ready for approval",
  approved: "Approved",
};

function audit(message) {
  const item = document.createElement("li");
  item.textContent = message;
  auditLog.append(item);
}

function render() {
  status.textContent = stageLabels[state.stage];
  document.querySelectorAll("[data-review-stage]").forEach((step) => {
    const stage = step.dataset.reviewStage;
    const activeStage =
      state.stage === "ready"
        ? "changes"
        : state.stage === "review"
          ? "review"
          : state.stage;
    step.dataset.state = stage === activeStage ? "current" : "pending";
    if (
      (stage === "draft" && state.stage !== "draft") ||
      (stage === "review" &&
        ["changes", "ready", "approved"].includes(state.stage)) ||
      (stage === "changes" && ["ready", "approved"].includes(state.stage))
    ) {
      step.dataset.state = "complete";
    }
  });

  const isCoordinator = actor.value === "coordinator";
  const isReviewer = actor.value === "reviewer";
  const isAuthor = actor.value === "author";
  assign.disabled =
    !isCoordinator || state.stage !== "draft" || !reviewer.value;
  addFinding.disabled = !isReviewer || state.stage !== "review";
  requestChanges.disabled =
    !isReviewer || state.stage !== "review" || state.findings.length === 0;
  resolveFindings.disabled = !isAuthor || state.stage !== "changes";
  approve.disabled = !isReviewer || state.stage !== "ready";
  findingCount.textContent = `${state.findings.filter((item) => !item.resolved).length} open`;

  findingList.replaceChildren();
  if (state.findings.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-finding";
    empty.textContent = "No findings recorded";
    findingList.append(empty);
  } else {
    for (const item of state.findings) {
      const row = document.createElement("li");
      row.dataset.state = item.resolved ? "resolved" : "open";
      const badge = document.createElement("strong");
      badge.textContent = item.severity;
      const copy = document.createElement("span");
      copy.textContent = item.text;
      row.append(badge, copy);
      findingList.append(row);
    }
  }
}

actor.addEventListener("change", render);
reviewer.addEventListener("change", render);

assign.addEventListener("click", () => {
  state.stage = "review";
  state.reviewer = reviewer.value;
  result.textContent = `${state.reviewer} assigned through ${dueDate.value}`;
  audit(`Review assigned to ${state.reviewer}`);
  render();
});

addFinding.addEventListener("click", () => {
  const text = finding.value.trim();
  if (!text) {
    result.textContent = "Describe the finding before adding it";
    finding.focus();
    return;
  }
  state.findings.push({ severity: severity.value, text, resolved: false });
  finding.value = "";
  result.textContent = `${severity.value} finding added`;
  audit(`${state.reviewer} added a ${severity.value.toLowerCase()} finding`);
  render();
});

requestChanges.addEventListener("click", () => {
  state.stage = "changes";
  result.textContent = "Changes requested from Mei Lin";
  audit(`${state.reviewer} requested author changes`);
  render();
});

resolveFindings.addEventListener("click", () => {
  state.findings.forEach((item) => {
    item.resolved = true;
  });
  state.stage = "ready";
  result.textContent = "All findings resolved; review returned to Aisha Rahman";
  audit("Mei Lin resolved all findings");
  render();
});

approve.addEventListener("click", () => {
  state.stage = "approved";
  result.textContent = `Review approved by ${state.reviewer}`;
  audit(`${state.reviewer} approved the review`);
  render();
});

render();
