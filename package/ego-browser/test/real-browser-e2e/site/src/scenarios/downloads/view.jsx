export default function DownloadsSurface() {
  return (
    <section class="surface archive-layout">
      <div class="scenario-toolbar">
        <div>
          <span>OPERATIONS / EXPORTS</span>
          <strong>Generated reports</strong>
        </div>
        <div class="archive-range">01 JUL — 31 JUL</div>
      </div>
      <div class="report-table" role="table" aria-label="Generated reports">
        <div class="report-row report-header" role="row">
          <span>Report</span>
          <span>Owner</span>
          <span>Format</span>
          <span>Generated</span>
          <span></span>
        </div>
        <div class="report-row" role="row">
          <div>
            <i>CSV</i>
            <strong>Fulfilment exceptions</strong>
            <small>24 rows · APAC warehouses</small>
          </div>
          <span>Operations</span>
          <span>CSV · 18 KB</span>
          <span>Today, 10:22</span>
          <button class="quiet-action">Prepare</button>
        </div>
        <div class="report-row selected-report" role="row">
          <div>
            <i>TXT</i>
            <strong>Browser run summary</strong>
            <small>Deterministic E2E export</small>
          </div>
          <span>Engineering</span>
          <span>TXT · 29 B</span>
          <span>Today, 10:31</span>
          <a
            id="download-link"
            class="primary-action"
            href="/api/download"
            download
          >
            Download
          </a>
        </div>
        <div class="report-row" role="row">
          <div>
            <i>PDF</i>
            <strong>Weekly service review</strong>
            <small>Charts and incident notes</small>
          </div>
          <span>Reliability</span>
          <span>PDF · 1.2 MB</span>
          <span>Yesterday</span>
          <button class="quiet-action">Prepare</button>
        </div>
      </div>
    </section>
  );
}
