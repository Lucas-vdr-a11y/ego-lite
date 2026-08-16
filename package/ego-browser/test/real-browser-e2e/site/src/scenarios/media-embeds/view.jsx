export default function MediaEmbedsSurface() {
  return (
    <section class="surface card media-embeds-review">
      <article aria-labelledby="venue-media-title">
        <header>
          <p class="eyebrow">APAC venue launch / evidence desk</p>
          <h2 id="venue-media-title">Venue media readiness review</h2>
          <p>
            Review both mapped venue zones, play the dispatcher evidence, and
            confirm each embedded compliance document before approval.
          </p>
        </header>

        <div class="media-evidence-grid">
          <section aria-labelledby="venue-plan-heading">
            <h3 id="venue-plan-heading">Venue plan</h3>
            <picture>
              <source
                media="(max-width: 48rem)"
                srcSet="/tests/media-embeds/floor-plan-compact.svg"
              />
              <img
                src="/tests/media-embeds/floor-plan-wide.svg"
                alt="APAC launch venue floor plan"
                width="600"
                height="300"
                useMap="#venue-zones"
                data-venue-plan
              />
            </picture>
            <map name="venue-zones">
              <area
                shape="rect"
                coords="0,0,300,300"
                href="#stage-zone"
                alt="Review Singapore stage zone"
              />
              <area
                shape="rect"
                coords="300,0,600,300"
                href="#loading-zone"
                alt="Review Shanghai loading zone"
              />
            </map>
            <div class="venue-zone-notes">
              <section id="stage-zone" tabIndex="-1">
                <h4>Singapore stage zone</h4>
                <p>Audience routes and emergency exits are unobstructed.</p>
              </section>
              <section id="loading-zone" tabIndex="-1">
                <h4>Shanghai loading zone</h4>
                <p>Vehicle access and overnight lighting are confirmed.</p>
              </section>
            </div>
            <output data-testid="zone-review-status" aria-live="polite">
              0 of 2 venue zones reviewed
            </output>
          </section>

          <section aria-labelledby="briefing-heading">
            <h3 id="briefing-heading">Timed briefings</h3>
            <label for="dispatcher-audio">Dispatcher audio note</label>
            <audio
              id="dispatcher-audio"
              aria-label="Dispatcher audio note"
              controls
              preload="metadata"
            >
              <source
                src="/tests/media-embeds/dispatcher-note.ogg"
                type="audio/ogg"
              />
            </audio>
            <output data-testid="audio-review-status" aria-live="polite">
              Audio briefing pending
            </output>

            <label for="loading-video">Loading bay camera</label>
            <video
              id="loading-video"
              aria-label="Loading bay camera"
              controls
              muted
              preload="metadata"
              poster="/tests/media-embeds/floor-plan-wide.svg"
            >
              <source
                src="/tests/media-embeds/loading-bay.webm"
                type="video/webm"
              />
              <track
                kind="captions"
                srcLang="en"
                label="English"
                src="/tests/media-embeds/loading-bay.vtt"
                default
              />
            </video>
            <output data-testid="video-review-status" aria-live="polite">
              Video briefing pending
            </output>
          </section>

          <section class="embedded-evidence" aria-labelledby="embedded-heading">
            <h3 id="embedded-heading">Embedded compliance evidence</h3>
            <iframe
              title="Safety checklist"
              src="/tests/media-embeds/safety-checklist"
            ></iframe>
            <object
              name="customs-receipt"
              title="Customs receipt"
              data="/tests/media-embeds/customs-receipt"
              type="text/html"
            >
              <a href="/tests/media-embeds/customs-receipt">
                Open the customs receipt
              </a>
            </object>
            <embed
              name="insurance-certificate"
              title="Insurance certificate"
              src="/tests/media-embeds/insurance-certificate"
              type="text/html"
            />
            <fencedframe title="Privacy-safe regional offer"></fencedframe>
            <output data-testid="embed-review-status" aria-live="polite">
              0 of 3 documents confirmed
            </output>
          </section>
        </div>

        <section
          class="media-approval"
          aria-labelledby="media-decision-heading"
        >
          <h3 id="media-decision-heading">Venue decision</h3>
          <button type="button" data-approve-media disabled>
            Approve venue media
          </button>
          <p data-testid="media-review-status" aria-live="polite">
            Complete every media review before approval
          </p>
        </section>
      </article>
    </section>
  );
}
