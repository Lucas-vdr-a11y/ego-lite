import Stat from "../../components/stat.jsx";

export default function ClicksSurface() {
  return (
    <section class="surface card operations-layout">
      <div class="queue-panel">
        <div class="scenario-toolbar">
          <div>
            <span>FULFILMENT / TODAY</span>
            <strong>5 orders need attention</strong>
          </div>
          <button
            id="filter-orders"
            class="btn btn-sm btn-outline-secondary quiet-action"
            aria-pressed="false"
          >
            Show all orders
          </button>
        </div>
        <div class="order-list" aria-label="Orders awaiting dispatch">
          <button
            type="button"
            class="order-row muted-row"
            data-order-id="EG-1839"
            data-order-location="Singapore"
            data-order-status="Ready"
            aria-label="Select order EG-1839"
          >
            <span>EG-1839</span>
            <strong>Paper lamp</strong>
            <small>Singapore · Ready</small>
            <i>08:42</i>
          </button>
          <button
            type="button"
            class="order-row selected-row"
            data-order-id="EG-1842"
            data-order-location="Shanghai"
            data-order-status="Ready"
            aria-label="Select order EG-1842"
            aria-selected="true"
          >
            <span>EG-1842</span>
            <strong>Arc desk set</strong>
            <small>Shanghai · Ready</small>
            <i>09:16</i>
          </button>
          <button
            type="button"
            class="order-row"
            data-order-id="EG-1846"
            data-order-location="Tokyo"
            data-order-status="Ready"
            aria-label="Select order EG-1846"
            aria-selected="false"
          >
            <span>EG-1846</span>
            <strong>Field notebook × 3</strong>
            <small>Tokyo · Ready</small>
            <i>09:31</i>
          </button>
          <button
            type="button"
            class="order-row muted-row"
            data-order-id="EG-1851"
            data-order-location="Seoul"
            data-order-status="On hold"
            aria-label="Select order EG-1851"
            aria-selected="false"
            data-testid="held-order"
            hidden
          >
            <span>EG-1851</span>
            <strong>Oak tray</strong>
            <small>Seoul · On hold</small>
            <i>09:48</i>
          </button>
        </div>
        <div class="queue-actions">
          <p>
            <span class="selection-dot" /> Order{" "}
            <output data-testid="selected-order">EG-1842</output> ·{" "}
            <output data-testid="selected-order-status">Ready</output>
          </p>
          <div class="position-relative">
            <button
              id="context-target"
              class="btn btn-outline-secondary context-target"
              aria-haspopup="menu"
              aria-expanded="false"
            >
              More actions
            </button>
            <div
              class="dropdown-menu p-2"
              role="menu"
              data-testid="order-menu"
              hidden
            >
              <button
                id="hold-order"
                type="button"
                class="dropdown-item rounded-1"
                role="menuitem"
              >
                Place selected order on hold
              </button>
            </div>
          </div>
          <button id="click-target" class="btn btn-primary primary-action">
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
        <Stat label="visible orders" value="3" testId="visible-order-count" />
        <button
          id="event-probe"
          type="button"
          class="btn btn-sm btn-outline-secondary"
        >
          Test click events
        </button>
        <p class="activity-note mb-2">
          Result: <output data-testid="order-result">No action yet</output>
        </p>
        <button
          id="reset-clicks"
          type="button"
          class="btn btn-sm btn-outline-secondary"
        >
          Reset activity
        </button>
        <p class="activity-note">
          The event probe records click semantics without changing an order.
          Secondary click opens the selected order context.
        </p>
      </aside>
    </section>
  );
}
