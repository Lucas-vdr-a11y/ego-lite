export default function TextContentSurface() {
  return (
    <section class="surface card text-content-handoff">
      <div class="text-content-layout">
        <article aria-labelledby="incident-handoff-title">
          <header>
            <p class="eyebrow">Incident handoff / INC-2048</p>
            <h2 id="incident-handoff-title">Checkout latency handoff</h2>
            <p>
              Review the recorded evidence before accepting ownership of the
              overnight follow-up.
            </p>
          </header>

          <blockquote cite="https://status.example.test/incidents/INC-2048">
            <p>
              Error rates returned to baseline after the Singapore cache pool
              was replaced. No customer orders were lost.
            </p>
          </blockquote>

          <dl class="incident-facts">
            <div>
              <dt>Incident owner</dt>
              <dd>APAC Reliability</dd>
            </div>
            <div>
              <dt>Customer impact</dt>
              <dd>Elevated checkout latency for 18 minutes</dd>
            </div>
            <div>
              <dt>Current state</dt>
              <dd>Monitoring restored service</dd>
            </div>
          </dl>

          <hr />

          <div class="incident-evidence-grid">
            <section aria-labelledby="signals-heading">
              <h3 id="signals-heading">Signals reviewed</h3>
              <ul>
                <li>Checkout p95 returned below 420 ms.</li>
                <li>Payment authorization errors remained below 0.2%.</li>
                <li>No queue backlog remained after cache recovery.</li>
              </ul>
            </section>

            <section aria-labelledby="follow-up-heading">
              <h3 id="follow-up-heading">Overnight follow-up</h3>
              <ol>
                <li>Recheck regional latency at 23:00 SGT.</li>
                <li>Compare cache evictions with the seven-day baseline.</li>
                <li>Close the incident after the morning owner signs off.</li>
              </ol>
            </section>
          </div>

          <figure aria-labelledby="incident-log-caption">
            <pre
              data-testid="incident-event-log"
              aria-label="Incident event log"
              tabIndex="0"
            >
              {
                "14:02 alert opened — checkout p95 1.8 s\n14:07 cache pool replaced — traffic stable — node sg-cache-17 — trace 7f3a9c2e — regional verification completed with zero queued payment authorizations\n14:11 recovery confirmed — p95 390 ms"
              }
            </pre>
            <figcaption id="incident-log-caption">
              Incident event log, all times in Singapore Standard Time.
            </figcaption>
          </figure>

          <section class="incident-review" aria-labelledby="review-heading">
            <h3 id="review-heading">Handoff review</h3>
            <p>
              Confirm the immutable event log first. The final handoff action
              becomes available only after that evidence is acknowledged.
            </p>
            <menu aria-label="Incident review actions">
              <li>
                <button
                  type="button"
                  data-confirm-evidence
                  aria-pressed="false"
                >
                  Confirm log evidence
                </button>
              </li>
              <li>
                <button
                  type="button"
                  data-complete-handoff
                  aria-pressed="false"
                  disabled
                >
                  Mark handoff reviewed
                </button>
              </li>
            </menu>
            <p data-testid="incident-review-status" aria-live="polite">
              Log evidence must be confirmed before handoff review.
            </p>
          </section>
        </article>
      </div>
    </section>
  );
}
