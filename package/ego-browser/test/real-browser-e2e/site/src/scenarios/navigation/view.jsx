export default function NavigationSurface() {
  return (
    <section class="surface card knowledge-layout">
      <div class="knowledge-sidebar">
        <span>WORKSPACE / RETAIL LAUNCH</span>
        <strong>Research index</strong>
        <nav aria-label="Research sections">
          <button
            type="button"
            class="research-section active-doc"
            data-section="Overview"
            aria-selected="true"
          >
            Overview <small>12</small>
          </button>
          <button
            type="button"
            class="research-section"
            data-section="Customer signals"
            aria-selected="false"
          >
            Customer signals <small>08</small>
          </button>
          <button
            type="button"
            class="research-section"
            data-section="Market notes"
            aria-selected="false"
          >
            Market notes <small>17</small>
          </button>
          <button
            type="button"
            class="research-section"
            data-section="Decisions"
            aria-selected="false"
          >
            Decisions <small>05</small>
          </button>
        </nav>
        <p class="mb-0">
          Active: <output data-testid="navigation-section">Overview</output>
        </p>
        <p>Last indexed 4 minutes ago</p>
      </div>
      <div class="knowledge-content">
        <div class="scenario-toolbar">
          <div>
            <span>PINNED REFERENCES</span>
            <strong>Continue from the current context</strong>
          </div>
          <label>
            Decision route
            <select
              class="form-select form-select-sm"
              defaultValue=""
              onchange="if(this.value) location.href='/tests/navigation/destination?source='+encodeURIComponent(this.value)"
            >
              <option value="" disabled>
                Choose route
              </option>
              <option value="select">Decision record</option>
            </select>
          </label>
        </div>
        <section class="section-browser" aria-label="Current knowledge section">
          <div class="section-browser-heading">
            <div>
              <span>CURRENT SECTION</span>
              <strong data-testid="section-heading">Overview</strong>
            </div>
            <div class="input-group input-group-sm knowledge-search">
              <input
                id="knowledge-search"
                class="form-control"
                aria-label="Search current section"
                placeholder="Filter records"
              />
              <button id="clear-knowledge-search" type="button" class="btn btn-outline-secondary">
                Clear knowledge search
              </button>
            </div>
          </div>
          <div data-testid="section-records" class="section-records" />
          <small>
            <output data-testid="section-result-count">3</output> records shown
          </small>
        </section>
        <form action="/tests/navigation/destination" method="get">
          <input type="hidden" name="source" value="enter" />
          <label>
            Open decision record
            <input class="form-control" name="reference" value="DR-024" />
          </label>
        </form>
        <div class="reference-list">
          <a
            id="same-page-link"
            class="reference-row"
            href="/tests/navigation/destination?source=click"
          >
            <span>01</span>
            <div>
              <small>INTERNAL NOTE · 6 MIN</small>
              <strong>Navigate to the launch decision record</strong>
              <p>
                Open this reference in the current workspace and preserve the
                reading trail.
              </p>
            </div>
            <i>→</i>
          </a>
          <a
            id="new-page-link"
            class="reference-row"
            href="/tests/navigation/destination?source=new-page"
            target="_blank"
            rel="noreferrer"
          >
            <span>02</span>
            <div>
              <small>INDEPENDENT RESEARCH · 9 MIN</small>
              <strong>Open the material benchmark separately</strong>
              <p>
                Keep the current index visible while reviewing a second source.
              </p>
            </div>
            <i>↗</i>
          </a>
        </div>
      </div>
    </section>
  );
}
