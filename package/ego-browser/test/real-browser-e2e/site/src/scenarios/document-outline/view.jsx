export default function DocumentOutlineSurface() {
  return (
    <section class="surface card document-outline">
      <article aria-labelledby="release-document-title">
        <header class="document-outline-header">
          <p class="eyebrow">Release readiness / Northstar 2.4</p>
          <hgroup>
            <h1 id="release-document-title">Northstar 2.4 release briefing</h1>
            <p>
              A shared operating brief for the staged rollout, customer impact,
              and support handoff.
            </p>
          </hgroup>
          <address>
            Prepared by the Release Operations team ·{" "}
            <a href="mailto:release-ops@example.test">
              release-ops@example.test
            </a>
          </address>
          <nav aria-label="Release outline">
            <a href="#summary">Executive summary</a>
            <a href="#rollout">Rollout controls</a>
            <a href="#support">Support ownership</a>
          </nav>
          <search aria-label="Search release brief">
            <form
              class="document-outline-search"
              action="/tests/document-outline"
              method="get"
            >
              <label for="briefing-query">Find a release topic</label>
              <input
                id="briefing-query"
                name="q"
                type="search"
                autocomplete="off"
              />
              <button type="submit">Search briefing</button>
            </form>
          </search>
        </header>

        <section
          id="summary"
          class="document-outline-section"
          aria-labelledby="summary-heading"
          tabIndex="-1"
        >
          <h2 id="summary-heading">Executive summary</h2>
          <p>
            Northstar 2.4 is ready for a controlled rollout after the final
            checkout and notification workflows passed production rehearsal. The
            release remains reversible until the first regional review.
          </p>

          <section aria-labelledby="customer-impact-heading">
            <h3 id="customer-impact-heading">Customer impact</h3>
            <p>
              Existing workspaces keep their current navigation. New delivery
              status labels appear only after a workspace has received the
              release flag.
            </p>

            <section aria-labelledby="escalation-threshold-heading">
              <h4 id="escalation-threshold-heading">Escalation threshold</h4>
              <p>
                Pause the rollout if checkout errors exceed 0.8% for ten minutes
                or if two regions report delayed notifications.
              </p>

              <section aria-labelledby="checksum-heading">
                <h5 id="checksum-heading">Change log checksum</h5>
                <p>
                  Operations must match release record NS-2408-7F before
                  promoting the next region.
                </p>
                <section aria-labelledby="approval-digest-heading">
                  <h6 id="approval-digest-heading">Approval digest</h6>
                  <p>
                    The regional reviewer must record digest SG-24-08 before
                    promotion begins.
                  </p>
                </section>
              </section>
            </section>
          </section>
        </section>

        <section
          id="rollout"
          class="document-outline-section"
          aria-labelledby="rollout-heading"
          tabIndex="-1"
        >
          <h2 id="rollout-heading">Rollout controls</h2>
          <p>
            Begin with five percent of Singapore workspaces, review the error
            budget after thirty minutes, and then promote to the remaining APAC
            regions in two measured steps.
          </p>
          <ul>
            <li>Confirm the regional owner is online before each promotion.</li>
            <li>Record the dashboard checkpoint in the release channel.</li>
            <li>Keep the rollback control available until final sign-off.</li>
          </ul>
        </section>

        <section
          id="support"
          class="document-outline-section"
          aria-labelledby="support-heading"
          tabIndex="-1"
        >
          <h2 id="support-heading">Support ownership</h2>
          <p>
            The APAC support lead owns customer communication during rollout.
            Release Operations owns rollback decisions and the incident record.
          </p>
          <aside aria-labelledby="support-context-heading">
            <h3 id="support-context-heading">Related support context</h3>
            <p>
              Use incident template NS-24 and include the affected region,
              workspace count, first error timestamp, and current rollout step.
            </p>
          </aside>
        </section>

        <footer class="document-outline-footer">
          <p>Last reviewed 15 August 2026 · Release record NS-2408-7F</p>
        </footer>
      </article>
    </section>
  );
}
