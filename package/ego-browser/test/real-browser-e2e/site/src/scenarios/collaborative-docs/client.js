import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import StarterKit from "@tiptap/starter-kit";
import * as Y from "yjs";

const roomName = "ego-browser:collaborative-docs:decision-024";
const storageKey = `${roomName}:state`;
const versionKey = `${roomName}:version`;
const historyKey = `${roomName}:history`;
const remoteOrigin = Symbol("broadcast");
const clientId = crypto.randomUUID();
const params = new URLSearchParams(location.search);
let userName = params.get("user") || "Mei Lin";
const userNameInput = document.querySelector("#collab-user-name");
const collaboratorCount = document.querySelector(
  '[data-testid="collaborator-count"]',
);
const collaborationStatus = document.querySelector(
  '[data-testid="collab-status"]',
);
const syncStatus = document.querySelector('[data-testid="sync-status"]');
const versionLabel = document.querySelector('[data-testid="collab-version"]');
const versionCount = document.querySelector('[data-testid="version-count"]');
const versionHistory = document.querySelector(
  '[data-testid="version-history"]',
);
const result = document.querySelector('[data-testid="collab-result"]');
const resetDialog = document.querySelector("#reset-collab-dialog");
const channel = new BroadcastChannel(roomName);
const documentModel = new Y.Doc();
const peers = new Map();
const initialContent =
  "<h2>Regional pilot decision</h2><p>Document the launch recommendation and review evidence together.</p>";

userNameInput.value = userName;

function encodeUpdate(update) {
  let binary = "";
  for (const byte of update) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeUpdate(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function readHistory() {
  try {
    const versions = JSON.parse(localStorage.getItem(historyKey));
    return Array.isArray(versions) ? versions : [];
  } catch {
    return [];
  }
}

const persistedState = localStorage.getItem(storageKey);
if (persistedState) Y.applyUpdate(documentModel, decodeUpdate(persistedState));

const editor = new Editor({
  element: document.querySelector("#collaborative-editor"),
  extensions: [
    StarterKit.configure({ undoRedo: false }),
    Collaboration.configure({ document: documentModel }),
  ],
  editorProps: {
    attributes: { "aria-label": "Collaborative document", role: "textbox" },
  },
});

if (!persistedState) editor.commands.setContent(initialContent);

const commands = {
  bold: () => editor.chain().focus().toggleBold().run(),
  italic: () => editor.chain().focus().toggleItalic().run(),
  bulletList: () => editor.chain().focus().toggleBulletList().run(),
  blockquote: () => editor.chain().focus().toggleBlockquote().run(),
  undo: () => editor.chain().focus().undo().run(),
  redo: () => editor.chain().focus().redo().run(),
};

function renderPresence() {
  collaboratorCount.textContent = `${peers.size + 1} online`;
  collaborationStatus.textContent = peers.size ? "Collaborating" : "Synced";
}

function renderVersionHistory() {
  const versions = readHistory().sort((a, b) => b.number - a.number);
  versionCount.textContent = `${versions.length} saved`;
  versionHistory.replaceChildren();
  if (!versions.length) {
    const item = document.createElement("li");
    item.className = "empty-version";
    item.textContent = "Save a version to create a restore point.";
    versionHistory.append(item);
    return;
  }
  for (const version of versions) {
    const item = document.createElement("li");
    const summary = document.createElement("div");
    const name = document.createElement("strong");
    const author = document.createElement("span");
    const restore = document.createElement("button");
    name.textContent = `Version ${version.number}`;
    author.textContent = version.author;
    restore.type = "button";
    restore.dataset.restoreVersion = String(version.number);
    restore.setAttribute("aria-label", `Restore Version ${version.number}`);
    restore.textContent = "Restore";
    summary.append(name, author);
    item.append(summary, restore);
    versionHistory.append(item);
  }
}

function renderFormatting() {
  document.querySelectorAll("[data-collab-command]").forEach((button) => {
    if (!button.hasAttribute("aria-pressed")) return;
    button.setAttribute(
      "aria-pressed",
      String(editor.isActive(button.dataset.collabCommand)),
    );
  });
}

function persist() {
  localStorage.setItem(
    storageKey,
    encodeUpdate(Y.encodeStateAsUpdate(documentModel)),
  );
  syncStatus.textContent = "All changes synced";
}

documentModel.on("update", (update, origin) => {
  persist();
  if (origin !== remoteOrigin)
    channel.postMessage({
      type: "update",
      sender: clientId,
      user: userName,
      update,
    });
});

channel.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || message.sender === clientId) return;
  if (message.type === "update") {
    Y.applyUpdate(documentModel, new Uint8Array(message.update), remoteOrigin);
    result.textContent = `Changes received from ${message.user || "a collaborator"}`;
  }
  if (message.type === "sync-request")
    channel.postMessage({
      type: "update",
      sender: clientId,
      user: userName,
      update: Y.encodeStateAsUpdate(documentModel),
    });
  if (message.type === "presence" || message.type === "hello") {
    peers.set(message.sender, message.user);
    renderPresence();
    if (message.type === "hello")
      channel.postMessage({
        type: "presence",
        sender: clientId,
        user: userName,
      });
  }
  if (message.type === "leave") {
    peers.delete(message.sender);
    renderPresence();
  }
  if (message.type === "version") {
    versionLabel.textContent = `Version ${message.number}`;
    renderVersionHistory();
  }
});

