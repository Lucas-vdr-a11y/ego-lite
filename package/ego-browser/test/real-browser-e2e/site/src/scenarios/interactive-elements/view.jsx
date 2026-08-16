export default function InteractiveElementsSurface() {
  return (
    <section class="surface card interactive-elements">
      <header class="interactive-elements-heading">
        <p class="eyebrow">Dispatch desk / Native interaction controls</p>
        <h2>Dispatch interaction review</h2>
        <p>
          Review the Shanghai shipment terms, validate location availability,
          and record the final dispatch decision.
        </p>
      </header>

      <section
        class="interactive-elements-disclosure"
        aria-labelledby="shipment-terms-heading"
      >
        <h3 id="shipment-terms-heading">Shipment terms and location</h3>
        <details data-testid="shipment-terms">
          <summary>Review Shanghai shipment terms</summary>
          <div class="interactive-elements-details-body">
            <p>
              The cold-chain handoff requires a staffed arrival bay and a
              verified dispatch location before release.
            </p>
            <div class="interactive-elements-location">
              <h4>Dispatch location</h4>
              <p>
                Focus the browser-native location control to inspect it. This
                review does not request location permission.
              </p>
              <geolocation data-testid="dispatch-geolocation">
                <button
                  type="button"
                  class="btn btn-outline-secondary"
                  data-manual-location-fallback
                >
                  Use manual dispatch zone
                </button>
              </geolocation>
              <output
                data-testid="geolocation-validation-status"
                aria-live="polite"
              >
                Waiting for native geolocation validation.
              </output>
            </div>
          </div>
        </details>
        <output data-testid="details-toggle-status" aria-live="polite">
          Shipment terms collapsed.
        </output>
      </section>

      <section
        class="interactive-elements-decision"
        aria-labelledby="dispatch-decision-heading"
      >
        <h3 id="dispatch-decision-heading">Dispatch decision</h3>
        <p data-testid="interactive-background-status">
          Background dispatch board ready.
        </p>
        <button type="button" class="btn btn-primary" data-open-dispatch-dialog>
          Open dispatch decision
        </button>
        <output data-testid="dialog-decision-status" aria-live="polite">
          Dispatch decision pending.
        </output>
      </section>

      <dialog
        id="dispatch-decision-dialog"
        aria-labelledby="dispatch-dialog-title"
      >
        <form method="dialog">
          <h2 id="dispatch-dialog-title">Confirm dispatch readiness</h2>
          <p>
            Confirm that the Shanghai arrival bay can receive the protected
            shipment.
          </p>
          <div class="interactive-elements-dialog-actions">
            <button
              type="submit"
              class="btn btn-outline-secondary"
              value="cancel"
            >
              Cancel decision
            </button>
            <button
              type="submit"
              class="btn btn-primary"
              value="confirmed"
              autofocus
            >
              Confirm dispatch
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
