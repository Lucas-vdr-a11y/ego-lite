import Stat from "../../components/stat.jsx";

export default function KeyboardSurface() {
  return (
    <section class="surface card editorial-layout">
      <div class="document-editor">
        <div class="editor-toolbar">
          <span class="toolbar-note">Draft autosave is off</span>
          <output data-testid="save-status">Unsaved changes</output>
          <div class="btn-group btn-group-sm" role="group" aria-label="Text formatting">
            <button type="button" class="btn btn-outline-secondary" data-editor-command="bold">
              Bold
            </button>
            <button type="button" class="btn btn-outline-secondary" data-editor-command="italic">
              Italic
            </button>
            <button type="button" class="btn btn-outline-secondary" data-editor-command="insertUnorderedList">
              Bulleted list
            </button>
          </div>
          <button
            id="save-draft"
            class="btn btn-sm btn-outline-secondary quiet-action"
          >
            Save draft
          </button>
          <button
            id="clear-draft"
            class="btn btn-sm btn-outline-secondary quiet-action"
          >
            Clear draft
          </button>
        </div>
        <div class="editor-paper">
          <p class="surface-label">FIELD NOTES / ISSUE 12</p>
          <label class="editor-title-label">
            Story title
            <input
              id="keyboard-input"
              class="form-control"
              value="seed"
              aria-label="Story title"
            />
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
        <Stat label="body words" value="0" testId="word-count" />
        <Stat label="format action" value="None" testId="format-status" />
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
