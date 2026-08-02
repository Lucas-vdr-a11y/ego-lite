const fileInput = document.querySelector("#file-input");
const clearFiles = document.querySelector("#clear-files");
const fileCount = document.querySelector('[data-testid="file-count"]');
const list = document.querySelector('[data-testid="file-list"]');
const fileBytes = document.querySelector('[data-testid="file-bytes"]');
const rejectedCount = document.querySelector(
  '[data-testid="rejected-file-count"]',
);
const deliverFiles = document.querySelector("#deliver-files");
const deliveryStatus = document.querySelector(
  '[data-testid="delivery-status"]',
);
const deliveredCount = document.querySelector(
  '[data-testid="delivered-file-count"]',
);
const acceptedExtensions = new Set(["txt", "md", "csv"]);
let selectionVersion = 0;

async function checksum(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function renderEmptyState() {
  fileCount.textContent = "0";
  list.textContent = "No files selected";
  fileBytes.textContent = "0";
  rejectedCount.textContent = "0";
  deliveredCount.textContent = "0";
  clearFiles.disabled = true;
  deliverFiles.disabled = true;
  deliveryStatus.textContent = "Awaiting files";
}

fileInput.addEventListener("change", async (event) => {
  const version = ++selectionVersion;
  const files = Array.from(event.target.files || []);
  const rejected = files.filter(
    (file) =>
      !acceptedExtensions.has(file.name.split(".").pop()?.toLowerCase()),
  );
  const accepted = files.filter((file) => !rejected.includes(file));
  fileCount.textContent = String(files.length);
  fileBytes.textContent = String(
    accepted.reduce((total, file) => total + file.size, 0),
  );
  rejectedCount.textContent = String(rejected.length);
  deliveredCount.textContent = "0";
  list.textContent = "";
  for (const file of files) {
    const row = document.createElement("p");
    const name = document.createElement("strong");
    const meta = document.createElement("span");
    row.dataset.fileState = rejected.includes(file) ? "rejected" : "reviewing";
    name.textContent = file.name;
    meta.textContent = `${file.size} B · ${file.type || "unknown"}`;
    if (rejected.includes(file)) meta.textContent += " · unsupported type";
    row.append(name, meta);
    list.append(row);
    if (!rejected.includes(file)) {
      const digest = document.createElement("code");
      digest.textContent = " · calculating checksum…";
      meta.append(digest);
      const value = await checksum(file);
      if (version !== selectionVersion) return;
      digest.dataset.fileChecksum = "";
      digest.textContent = ` · sha256 ${value.slice(0, 12)}`;
      row.dataset.fileState = "ready";
    }
  }
  clearFiles.disabled = files.length === 0;
  deliverFiles.disabled = accepted.length === 0 || rejected.length > 0;
  deliveryStatus.textContent =
    rejected.length > 0 ? "Remove unsupported files" : "Ready to deliver";
});
clearFiles.addEventListener("click", () => {
  selectionVersion += 1;
  fileInput.value = "";
  renderEmptyState();
});
deliverFiles.addEventListener("click", () => {
  const rows = list.querySelectorAll('[data-file-state="ready"]');
  rows.forEach((row) => {
    row.dataset.fileState = "delivered";
  });
  deliveredCount.textContent = String(rows.length);
  deliveryStatus.textContent = `Delivered ${fileInput.files.length} ${fileInput.files.length === 1 ? "file" : "files"}`;
  deliverFiles.disabled = true;
});
