export default function ReviewWorkflowSurface() {
  return (
    <section class="surface card business-workspace review-workflow">
      <aside class="workflow-rail" aria-label="Review stages">
        <p class="section-kicker">Review RE-204</p>
        <h2>Packaging claims</h2>
        <ol class="review-stages" data-testid="review-stage-list">
          <li data-review-stage="draft" data-state="current">
            Draft prepared
          </li>
          <li data-review-stage="review">Expert review</li>
          <li data-review-stage="changes">Author revision</li>
          <li data-review-stage="approved">Final approval</li>
        </ol>
      </aside>

      <div class="workflow-main">
        <header class="business-heading">
          <div>
            <p class="section-kicker">Regulatory review workspace</p>
            <h2>Approve the launch evidence</h2>
          </div>
          <span class="status-pill" data-testid="review-status">
            Draft
          </span>
        </header>

        <div class="review-assignment">
          <label>
            Acting as
            <select id="review-actor" aria-label="Acting as">
              <option value="coordinator">Review coordinator</option>
              <option value="reviewer">Lead reviewer</option>
              <option value="author">Document author</option>
            </select>
          </label>
          <label>
            Lead reviewer
            <select id="lead-reviewer" aria-label="Lead reviewer">
              <option value="">Choose reviewer</option>
              <option value="Aisha Rahman">Aisha Rahman</option>
              <option value="Daniel Wong">Daniel Wong</option>
            </select>
          </label>
          <label>
            Review due date
            <input id="review-due-date" type="date" value="2026-08-15" />
          </label>
          <button id="assign-review" type="button" class="btn btn-primary">
            Assign review
          </button>
        </div>

        <div class="review-content-grid">
          <section aria-labelledby="finding-heading">
            <div class="section-heading">
              <div>
                <p class="section-kicker">Evidence check</p>
                <h3 id="finding-heading">Review findings</h3>
              </div>
              <span data-testid="finding-count">0 open</span>
            </div>
            <label>
              Finding severity
              <select id="finding-severity">
                <option value="Blocking">Blocking</option>
                <option value="Advisory">Advisory</option>
              </select>
            </label>
            <label>
              Review finding
              <textarea
                id="review-finding"
                rows="4"
                placeholder="Describe the evidence gap and required correction"
              ></textarea>
            </label>
            <button id="add-finding" type="button" class="btn btn-secondary">
              Add finding
            </button>
            <ul id="review-findings" class="finding-list" aria-live="polite">
              <li class="empty-finding">No findings recorded</li>
            </ul>
          </section>

          <section class="review-decision" aria-labelledby="decision-heading">
            <p class="section-kicker">Controlled decision</p>
            <h3 id="decision-heading">Move the review forward</h3>
            <p>
              Actions are enabled only for the role responsible for the current
              stage.
            </p>
            <div class="decision-actions">
              <button id="request-changes" type="button">
                Request changes
              </button>
              <button id="resolve-findings" type="button">
                Mark findings resolved
              </button>
              <button id="approve-review" type="button" class="btn btn-primary">
                Approve review
              </button>
            </div>
            <output data-testid="review-result" aria-live="polite">
              Assign a lead reviewer to begin
            </output>
            <h4>Audit trail</h4>
            <ol id="review-audit-log" class="audit-log">
              <li>Draft created by Mei Lin</li>
            </ol>
          </section>
        </div>
      </div>
    </section>
  );
}
