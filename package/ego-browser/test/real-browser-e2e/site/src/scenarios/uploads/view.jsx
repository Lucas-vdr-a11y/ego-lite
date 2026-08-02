export default function UploadsSurface() {
  return (
    <section class="surface asset-layout">
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
        <input id="file-input" type="file" multiple />
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
        <div class="file-list" data-testid="file-list">
          <p>No files selected</p>
        </div>
        <p class="activity-note">
          File metadata shown here comes directly from the browser FileList.
        </p>
      </aside>
    </section>
  );
}
