export default function RichTextSurface() {
  return (
    <section class="surface card business-workspace rich-text-workspace">
      <header class="business-heading compact-business-heading">
        <div>
          <p class="section-kicker">Release notes / Editorial</p>
          <h2>Publish-ready editor</h2>
        </div>
        <div class="article-state">
          <span data-testid="rich-text-word-count">8 words</span>
          <strong data-testid="rich-text-save-state">All changes saved</strong>
        </div>
      </header>

      <div class="article-metadata">
        <label>
          <span>Article title</span>
          <input id="article-title" value="August release" />
        </label>
        <label>
          <span>Publishing status</span>
          <select id="article-status">
            <option value="draft">Draft</option>
            <option value="review">Ready for review</option>
            <option value="approved">Approved</option>
          </select>
        </label>
        <div class="toolbar-actions">
          <button id="reset-rich-text" type="button">Reset article</button>
          <button id="save-rich-text" type="button" class="btn btn-primary" disabled>Save article</button>
        </div>
      </div>

      <div class="rich-text-toolbar" role="toolbar" aria-label="Text formatting">
        <button type="button" data-rich-command="paragraph" aria-pressed="false">Paragraph</button>
        <button type="button" data-rich-command="heading2" aria-pressed="false" aria-label="Heading 2">H2</button>
        <button type="button" data-rich-command="heading3" aria-pressed="false" aria-label="Heading 3">H3</button>
        <span class="toolbar-divider" aria-hidden="true"></span>
        <button type="button" data-rich-command="bold" aria-pressed="false">Bold</button>
        <button type="button" data-rich-command="italic" aria-pressed="false">Italic</button>
        <button type="button" data-rich-command="strike" aria-pressed="false">Strike</button>
        <span class="toolbar-divider" aria-hidden="true"></span>
        <button type="button" data-rich-command="bulletList" aria-pressed="false">Bullet list</button>
        <button type="button" data-rich-command="orderedList" aria-pressed="false">Numbered list</button>
        <button type="button" data-rich-command="blockquote" aria-pressed="false">Blockquote</button>
        <span class="toolbar-spacer"></span>
        <button type="button" data-rich-command="undo">Undo</button>
        <button type="button" data-rich-command="redo">Redo</button>
      </div>

      <div class="rich-text-grid">
        <article class="document-sheet" aria-label="Article editor">
          <div id="rich-text-editor"></div>
        </article>
        <aside class="markup-inspector" aria-label="Article preview and details">
          <div class="panel-heading">
            <p class="section-kicker">Reader preview</p>
            <span>Live</span>
          </div>
          <article class="article-preview" data-testid="article-preview"></article>
          <details class="html-details">
            <summary>Inspect semantic HTML</summary>
            <pre data-testid="rich-text-html"></pre>
          </details>
          <span data-testid="rich-text-error" class="field-error" role="alert"></span>
          <output data-testid="rich-text-result" aria-live="polite">
            Draft is ready for editing
          </output>
        </aside>
      </div>

      <dialog id="reset-article-dialog" class="confirmation-dialog" aria-labelledby="reset-article-title">
        <form method="dialog">
          <h3 id="reset-article-title">Reset article?</h3>
          <p>This discards the working draft and restores the example article.</p>
          <div class="dialog-actions">
            <button value="cancel">Cancel</button>
            <button id="confirm-article-reset" value="confirm" class="btn btn-danger">Confirm reset</button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
