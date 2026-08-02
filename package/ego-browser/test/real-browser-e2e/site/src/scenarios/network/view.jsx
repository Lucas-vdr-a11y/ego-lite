export default function NetworkSurface() {
  return (
    <section class="surface tracker-layout">
      <div class="tracking-search">
        <span class="surface-label">INTERNATIONAL DELIVERY</span>
        <h2>Track a shipment</h2>
        <p>
          Enter a reference to request the newest carrier scan and estimated
          arrival.
        </p>
        <label>
          Tracking reference
          <div>
            <input value="EG-1842-SIN" aria-label="Tracking reference" />
            <button id="network-button" class="primary-action">
              Check status
            </button>
          </div>
        </label>
        <small>Updates may take up to five minutes after a carrier scan.</small>
      </div>
      <aside class="tracking-result">
        <div class="receipt-heading">
          <div>
            <span>SHIPMENT STATUS</span>
            <strong>EG-1842-SIN</strong>
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
      </aside>
    </section>
  );
}
