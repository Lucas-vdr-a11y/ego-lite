const input = document.querySelector("#keyboard-input");
const rich = document.querySelector("#rich-editor");
const valueOutput = document.querySelector('[data-testid="keyboard-value"]');
const richOutput = document.querySelector('[data-testid="rich-value"]');
const keyOutput = document.querySelector('[data-testid="key-log"]');
const keys = [];
const saveStatus = document.querySelector('[data-testid="save-status"]');
const wordCount = document.querySelector('[data-testid="word-count"]');
const storageKey = "ego-browser:editor-draft:v1";
const formatStatus = document.querySelector('[data-testid="format-status"]');

function countWords(value) {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function renderValues() {
  valueOutput.textContent = input.value || "—";
  richOutput.textContent = rich.textContent || "—";
  wordCount.textContent = String(countWords(rich.textContent || ""));
}

function saveDraft() {
  localStorage.setItem(
    storageKey,
    JSON.stringify({ title: input.value, bodyHtml: rich.innerHTML }),
  );
  saveStatus.textContent = "Saved locally";
}

try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
  if (
    saved &&
    typeof saved.title === "string" &&
    typeof saved.bodyHtml === "string"
  ) {
    input.value = saved.title;
    rich.innerHTML = saved.bodyHtml;
    saveStatus.textContent = "Restored local draft";
  }
} catch {
  localStorage.removeItem(storageKey);
}
renderValues();

function markUnsaved() {
  saveStatus.textContent = "Unsaved changes";
}

input.addEventListener("input", () => {
  renderValues();
  markUnsaved();
});
input.addEventListener("keydown", (event) => {
  keys.push(event.key);
  keyOutput.textContent = keys.join(" · ");
});
rich.addEventListener("input", () => {
  renderValues();
  markUnsaved();
});
document.querySelectorAll("[data-editor-command]").forEach((button) => {
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => {
    const labels = {
      bold: "Bold applied",
      italic: "Italic applied",
      insertUnorderedList: "Bulleted list applied",
    };
    rich.focus();
    document.execCommand(button.dataset.editorCommand);
    formatStatus.textContent = labels[button.dataset.editorCommand];
    renderValues();
    markUnsaved();
  });
});
document.querySelector("#save-draft").addEventListener("click", () => {
  saveDraft();
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveDraft();
  }
});
document.querySelector("#clear-draft").addEventListener("click", () => {
  localStorage.removeItem(storageKey);
  input.value = "seed";
  rich.textContent = "";
  keys.length = 0;
  keyOutput.textContent = "waiting";
  saveStatus.textContent = "Draft cleared";
  formatStatus.textContent = "None";
  renderValues();
  input.focus();
});
