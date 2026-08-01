export default function FormsSurface() {
  return (
    <section class="surface request-layout">
      <div class="request-form">
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
            <input id="text-input" placeholder="e.g. Autumn retail launch" />
          </label>
          <label>
            Priority
            <select id="priority-select">
              <option value="normal">Normal · 10 days</option>
              <option value="high">High · 5 days</option>
              <option value="urgent">Urgent · 48 hours</option>
            </select>
          </label>
          <label class="wide-field">
            What do you need?
            <textarea
              id="notes-input"
              placeholder="Give the team enough context to start well."
            />
          </label>
          <fieldset>
            <legend>Delivery plan</legend>
            <label class="check-row">
              <input type="radio" name="plan" value="basic" checked /> Focused
              deliverable
            </label>
            <label class="check-row">
              <input type="radio" name="plan" value="pro" /> Full campaign
              system
            </label>
          </fieldset>
          <label class="approval-box">
            <input id="approval-checkbox" type="checkbox" />
            <span>
              <strong>Budget owner approved</strong>
              <small>Required before scheduling</small>
            </span>
          </label>
          <button id="toggle-dynamic" class="secondary-action">
            Add stakeholder
          </button>
        </div>
      </div>
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
        <div id="dynamic-slot" />
        <button class="primary-action summary-submit">
          Submit for scheduling
        </button>
      </aside>
    </section>
  );
}
