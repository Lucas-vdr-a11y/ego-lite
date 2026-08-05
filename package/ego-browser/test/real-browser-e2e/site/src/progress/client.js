const validStatuses = new Set(["in-progress", "completed", "failed"]);
let progress = {};

function normalizeProgress(candidate) {
  if (!candidate || typeof candidate !== "object") return {};
  return Object.fromEntries(
    Object.entries(candidate).filter(([, status]) => validStatuses.has(status)),
  );
}

function statusLabel(status) {
  if (status === "in-progress") return "In progress";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  return "Not started";
}

function renderSummary() {
  const root = document.querySelector('[data-testid="test-progress-summary"]');
  if (!root) return;

  const completed = Object.values(progress).filter(
    (status) => status === "completed",
  ).length;
  root.querySelector("[data-progress-completed]").textContent =
    String(completed);
  root
    .querySelector('[role="progressbar"]')
    .setAttribute("aria-valuenow", String(completed));

  root.querySelectorAll("[data-progress-dot]").forEach((dot) => {
    const status = progress[dot.dataset.progressSlug] || "not-started";
    const label = `${dot.dataset.progressSlug}: ${statusLabel(status)}`;
    dot.dataset.state = status;
    dot.title = label;
    dot.querySelector("[data-dot-label]").textContent = label;
  });
}

function renderControls(root) {
  const status = progress[root.dataset.testSlug];
  const start = root.querySelector('[data-testid="start-test"]');
  const finish = root.querySelector('[data-testid="finish-test"]');
  const fail = root.querySelector('[data-testid="fail-test"]');

  root.dataset.testStatus = status || "not-started";
  root.querySelector('[data-testid="test-status"]').textContent =
    statusLabel(status);
  start.textContent =
    status === "completed" || status === "failed"
      ? "Restart test"
      : "Start test";
  start.disabled = status === "in-progress";
  finish.disabled = status !== "in-progress";
  fail.disabled = status !== "in-progress";
}

function render() {
  renderSummary();
  document
    .querySelectorAll("[data-test-progress-controls]")
    .forEach(renderControls);
}

async function updateProgress(slug, status) {
  const previous = progress;
  document.documentElement.dataset.progressSync = "pending";
  progress = { ...progress, [slug]: status };
  render();

  try {
    const response = await fetch(
      `/api/test-progress/${encodeURIComponent(slug)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      },
    );
    if (!response.ok)
      throw new Error(`Progress update failed: ${response.status}`);
    const payload = await response.json();
    progress = normalizeProgress(payload.progress);
    render();
  } catch (error) {
    progress = previous;
    render();
    console.error(error);
  } finally {
    document.documentElement.dataset.progressSync = "idle";
  }
}

document.querySelectorAll("[data-test-progress-controls]").forEach((root) => {
  const slug = root.dataset.testSlug;
  root
    .querySelector('[data-testid="start-test"]')
    .addEventListener("click", () => updateProgress(slug, "in-progress"));
  root
    .querySelector('[data-testid="finish-test"]')
    .addEventListener("click", () => updateProgress(slug, "completed"));
  root
    .querySelector('[data-testid="fail-test"]')
    .addEventListener("click", () => updateProgress(slug, "failed"));
});

function connectProgressChannel() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(
    `${protocol}//${location.host}/api/test-progress/events`,
  );
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    progress = normalizeProgress(payload.progress);
    render();
  });
  socket.addEventListener(
    "close",
    () => setTimeout(connectProgressChannel, 250),
    { once: true },
  );
}

connectProgressChannel();

document.documentElement.dataset.progressSync = "idle";
render();
