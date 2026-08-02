import Stat from "../../components/stat.jsx";

export default function KeyboardSurface() {
  return (
    <section class="surface editorial-layout">
      <div class="document-editor">
        <div class="editor-toolbar">
          <div>
            <button class="tool-button active-tool">B</button>
            <button class="tool-button">
              <i>I</i>
            </button>
            <button class="tool-button">↗</button>
          </div>
          <span>Saved locally · just now</span>
          <button class="quiet-action">Share draft</button>
        </div>
        <div class="editor-paper">
          <p class="surface-label">FIELD NOTES / ISSUE 12</p>
          <label class="editor-title-label">
            Story title
            <input id="keyboard-input" value="seed" aria-label="Story title" />
          </label>
          <div
            id="rich-editor"
            class="rich-editor"
            role="textbox"
            aria-label="Story body"
            contenteditable="true"
            data-placeholder="Start writing the opening paragraph…"
          />
        </div>
      </div>
      <aside class="key-readback">
        <div class="panel-heading">
          <span>DOCUMENT INSPECTOR</span>
          <small>Input and shortcut signals</small>
        </div>
        <Stat label="input value" value="seed" testId="keyboard-value" />
        <Stat label="rich text" value="—" testId="rich-value" />
        <p class="key-log">
          <span>KEY LOG</span>
          <output data-testid="key-log">waiting</output>
        </p>
        <div class="editor-tip">
          <strong>Editing tip</strong>
          <p>
            Use the system select-all shortcut to replace the title, then
            continue in the story body.
          </p>
        </div>
      </aside>
    </section>
  );
}
