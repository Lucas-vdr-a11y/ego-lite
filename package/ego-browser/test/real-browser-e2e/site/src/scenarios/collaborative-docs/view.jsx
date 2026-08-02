export default function CollaborativeDocsSurface() {
  return (
    <section class="surface card business-workspace collaborative-docs">
      <header class="business-heading compact-business-heading">
        <div>
          <p class="section-kicker">Northstar Docs / Decision 024</p>
          <h2>Regional pilot decision</h2>
        </div>
        <div class="presence-cluster" aria-label="Document collaboration status">
          <span class="presence-dot" aria-hidden="true"></span>
          <span data-testid="collaborator-count">1 online</span>
          <span data-testid="collab-status">Connecting</span>
        </div>
      </header>

      <div class="collab-toolbar" role="toolbar" aria-label="Document actions">
        <label class="collaborator-name-field">
          <span>Your name</span>
          <input id="collab-user-name" value="Mei Lin" />
        </label>
        <div class="formatting-actions" aria-label="Document formatting">
          <button type="button" data-collab-command="bold" aria-pressed="false">Bold</button>
          <button type="button" data-collab-command="italic" aria-pressed="false">Italic</button>
          <button type="button" data-collab-command="bulletList" aria-pressed="false">Bullet list</button>
          <button type="button" data-collab-command="blockquote" aria-pressed="false">Quote</button>
          <button type="button" data-collab-command="undo" aria-label="Undo document change">Undo</button>
          <button type="button" data-collab-command="redo" aria-label="Redo document change">Redo</button>
        </div>
        <div class="toolbar-actions">
          <button id="reset-collaborative-doc" type="button">Reset document</button>
          <button id="save-doc-version" type="button" class="btn btn-primary">Save version</button>
        </div>
      </div>

      <div class="document-collaboration-grid">
        <article class="document-sheet" aria-label="Shared document">
          <div id="collaborative-editor"></div>
        </article>
        <aside class="document-activity" aria-label="Live document details">
          <dl class="document-metrics">
            <div><dt>Sync</dt><dd data-testid="sync-status">Preparing document</dd></div>
            <div><dt>Version</dt><dd data-testid="collab-version">Version 1</dd></div>
            <div><dt>Room</dt><dd>decision-024</dd></div>
          </dl>
          <div class="version-panel">
            <div class="panel-heading">
              <p class="section-kicker">Version history</p>
              <span data-testid="version-count">0 saved</span>
            </div>
            <ol data-testid="version-history" class="version-history">
              <li class="empty-version">Save a version to create a restore point.</li>
            </ol>
          </div>
          <output data-testid="collab-result" aria-live="polite">
            Changes save locally and sync across open tabs
          </output>
        </aside>
      </div>

      <dialog id="reset-collab-dialog" class="confirmation-dialog" aria-labelledby="reset-collab-title">
        <form method="dialog">
          <h3 id="reset-collab-title">Reset shared document?</h3>
          <p>This replaces the shared draft and removes its saved version history.</p>
          <div class="dialog-actions">
            <button value="cancel">Cancel</button>
            <button id="confirm-collab-reset" value="confirm" class="btn btn-danger">Confirm reset</button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
