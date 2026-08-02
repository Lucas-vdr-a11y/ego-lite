import Stat from "../../components/stat.jsx";

export default function HoverSurface() {
  return (
    <section class="surface card product-layout">
      <div class="product-browser">
        <div class="scenario-toolbar">
          <div>
            <span>MATERIAL LIBRARY / 04</span>
            <strong>Autumn surfaces</strong>
          </div>
          <span class="toolbar-note">Curated by tone</span>
        </div>
        <div class="product-grid">
          <article
            id="hover-target"
            class="product-tile product-clay"
            data-material-id="M-042"
            data-material-name="Burnt clay"
            data-material-finish="Powder-coated aluminium"
            data-material-durability="Commercial grade"
            data-material-lead-time="4 weeks"
            tabindex="0"
            aria-label="Preview Burnt clay"
          >
            <span class="product-code">M-042</span>
            <div class="swatch-mark">ARC</div>
            <div class="product-copy">
              <strong>Burnt clay</strong>
              <small>Powder-coated aluminium</small>
            </div>
            <div class="hover-reveal">
              <button
                id="pin-material"
                data-pin-material
                type="button"
                aria-label="Pin Burnt clay"
                aria-pressed="false"
              >
                Pin material
              </button>
            </div>
          </article>
          <article
            class="product-tile product-moss"
            data-material-id="M-051"
            data-material-name="Wet moss"
            data-material-finish="Woven upholstery"
            data-material-durability="80,000 rubs"
            data-material-lead-time="6 weeks"
            tabindex="0"
            aria-label="Preview Wet moss"
          >
            <span class="product-code">M-051</span>
            <div class="swatch-mark">FOLD</div>
            <div class="product-copy">
              <strong>Wet moss</strong>
              <small>Woven upholstery</small>
            </div>
            <div class="hover-reveal">
              <button
                type="button"
                data-pin-material
                aria-label="Pin Wet moss"
                aria-pressed="false"
              >
                Pin material
              </button>
            </div>
          </article>
          <article
            class="product-tile product-oat"
            data-material-id="M-067"
            data-material-name="Warm oat"
            data-material-finish="Recycled composite"
            data-material-durability="Indoor / light use"
            data-material-lead-time="3 weeks"
            tabindex="0"
            aria-label="Preview Warm oat"
          >
            <span class="product-code">M-067</span>
            <div class="swatch-mark">LINE</div>
            <div class="product-copy">
              <strong>Warm oat</strong>
              <small>Recycled composite</small>
            </div>
            <div class="hover-reveal">
              <button
                type="button"
                data-pin-material
                aria-label="Pin Warm oat"
                aria-pressed="false"
              >
                Pin material
              </button>
            </div>
          </article>
        </div>
      </div>
      <aside class="stat-stack product-inspector">
        <div class="panel-heading">
          <span>PREVIEW SIGNAL</span>
          <small data-testid="hover-preview">Burnt clay · M-042</small>
        </div>
        <Stat label="pointer state" value="outside" testId="hover-state" />
        <Stat label="entries" value="0" testId="hover-entries" />
        <Stat label="moves" value="0" testId="hover-moves" />
        <Stat label="selection" value="None" testId="hover-selection" />
        <Stat
          label="finish"
          value="Powder-coated aluminium"
          testId="material-finish"
        />
        <Stat
          label="durability"
          value="Commercial grade"
          testId="material-durability"
        />
        <Stat label="lead time" value="4 weeks" testId="material-lead-time" />
        <div class="comparison-tray">
          <strong>Comparison</strong>
          <div data-testid="material-comparison">No materials pinned</div>
        </div>
        <p class="activity-note">
          Move across the first material to reveal its specification shortcut.
        </p>
      </aside>
    </section>
  );
}
