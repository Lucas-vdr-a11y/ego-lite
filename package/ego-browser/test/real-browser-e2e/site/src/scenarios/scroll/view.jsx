export default function ScrollSurface() {
  return (
    <section class="surface card journal-layout">
      <article class="journal-article">
        <p class="surface-label">DESIGN FIELD JOURNAL / SINGAPORE</p>
        <h2>What shade teaches us about public space</h2>
        <p class="article-lede">
          A morning walk through five sheltered courtyards reveals how small
          decisions around airflow, sound, and material make a city feel
          generous.
        </p>
        <div class="article-figure">
          <span>07:40 / TIONG BAHRU</span>
          <strong>Light arrives indirectly.</strong>
        </div>
        <p>
          At the first courtyard, movement slows without a sign asking anyone to
          slow down. A line of deep columns frames the path and turns the
          ordinary act of crossing into a sequence of short rooms.
        </p>
        <p>
          The useful detail is not the column itself. It is the interval: enough
          room for two people to pass, enough shadow to make stopping
          comfortable, and enough visibility to keep the next space legible.
        </p>
        <blockquote>
          Comfort is often the result of relationships, not objects.
        </blockquote>
        <p>
          Further along, planted edges absorb the harder sounds from the street.
          Benches face across the path instead of toward it, creating accidental
          stages for everyday life.
        </p>
        <div id="document-marker" class="document-marker">
          <span>END NOTE / 05</span>
          <strong>Document marker reached</strong>
        </div>
      </article>
      <aside class="journal-rail">
        <div class="panel-heading">
          <span>FIELD ACTIVITY</span>
          <small>Independent scroll region</small>
        </div>
        <div id="nested-scroll" class="nested-scroll">
          <article
            data-activity-name="Courtyard entry"
            data-activity-detail="Indirect light and a deep threshold slow the courtyard entry."
            role="button"
            tabindex="0"
            aria-label="Open Courtyard entry activity"
          >
            <span>07:40</span>
            <strong>Courtyard entry</strong>
            <p>Indirect light and deep threshold.</p>
          </article>
          <article
            data-activity-name="Covered linkway"
            data-activity-detail="Cross breeze was recorded at both ends of the linkway."
            role="button"
            tabindex="0"
            aria-label="Open Covered linkway activity"
          >
            <span>08:05</span>
            <strong>Covered linkway</strong>
            <p>Cross breeze recorded at both ends.</p>
          </article>
          <article
            data-activity-name="Market edge"
            data-activity-detail="Street sound falls sharply behind the planting edge."
            role="button"
            tabindex="0"
            aria-label="Open Market edge activity"
          >
            <span>08:32</span>
            <strong>Market edge</strong>
            <p>Sound falls sharply behind planting.</p>
          </article>
          <article
            data-activity-name="Community room"
            data-activity-detail="The community room doors remain fully open before noon."
            role="button"
            tabindex="0"
            aria-label="Open Community room activity"
          >
            <span>09:10</span>
            <strong>Community room</strong>
            <p>Doors remain fully open before noon.</p>
          </article>
          <article
            data-activity-name="Final marker"
            data-activity-detail="The final observation closes the five-stop field walk."
            role="button"
            tabindex="0"
            aria-label="Open Final marker activity"
          >
            <span>09:46</span>
            <strong>Final marker</strong>
            <p id="nested-marker">Nested marker reached</p>
          </article>
        </div>
        <div class="d-flex align-items-center justify-content-between gap-2 mt-3">
          <div
            class="btn-group btn-group-sm"
            role="group"
            aria-label="Activity navigation"
          >
            <button
              id="previous-activity"
              type="button"
              class="btn btn-outline-secondary"
              disabled
            >
              Previous activity
            </button>
            <button
              id="next-activity"
              type="button"
              class="btn btn-outline-secondary"
            >
              Next activity
            </button>
          </div>
          <output data-testid="active-activity" class="small fw-semibold">
            Courtyard entry
          </output>
        </div>
        <p class="rail-position">
          <span>
            TIMELINE POSITION <output data-testid="nested-scroll-top">0</output>{" "}
            PX
          </span>
          <button
            id="reset-timeline"
            type="button"
            class="btn btn-sm btn-outline-secondary"
          >
            Reset timeline
          </button>
        </p>
        <div class="activity-review">
          <p data-testid="activity-detail">
            Indirect light and a deep threshold slow the courtyard entry.
          </p>
          <button
            id="review-activity"
            type="button"
            class="btn btn-sm btn-primary"
          >
            Mark activity reviewed
          </button>
          <span>
            Reviewed <output data-testid="reviewed-activity-count">0</output> /
            5
          </span>
        </div>
        <p class="small text-secondary mb-0">
          Reading progress: <output data-testid="reading-progress">0</output>%
        </p>
      </aside>
    </section>
  );
}
