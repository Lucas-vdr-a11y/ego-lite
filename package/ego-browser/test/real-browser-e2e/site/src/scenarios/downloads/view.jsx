export default function DownloadsSurface() {
  return (
    <section class="surface card archive-layout">
      <div class="scenario-toolbar">
        <div>
          <span>OPERATIONS / EXPORTS</span>
          <strong>Generated reports</strong>
        </div>
        <div class="d-flex align-items-center gap-2">
          <label class="d-flex align-items-center gap-2 small text-secondary">
            Report format
            <select id="report-format" class="form-select form-select-sm">
              <option value="all">All formats</option>
              <option value="CSV">CSV</option>
              <option value="TXT">TXT</option>
              <option value="PDF">PDF</option>
            </select>
          </label>
          <span class="archive-range">
            Showing <output data-testid="visible-report-count">3</output>
          </span>
          <span class="archive-range">
            Ready <output data-testid="generated-report-count">1</output>
          </span>
        </div>
      </div>
      <div class="report-table" role="table" aria-label="Generated reports">
        <div class="report-row report-header" role="row">
          <span>Report</span>
          <span>Owner</span>
          <span>Format</span>
          <span>Generated</span>
          <span></span>
        </div>
        <div class="report-row" role="row" data-report-format="CSV">
          <div>
            <i>CSV</i>
            <strong>Fulfilment exceptions</strong>
            <small>24 rows · APAC warehouses</small>
          </div>
          <span>Operations</span>
          <output data-testid="report-status">Not prepared</output>
          <span>Today, 10:22</span>
          <span id="report-action">
            <button
              id="prepare-report"
              class="btn btn-sm btn-outline-secondary quiet-action"
              aria-label="Prepare fulfilment exceptions"
            >
              Prepare
            </button>
          </span>
        </div>
        <div
          class="report-row selected-report"
          role="row"
          data-report-format="TXT"
        >
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
            class="btn btn-sm btn-primary primary-action"
            href="/api/download"
            download
          >
            Download
          </a>
        </div>
        <div class="report-row" role="row" data-report-format="PDF">
          <div>
            <i>PDF</i>
            <strong>Weekly service review</strong>
            <small>Charts and incident notes</small>
          </div>
          <span>Reliability</span>
          <span>PDF · 1.2 MB</span>
          <span>Yesterday</span>
          <button
            class="btn btn-sm btn-outline-secondary quiet-action"
            disabled
          >
            Unavailable
          </button>
        </div>
      </div>
    </section>
  );
}
