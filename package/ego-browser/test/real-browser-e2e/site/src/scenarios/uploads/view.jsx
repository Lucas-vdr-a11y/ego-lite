export default function UploadsSurface() {
  return (
    <section class="surface card asset-layout">
      <div class="asset-delivery">
        <div class="scenario-toolbar">
          <div>
            <span>CAMPAIGN / AUTUMN OBJECTS</span>
            <strong>Final artwork delivery</strong>
          </div>
          <span class="draft-badge">DUE FRI 18:00</span>
        </div>
        <label class="upload-zone" for="file-input">
          <span>DROP OR SELECT</span>
          <strong>Deliver campaign assets</strong>
          <small>
            TXT fixtures in E2E; production accepts artwork up to 2 GB
          </small>
          <i>Choose files →</i>
        </label>
        <input id="file-input" type="file" accept=".txt,.md,.csv" multiple />
        <div class="delivery-notes">
          <p>
            <strong>Naming</strong>
            <span>campaign_surface_version.ext</span>
          </p>
          <p>
            <strong>Color</strong>
            <span>sRGB for digital delivery</span>
          </p>
          <p>
            <strong>Review</strong>
            <span>Every file receives a checksum</span>
          </p>
        </div>
      </div>
      <aside class="delivery-receipt">
        <div class="receipt-heading">
          <div>
            <span>DELIVERY RECEIPT</span>
            <strong>Ready for files</strong>
          </div>
          <output data-testid="file-count">0</output>
        </div>
        <div class="d-flex gap-3 small text-secondary mb-2">
          <span>
            Bytes: <output data-testid="file-bytes">0</output>
          </span>
          <span>
            Rejected: <output data-testid="rejected-file-count">0</output>
          </span>
          <span>
            Delivered: <output data-testid="delivered-file-count">0</output>
          </span>
        </div>
        <div class="file-list" data-testid="file-list">
          <p>No files selected</p>
        </div>
        <button
          id="clear-files"
          type="button"
          class="btn btn-sm btn-outline-secondary"
          disabled
        >
          Clear files
        </button>
        <button
          id="deliver-files"
          type="button"
          class="btn btn-sm btn-primary ms-2"
          disabled
        >
          Deliver files
        </button>
        <output
          class="d-block mt-3 small fw-semibold"
          data-testid="delivery-status"
          role="status"
        >
          Awaiting files
        </output>
        <p class="activity-note">
          File metadata shown here comes directly from the browser FileList.
        </p>
      </aside>
    </section>
  );
}
