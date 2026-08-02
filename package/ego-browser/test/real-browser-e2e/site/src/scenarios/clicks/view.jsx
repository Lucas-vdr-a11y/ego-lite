import Stat from "../../components/stat.jsx";

export default function ClicksSurface() {
  return (
    <section class="surface operations-layout">
      <div class="queue-panel">
        <div class="scenario-toolbar">
          <div>
            <span>FULFILMENT / TODAY</span>
            <strong>5 orders need attention</strong>
          </div>
          <button class="quiet-action">Filter: Ready</button>
        </div>
        <div
          class="order-list"
          role="table"
          aria-label="Orders awaiting dispatch"
        >
          <div class="order-row muted-row" role="row">
            <span>EG-1839</span>
            <strong>Paper lamp</strong>
            <small>Singapore · Packed</small>
            <i>08:42</i>
          </div>
          <div class="order-row selected-row" role="row" aria-selected="true">
            <span>EG-1842</span>
            <strong>Arc desk set</strong>
            <small>Shanghai · Priority</small>
            <i>09:16</i>
          </div>
          <div class="order-row" role="row">
            <span>EG-1846</span>
            <strong>Field notebook × 3</strong>
            <small>Tokyo · Packed</small>
            <i>09:31</i>
          </div>
        </div>
        <div class="queue-actions">
          <p>
            <span class="selection-dot" /> Order EG-1842 selected
          </p>
          <button id="context-target" class="context-target">
            More actions
          </button>
          <button id="click-target" class="primary-action">
            Approve dispatch
          </button>
        </div>
      </div>
      <aside class="stat-stack activity-panel" aria-label="Dispatch activity">
        <div class="panel-heading">
          <span>LIVE ACTIVITY</span>
          <small>Browser event readback</small>
        </div>
        <Stat label="click events" value="0" testId="click-count" />
        <Stat
          label="double click events"
          value="0"
          testId="double-click-count"
        />
        <Stat
          label="context menu events"
          value="0"
          testId="right-click-count"
        />
        <p class="activity-note">
          Double-approve is accepted but tracked separately. Secondary click
          opens the order action context.
        </p>
      </aside>
    </section>
  );
}
