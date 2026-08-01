export default function NavigationSurface() {
  return (
    <section class="surface knowledge-layout">
      <div class="knowledge-sidebar">
        <span>WORKSPACE / RETAIL LAUNCH</span>
        <strong>Research index</strong>
        <nav>
          <a class="active-doc" href="#">
            Overview <small>12</small>
          </a>
          <a href="#">
            Customer signals <small>08</small>
          </a>
          <a href="#">
            Market notes <small>17</small>
          </a>
          <a href="#">
            Decisions <small>05</small>
          </a>
        </nav>
        <p>Last indexed 4 minutes ago</p>
      </div>
      <div class="knowledge-content">
        <div class="scenario-toolbar">
          <div>
            <span>PINNED REFERENCES</span>
            <strong>Continue from the current context</strong>
          </div>
          <button class="quiet-action">+ New reference</button>
        </div>
        <div class="reference-list">
          <a
            id="same-page-link"
            class="reference-row"
            href="/tests/navigation/destination"
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
