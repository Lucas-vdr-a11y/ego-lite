export default function NetworkSurface() {
  return (
    <section class="surface card tracker-layout">
      <div class="tracking-search">
        <span class="surface-label">INTERNATIONAL DELIVERY</span>
        <h2>Track a shipment</h2>
        <p>
          Enter a reference to request the newest carrier scan and estimated
          arrival.
        </p>
        <label>
          Tracking reference
          <div class="input-group">
            <input
              id="tracking-reference"
              class="form-control"
              value="EG-1842-SIN"
              aria-label="Tracking reference"
            />
            <button id="network-button" class="btn btn-primary primary-action">
              Check status
            </button>
          </div>
        </label>
        <div class="d-flex flex-wrap align-items-end gap-2 mt-3">
          <label class="flex-grow-1">
            Response mode
            <select id="response-mode" class="form-select">
              <option value="success">Successful response</option>
              <option value="delayed">Delayed response</option>
              <option value="error">Server error</option>
            </select>
          </label>
          <button
            id="reset-network"
            type="button"
            class="btn btn-outline-secondary"
          >
            Reset lookup
          </button>
        </div>
        <small>Updates may take up to five minutes after a carrier scan.</small>
      </div>
      <aside class="tracking-result">
        <div class="receipt-heading">
          <div>
            <span>SHIPMENT STATUS</span>
            <strong data-testid="network-reference">EG-1842-SIN</strong>
          </div>
          <output data-testid="network-status">idle</output>
        </div>
        <div class="tracking-timeline">
          <article class="completed-scan">
            <i />
            <div>
              <strong>Order confirmed</strong>
              <span>Singapore · 08:20</span>
            </div>
          </article>
          <article class="current-scan">
            <i />
            <div>
              <strong data-testid="network-payload">Awaiting lookup</strong>
              <span>Live response appears here</span>
            </div>
          </article>
          <article>
            <i />
            <div>
              <strong>Out for delivery</strong>
              <span>Estimated tomorrow</span>
            </div>
          </article>
        </div>
        <div class="network-history-panel">
          <strong>
            Lookup history · <output data-testid="network-attempts">0</output>
          </strong>
          <div data-testid="network-history">No lookups yet</div>
        </div>
      </aside>
    </section>
  );
}