editor.on("update", () => {
  syncStatus.textContent = "Syncing changes";
  renderFormatting();
  queueMicrotask(persist);
});
editor.on("selectionUpdate", renderFormatting);

document.querySelectorAll("[data-collab-command]").forEach((button) => {
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => {
    commands[button.dataset.collabCommand]();
    renderFormatting();
  });
});

userNameInput.addEventListener("change", () => {
  userName = userNameInput.value.trim() || "Guest editor";
  userNameInput.value = userName;
  channel.postMessage({ type: "presence", sender: clientId, user: userName });
  result.textContent = `Editing as ${userName}`;
});

document.querySelector("#save-doc-version").addEventListener("click", () => {
  const nextVersion = Number(localStorage.getItem(versionKey) || "1") + 1;
  const versions = readHistory();
  versions.push({
    number: nextVersion,
    author: userName,
    html: editor.getHTML(),
  });
  localStorage.setItem(versionKey, String(nextVersion));
  localStorage.setItem(historyKey, JSON.stringify(versions));
  versionLabel.textContent = `Version ${nextVersion}`;
  result.textContent = `Version ${nextVersion} saved by ${userName}`;
  renderVersionHistory();
  channel.postMessage({
    type: "version",
    sender: clientId,
    number: nextVersion,
  });
});

versionHistory.addEventListener("click", (event) => {
  const button = event.target.closest("[data-restore-version]");
  if (!button) return;
  const version = readHistory().find(
    (candidate) => candidate.number === Number(button.dataset.restoreVersion),
  );
  if (!version) return;
  editor.commands.setContent(version.html);
  result.textContent = `Version ${version.number} restored`;
});

document
  .querySelector("#reset-collaborative-doc")
  .addEventListener("click", () => resetDialog.showModal());
document
  .querySelector("#confirm-collab-reset")
  .addEventListener("click", () => {
    editor.commands.setContent(initialContent);
    localStorage.removeItem(historyKey);
    localStorage.setItem(versionKey, "1");
    versionLabel.textContent = "Version 1";
    result.textContent = "Document reset to the shared starting point";
    renderVersionHistory();
    channel.postMessage({ type: "version", sender: clientId, number: 1 });
  });

versionLabel.textContent = `Version ${localStorage.getItem(versionKey) || "1"}`;
persist();
renderPresence();
renderFormatting();
renderVersionHistory();
channel.postMessage({ type: "sync-request", sender: clientId, user: userName });
channel.postMessage({ type: "hello", sender: clientId, user: userName });

addEventListener("pagehide", () => {
  channel.postMessage({ type: "leave", sender: clientId });
  channel.close();
  editor.destroy();
  documentModel.destroy();
});
