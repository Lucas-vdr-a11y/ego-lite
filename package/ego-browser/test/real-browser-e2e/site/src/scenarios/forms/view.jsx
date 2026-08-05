export default function FormsSurface() {
  return (
    <section class="surface card request-layout">
      <form id="request-form" class="request-form" novalidate>
        <div class="scenario-toolbar">
          <div>
            <span>NEW REQUEST / CREATIVE SERVICES</span>
            <strong>Launch support brief</strong>
          </div>
          <span class="draft-badge">DRAFT SAVED</span>
        </div>
        <div class="form-fields">
          <label>
            Project name
            <input
              id="text-input"
              class="form-control"
              placeholder="e.g. Autumn retail launch"
            />
          </label>
          <label>
            Priority
            <select id="priority-select" class="form-select">
              <option value="normal">Normal · 10 days</option>
              <option value="high">High · 5 days</option>
              <option value="urgent">Urgent · 48 hours</option>
            </select>
          </label>
          <label>
            Target date
            <input id="target-date" class="form-control" type="date" />
          </label>
          <label class="wide-field">
            What do you need?
            <textarea
              id="notes-input"
              class="form-control"
              placeholder="Give the team enough context to start well."
            />
            <small class="form-text text-secondary">
              <output data-testid="brief-character-count">0</output> characters
              · minimum 20
            </small>
          </label>
          <fieldset>
            <legend>Delivery plan</legend>
            <label class="check-row">
              <input
                class="form-check-input"
                type="radio"
                name="plan"
                value="basic"
                checked
              />{" "}
              Focused deliverable
            </label>
            <label class="check-row">
              <input
                class="form-check-input"
                type="radio"
                name="plan"
                value="pro"
              />{" "}
              Full campaign system
            </label>
          </fieldset>
          <label class="approval-box">
            <input
              id="approval-checkbox"
              class="form-check-input"
              type="checkbox"
            />
            <span>
              <strong>Budget owner approved</strong>
              <small>Required before scheduling</small>
            </span>
          </label>
          <fieldset class="wide-field stakeholder-editor">
            <legend>Stakeholders</legend>
            <div class="stakeholder-fields">
              <label>
                Stakeholder name
                <input id="stakeholder-name" class="form-control" />
              </label>
              <label>
                Stakeholder email
                <input
                  id="stakeholder-email"
                  class="form-control"
                  type="email"
                />
              </label>
              <label>
                Stakeholder role
                <select id="stakeholder-role" class="form-select">
                  <option>Product</option>
                  <option>Marketing</option>
                  <option>Operations</option>
                </select>
              </label>
            </div>
            <button
              id="add-stakeholder"
              type="button"
              class="btn btn-outline-secondary secondary-action"
            >
              Add stakeholder
            </button>
            <output
              data-testid="stakeholder-error"
              class="form-text text-danger"
              role="status"
            />
          </fieldset>
        </div>
      </form>
      <aside class="form-readback" aria-label="Request summary">
        <div class="panel-heading">
          <span>REQUEST SUMMARY</span>
          <small>Updates as you type</small>
        </div>
        <p>
          <span>text</span>
          <output data-testid="form-text">—</output>
        </p>
        <p>
          <span>notes</span>
          <output data-testid="form-notes">—</output>
        </p>
        <p>
          <span>priority</span>
          <output data-testid="form-priority">normal</output>
        </p>
        <p>
          <span>approved</span>
          <output data-testid="form-approved">false</output>
        </p>
        <p>
          <span>plan</span>
          <output data-testid="form-plan">basic</output>
        </p>
        <div class="summary-section">
          <span>stakeholders</span>
          <div data-testid="stakeholder-list">No stakeholders added</div>
        </div>
        <p>
          <span>schedule</span>
          <output data-testid="form-schedule">Not scheduled</output>
        </p>
        <output class="workflow-result" data-testid="form-result" role="status">
          Ready to validate
        </output>
        <button
          type="submit"
          form="request-form"
          class="btn btn-primary primary-action summary-submit"
        >
          Submit for scheduling
        </button>
        <button
          id="reset-request"
          type="button"
          class="btn btn-outline-secondary summary-submit"
        >
          Reset request
        </button>
      </aside>
    </section>
  );
}
