import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

const storageKey = "ego-browser:rich-text-article:v2";
const initialArticle = {
  title: "August release",
  status: "draft",
  html: "<h2>August release</h2><p>Prepare the regional launch note for reviewers.</p>",
};
const statusLabels = { draft: "Draft", review: "Ready for review", approved: "Approved" };
const titleInput = document.querySelector("#article-title");
const statusSelect = document.querySelector("#article-status");
const wordCount = document.querySelector('[data-testid="rich-text-word-count"]');
const saveState = document.querySelector('[data-testid="rich-text-save-state"]');
const htmlOutput = document.querySelector('[data-testid="rich-text-html"]');
const preview = document.querySelector('[data-testid="article-preview"]');
const error = document.querySelector('[data-testid="rich-text-error"]');
const result = document.querySelector('[data-testid="rich-text-result"]');
const saveButton = document.querySelector("#save-rich-text");
const resetDialog = document.querySelector("#reset-article-dialog");

function readArticle() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && typeof saved.title === "string" && typeof saved.html === "string") return saved;
  } catch {}
  return { ...initialArticle };
}

const savedArticle = readArticle();
titleInput.value = savedArticle.title;
statusSelect.value = savedArticle.status;

const editor = new Editor({
  element: document.querySelector("#rich-text-editor"),
  extensions: [StarterKit],
  content: savedArticle.html,
  editorProps: { attributes: { "aria-label": "Rich text article", role: "textbox" } },
});

const commands = {
  paragraph: () => editor.chain().focus().setParagraph().run(),
  heading2: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  heading3: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  bold: () => editor.chain().focus().toggleBold().run(),
  italic: () => editor.chain().focus().toggleItalic().run(),
  strike: () => editor.chain().focus().toggleStrike().run(),
  bulletList: () => editor.chain().focus().toggleBulletList().run(),
  orderedList: () => editor.chain().focus().toggleOrderedList().run(),
  blockquote: () => editor.chain().focus().toggleBlockquote().run(),
  undo: () => editor.chain().focus().undo().run(),
  redo: () => editor.chain().focus().redo().run(),
};

function setDirty(dirty = true) {
  saveState.textContent = dirty ? "Unsaved changes" : "All changes saved";
  saveButton.disabled = !dirty;
}

function isCommandActive(command) {
  if (command === "paragraph") return editor.isActive("paragraph");
  if (command === "heading2") return editor.isActive("heading", { level: 2 });
  if (command === "heading3") return editor.isActive("heading", { level: 3 });
  return editor.isActive(command);
}

function render() {
  const words = editor.getText().trim().split(/\s+/u).filter(Boolean).length;
  wordCount.textContent = `${words} ${words === 1 ? "word" : "words"}`;
  const html = editor.getHTML();
  htmlOutput.textContent = html;
  preview.innerHTML = html;
  document.querySelectorAll("[data-rich-command]").forEach((button) => {
    if (button.hasAttribute("aria-pressed")) button.setAttribute("aria-pressed", String(isCommandActive(button.dataset.richCommand)));
  });
}

function markDirty() {
  error.textContent = "";
  setDirty();
  render();
}

document.querySelectorAll("[data-rich-command]").forEach((button) => {
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => {
    commands[button.dataset.richCommand]();
    render();
  });
});

editor.on("update", markDirty);
editor.on("selectionUpdate", render);
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
    editor.commands.focus();
    return;
  }
  localStorage.setItem(storageKey, JSON.stringify({
    title: titleInput.value.trim(),
    status: statusSelect.value,
    html: editor.getHTML(),
  }));
  titleInput.value = titleInput.value.trim();
  error.textContent = "";
  setDirty(false);
  result.textContent = `${statusLabels[statusSelect.value]} article saved`;
});

document.querySelector("#reset-rich-text").addEventListener("click", () => resetDialog.showModal());
document.querySelector("#confirm-article-reset").addEventListener("click", () => {
  localStorage.removeItem(storageKey);
  titleInput.value = initialArticle.title;
  statusSelect.value = initialArticle.status;
  editor.commands.setContent(initialArticle.html);
  error.textContent = "";
  setDirty(false);
  result.textContent = "Article reset to the starting draft";
  render();
});

render();
setDirty(false);
