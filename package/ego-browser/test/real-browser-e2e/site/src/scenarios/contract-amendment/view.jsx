export default function ContractAmendmentSurface() {
  return (
    <section
      class="surface card contract-amendment"
      data-amendment-state="pending"
    >
      <article aria-labelledby="contract-amendment-title">
        <header class="contract-amendment-heading">
          <p class="eyebrow">Legal review / Supplier operations</p>
          <h2 id="contract-amendment-title">Contract amendment CR-482</h2>
          <p>Change requested 15 August 2026 at 09:30 SGT · Clause 7.4</p>
        </header>

        <section
          class="contract-amendment-clause"
          aria-labelledby="contract-clause-heading"
        >
          <h3 id="contract-clause-heading">
            Severity-one acknowledgement window
          </h3>
          <p data-testid="amendment-clause">
            The supplier acknowledgement deadline changes from{" "}
            <del
              cite="/change-requests/CR-482"
              dateTime="2026-08-15T09:30:00+08:00"
            >
              within 60 minutes of a severity-one incident
            </del>{" "}
            to{" "}
            <ins
              cite="/change-requests/CR-482"
              dateTime="2026-08-15T09:30:00+08:00"
            >
              within 30 minutes of a severity-one incident
            </ins>
            .
          </p>
          <p class="contract-amendment-note">
            The prior and proposed wording remain together so reviewers can
            audit exactly what acceptance changes.
          </p>
        </section>

        <section
          class="contract-amendment-review"
          aria-labelledby="contract-review-heading"
        >
          <h3 id="contract-review-heading">Acceptance decision</h3>
          <output data-testid="amendment-review-status" aria-live="polite">
            Pending legal acceptance for CR-482.
          </output>
          <div class="contract-amendment-actions">
            <button type="button" class="btn btn-primary" data-accept-amendment>
              Accept amendment
            </button>
            <button
              type="button"
              class="btn btn-outline-secondary"
              data-amendment-history
              disabled
            >
              Undo acceptance
            </button>
          </div>
        </section>
      </article>
    </section>
  );
}
