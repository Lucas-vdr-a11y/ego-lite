export default function DialogsSurface() {
  return (
    <section class="surface card release-layout">
      <div class="release-summary">
        <span class="release-state" data-testid="release-workflow-state">
          <i /> READY TO PUBLISH
        </span>
        <h2>
          Release 1.3
          <br />
          Native TaskSpaces
        </h2>
        <p>
          13 checks passed in staging. The release includes direct CDP transport
          and native Playwright page lifecycle.
        </p>
        <dl>
          <div>
            <dt>Commit</dt>
            <dd>80a9e0c</dd>
          </div>
          <div>
            <dt>Audience</dt>
            <dd>Internal beta</dd>
          </div>
          <div>
            <dt>Window</dt>
            <dd>Today · 18:00</dd>
          </div>
        </dl>
      </div>
      <div class="release-actions">
        <article>
          <span>01 / NOTICE</span>
          <div>
            <strong>Notify observers</strong>
            <p>Send a non-blocking release notice before the window opens.</p>
          </div>
          <button id="alert-button" class="btn btn-outline-secondary">
            Preview notice
          </button>
        </article>
        <article>
          <span>02 / APPROVAL</span>
          <div>
            <strong>Confirm publication</strong>
            <p>
              Require an explicit confirmation before moving the release live.
            </p>
          </div>
          <button id="confirm-button" class="btn btn-primary">
            Request approval
          </button>
        </article>
        <article>
          <span>03 / LABEL</span>
          <div>
            <strong>Name the release</strong>
            <p>Capture the final human-readable label for the archive.</p>
          </div>
          <button id="prompt-button" class="btn btn-outline-secondary">
            Set release name
          </button>
        </article>
        <div class="release-checklist" aria-label="Release prerequisites">
          <p>
            Notice <output data-testid="release-notice">Not previewed</output>
          </p>
          <p>
            Approval <output data-testid="release-approval">Pending</output>
          </p>
          <p>
            Name <output data-testid="release-name">Not set</output>
          </p>
          <button id="publish-release" type="button" class="btn btn-success" disabled>
            Publish release
          </button>
        </div>
        <div class="dialog-result">
          <span>
            WORKFLOWS <output data-testid="dialog-count">0</output>
          </span>
          <output data-testid="dialog-result">waiting</output>
          <button
            id="reset-dialogs"
            type="button"
            class="btn btn-sm btn-outline-secondary"
          >
            Reset dialog history
          </button>
        </div>
      </div>
    </section>
  );
}
