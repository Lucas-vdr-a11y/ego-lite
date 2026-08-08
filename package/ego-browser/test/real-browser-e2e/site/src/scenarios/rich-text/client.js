import Quill from "quill";

const storageKey = "ego-browser:rich-text-article:v2";
const initialArticle = {
  title: "August release",
  status: "draft",
  html: "<h2>August release</h2><p>Prepare the regional launch note for reviewers.</p>",
};
const statusLabels = {
  draft: "Draft",
  review: "Ready for review",
  approved: "Approved",
};
const titleInput = document.querySelector("#article-title");
const statusSelect = document.querySelector("#article-status");
const wordCount = document.querySelector(
  '[data-testid="rich-text-word-count"]',
);
const saveState = document.querySelector(
  '[data-testid="rich-text-save-state"]',
);
const htmlOutput = document.querySelector('[data-testid="rich-text-html"]');
const preview = document.querySelector('[data-testid="article-preview"]');
const error = document.querySelector('[data-testid="rich-text-error"]');
const result = document.querySelector('[data-testid="rich-text-result"]');
const saveButton = document.querySelector("#save-rich-text");
const resetDialog = document.querySelector("#reset-article-dialog");

function readArticle() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (
      saved &&
      typeof saved.title === "string" &&
      typeof saved.html === "string"
    )
      return saved;
  } catch {}
  return { ...initialArticle };
}

const savedArticle = readArticle();
titleInput.value = savedArticle.title;
statusSelect.value = savedArticle.status;

const editor = new Quill("#rich-text-editor", {
  modules: {
    toolbar: {
      container: "#rich-text-toolbar",
      handlers: {
        undo() {
          this.quill.history.undo();
        },
        redo() {
          this.quill.history.redo();
        },
      },
    },
  },
  placeholder: "Write the release article…",
  theme: "snow",
});
editor.root.setAttribute("aria-label", "Rich text article");
editor.root.setAttribute("role", "textbox");

function labelQuillControls() {
  const toolbar = document.querySelector("#rich-text-toolbar");
  const colorPicker = toolbar.querySelector(".ql-color.ql-picker");
  colorPicker
    ?.querySelector(".ql-picker-label")
    ?.setAttribute("aria-label", "Text color");
  colorPicker?.querySelectorAll(".ql-picker-item").forEach((item) => {
    item.setAttribute("aria-label", item.dataset.label || "Default");
  });

  const tooltip = editor.container.querySelector(".ql-tooltip");
  tooltip?.querySelector("[data-link]")?.setAttribute("aria-label", "Link URL");
  const linkAction = tooltip?.querySelector(".ql-action");
  linkAction?.setAttribute("role", "button");
  linkAction?.setAttribute("tabindex", "0");
  const syncLinkAction = () => {
    const label = tooltip.classList.contains("ql-editing")
      ? "Apply link"
      : "Edit link";
    linkAction.textContent = label;
    linkAction.setAttribute("aria-label", label);
  };
  if (tooltip && linkAction) {
    new MutationObserver(syncLinkAction).observe(tooltip, {
      attributeFilter: ["class"],
      attributes: true,
    });
    linkAction.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      linkAction.click();
    });
    syncLinkAction();
  }
  tooltip
    ?.querySelector(".ql-remove")
    ?.setAttribute("aria-label", "Remove link");
}

labelQuillControls();
editor.clipboard.dangerouslyPasteHTML(savedArticle.html, "silent");
editor.history.clear();

function setDirty(dirty = true) {
  saveState.textContent = dirty ? "Unsaved changes" : "All changes saved";
  saveButton.disabled = !dirty;
}

function updatePressedStates() {
  // Quill's no-argument getFormat() defaults to getSelection(true), which
  // focuses the editor. Since render() runs on selection-change, that would
  // steal focus back from the link tooltip and make Quill hide it again.
  const range = editor.getSelection();
  if (!range) return;
  const formats = editor.getFormat(range);
  document
    .querySelectorAll("#rich-text-toolbar button[aria-pressed]")
    .forEach((button) => {
      const format = [...button.classList]
        .find((name) => name.startsWith("ql-"))
        ?.slice(3);
      const expected = button.value || true;
      const active =
        expected === true
          ? Boolean(formats[format])
          : String(formats[format] || "") === expected;
      button.setAttribute("aria-pressed", String(active));
    });
}

function render() {
  const words = editor.getText().trim().split(/\s+/u).filter(Boolean).length;
  wordCount.textContent = `${words} ${words === 1 ? "word" : "words"}`;
  const html = editor.getSemanticHTML();
  htmlOutput.textContent = html;
  preview.innerHTML = html;
  updatePressedStates();
}

function markDirty() {
  error.textContent = "";
  setDirty();
  render();
}

editor.on("text-change", markDirty);
editor.on("selection-change", render);
titleInput.addEventListener("input", markDirty);
statusSelect.addEventListener("change", markDirty);

saveButton.addEventListener("click", () => {
  if (!titleInput.value.trim()) {
    error.textContent = "Article title is required";
    titleInput.focus();
    return;
  }
  if (!editor.getText().trim()) {
    error.textContent = "Article body is required";
    editor.focus();
    return;
  }
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      title: titleInput.value.trim(),
      status: statusSelect.value,
      html: editor.getSemanticHTML(),
    }),
  );
  titleInput.value = titleInput.value.trim();
  error.textContent = "";
  setDirty(false);
  result.textContent = `${statusLabels[statusSelect.value]} article saved`;
});

document
  .querySelector("#reset-rich-text")
  .addEventListener("click", () => resetDialog.showModal());
document
  .querySelector("#confirm-article-reset")
  .addEventListener("click", () => {
    localStorage.removeItem(storageKey);
    titleInput.value = initialArticle.title;
    statusSelect.value = initialArticle.status;
    editor.clipboard.dangerouslyPasteHTML(initialArticle.html, "api");
    editor.history.clear();
    error.textContent = "";
    setDirty(false);
    result.textContent = "Article reset to the starting draft";
    render();
  });

render();
setDirty(false);
