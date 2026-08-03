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
          <button id="reset-rich-text" type="button">
            Reset article
          </button>
          <button
            id="save-rich-text"
            type="button"
            class="btn btn-primary"
            disabled
          >
            Save article
          </button>
        </div>
      </div>

      <div
        id="rich-text-toolbar"
        class="rich-text-toolbar"
        role="toolbar"
        aria-label="Text formatting"
      >
        <span class="ql-formats">
          <button
            type="button"
            class="ql-header"
            value=""
            aria-label="Paragraph"
            aria-pressed="false"
          ></button>
          <button
            type="button"
            class="ql-header"
            value="2"
            aria-label="Heading 2"
            aria-pressed="false"
          ></button>
          <button
            type="button"
            class="ql-header"
            value="3"
            aria-label="Heading 3"
            aria-pressed="false"
          ></button>
          <button
            type="button"
            class="ql-blockquote"
            aria-label="Blockquote"
            aria-pressed="false"
          ></button>
          <button
            type="button"
            class="ql-code-block"
            aria-label="Code block"
            aria-pressed="false"
          ></button>
        </span>
        <span class="ql-formats">
          <button
            type="button"
            class="ql-bold"
            aria-label="Bold"
            aria-pressed="false"
          ></button>
          <button
            type="button"
            class="ql-italic"
            aria-label="Italic"
            aria-pressed="false"
          ></button>
          <button
            type="button"
            class="ql-underline"
            aria-label="Underline"
            aria-pressed="false"
          ></button>
          <button
            type="button"
            class="ql-strike"
            aria-label="Strike"
            aria-pressed="false"
          ></button>
          <select class="ql-color" aria-label="Text color">
            <option selected>Default</option>
            <option value="#111827">Charcoal</option>
            <option value="#2563eb">Blue</option>
            <option value="#15803d">Green</option>
            <option value="#b45309">Amber</option>
            <option value="#be123c">Rose</option>
          </select>
        </span>
        <span class="ql-formats">
          <button
            type="button"
            class="ql-list"
            value="bullet"
            aria-label="Bullet list"
            aria-pressed="false"
          ></button>
          <button
            type="button"
            class="ql-list"
            value="ordered"
            aria-label="Numbered list"
            aria-pressed="false"
          ></button>
          <button
            type="button"
            class="ql-link"
            aria-label="Insert link"
            aria-pressed="false"
          ></button>
          <button
            type="button"
            class="ql-align"
            value="center"
            aria-label="Align center"
            aria-pressed="false"
          ></button>
          <button
            type="button"
            class="ql-clean"
            aria-label="Clear formatting"
          ></button>
        </span>
        <span class="toolbar-spacer"></span>
        <span class="ql-formats">
          <button type="button" class="ql-undo" aria-label="Undo"></button>
          <button type="button" class="ql-redo" aria-label="Redo"></button>
        </span>
      </div>

      <div class="rich-text-grid">
        <article class="document-sheet" aria-label="Article editor">
          <div id="rich-text-editor"></div>
        </article>
        <aside
          class="markup-inspector"
          aria-label="Article preview and details"
        >
          <div class="panel-heading">
            <p class="section-kicker">Reader preview</p>
            <span>Live</span>
          </div>
          <article
            class="article-preview"
            data-testid="article-preview"
          ></article>
          <details class="html-details">
            <summary>Inspect semantic HTML</summary>
            <pre data-testid="rich-text-html"></pre>
          </details>
          <span
            data-testid="rich-text-error"
            class="field-error"
            role="alert"
          ></span>
          <output data-testid="rich-text-result" aria-live="polite">
            Draft is ready for editing
          </output>
        </aside>
      </div>

      <dialog
        id="reset-article-dialog"
        class="confirmation-dialog"
        aria-labelledby="reset-article-title"
      >
        <form method="dialog">
          <h3 id="reset-article-title">Reset article?</h3>
          <p>
            This discards the working draft and restores the example article.
          </p>
          <div class="dialog-actions">
            <button value="cancel">Cancel</button>
            <button
              id="confirm-article-reset"
              value="confirm"
              class="btn btn-danger"
            >
              Confirm reset
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
