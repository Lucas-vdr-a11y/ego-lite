export default function ScrollSurface() {
  return (
    <section class="surface journal-layout">
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
          <article>
            <span>07:40</span>
            <strong>Courtyard entry</strong>
            <p>Indirect light and deep threshold.</p>
          </article>
          <article>
            <span>08:05</span>
            <strong>Covered linkway</strong>
            <p>Cross breeze recorded at both ends.</p>
          </article>
          <article>
            <span>08:32</span>
            <strong>Market edge</strong>
            <p>Sound falls sharply behind planting.</p>
          </article>
          <article>
            <span>09:10</span>
            <strong>Community room</strong>
            <p>Doors remain fully open before noon.</p>
          </article>
          <article>
            <span>09:46</span>
            <strong>Final marker</strong>
            <p id="nested-marker">Nested marker reached</p>
          </article>
        </div>
        <p class="rail-position">
          TIMELINE POSITION <output data-testid="nested-scroll-top">0</output>{" "}
          PX
        </p>
      </aside>
    </section>
  );
}
