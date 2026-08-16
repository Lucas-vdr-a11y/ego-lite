export default function WebComponentsSurface() {
  return (
    <section class="surface card web-components-surface">
      <header class="web-components-heading">
        <div>
          <span>APAC LOGISTICS / COMPONENT REVIEW</span>
          <h2>Shipment component review</h2>
        </div>
        <p>
          Review two independently rendered shipment cards before changing the
          primary card&apos;s projected content.
        </p>
      </header>

      <button
        type="button"
        class="btn btn-outline-secondary web-components-start"
        data-testid="begin-shadow-review"
      >
        Begin shipment review
      </button>

      <div id="shipment-queue" class="shipment-card-grid">
        <shipment-card id="primary-shipment" data-shipment-id="SG-2048">
          <strong
            id="primary-reference"
            slot="reference"
            data-reference-content
          >
            SG-2048
          </strong>
          <span id="primary-route" slot="route" data-route-content>
            Singapore to Shanghai
          </span>
          <p id="primary-note" data-note-content>
            Cold-chain seal verified for the 18 August handoff.
          </p>
        </shipment-card>

        <shipment-card
          id="secondary-shipment"
          data-shipment-id="Unassigned"
        ></shipment-card>
      </div>

      <section class="web-components-evidence" aria-label="Component events">
        <div>
          <span>REVIEWED SHIPMENTS</span>
          <output data-testid="shadow-reviewed-count">
            0 of 2 shipments reviewed
          </output>
        </div>
        <div>
          <span>COMPOSED CLICK PATH</span>
          <output data-testid="shadow-click-path">
            Awaiting a shadow control click
          </output>
        </div>
        <div>
          <span>CUSTOM EVENT PATH</span>
          <output data-testid="shadow-custom-event-path">
            Awaiting a shipment review event
          </output>
        </div>
      </section>

      <template id="shipment-card-template">
        <style>{`
          :host {
            display: block;
            min-width: 0;
          }

          article {
            height: 100%;
            padding: 1.25rem;
            border: 1px solid #cbd5e1;
            border-radius: 0.65rem;
            color: #172033;
            background: #ffffff;
          }

          header {
            display: flex;
            align-items: start;
            justify-content: space-between;
            gap: 1rem;
            padding-bottom: 0.85rem;
            border-bottom: 1px solid #e2e8f0;
          }

          header span,
          .field-label {
            color: #64748b;
            font-size: 0.7rem;
            font-weight: 700;
            letter-spacing: 0.08em;
          }

          header strong {
            font-size: 1rem;
          }

          .field {
            margin-top: 1rem;
          }

          .field-label {
            display: block;
            margin-bottom: 0.35rem;
          }

          .actions {
            display: flex;
            flex-wrap: wrap;
            gap: 0.6rem;
            margin-top: 1.25rem;
          }

          button {
            min-height: 2.5rem;
            padding: 0.5rem 0.8rem;
            border: 1px solid #64748b;
            border-radius: 0.45rem;
            color: #172033;
            background: #ffffff;
            font: inherit;
            font-weight: 650;
          }

          button[data-action="review"] {
            border-color: #2563eb;
            color: #ffffff;
            background: #2563eb;
          }

          button:focus-visible {
            outline: 3px solid #f59e0b;
            outline-offset: 2px;
          }

          output {
            display: block;
            margin-top: 1rem;
            color: #475569;
            font-size: 0.8rem;
            font-weight: 650;
          }

          [data-slot-summary] {
            color: #64748b;
            font-size: 0.7rem;
          }
        `}</style>
        <article data-card-shell>
          <header>
            <span>SHIPMENT</span>
            <strong>
              <slot name="reference">Unassigned shipment</slot>
            </strong>
          </header>
          <div class="field">
            <span class="field-label">ROUTE</span>
            <slot name="route">Route pending</slot>
          </div>
          <div class="field">
            <span class="field-label">REVIEW NOTES</span>
            <slot>No review notes supplied.</slot>
          </div>
          <div class="actions">
            <button type="button" data-action="review">
              Review shipment
            </button>
            <button type="button" data-action="swap">
              Swap route and notes
            </button>
          </div>
          <output data-shadow-status>Awaiting review</output>
          <output data-slot-summary></output>
        </article>
      </template>
    </section>
  );
}
