import Stat from "../../components/stat.jsx";

export default function HoverSurface() {
  return (
    <section class="surface product-layout">
      <div class="product-browser">
        <div class="scenario-toolbar">
          <div>
            <span>MATERIAL LIBRARY / 04</span>
            <strong>Autumn surfaces</strong>
          </div>
          <button class="quiet-action">Sort by tone</button>
        </div>
        <div class="product-grid">
          <article id="hover-target" class="product-tile product-clay">
            <span class="product-code">M-042</span>
            <div class="swatch-mark">ARC</div>
            <div class="product-copy">
              <strong>Burnt clay</strong>
              <small>Powder-coated aluminium</small>
            </div>
            <div class="hover-reveal">
              <span>VIEW SPECIFICATION</span>
              <i>↗</i>
            </div>
          </article>
          <article class="product-tile product-moss">
            <span class="product-code">M-051</span>
            <div class="swatch-mark">FOLD</div>
            <div class="product-copy">
              <strong>Wet moss</strong>
              <small>Woven upholstery</small>
            </div>
          </article>
          <article class="product-tile product-oat">
            <span class="product-code">M-067</span>
            <div class="swatch-mark">LINE</div>
            <div class="product-copy">
              <strong>Warm oat</strong>
              <small>Recycled composite</small>
            </div>
          </article>
        </div>
      </div>
      <aside class="stat-stack product-inspector">
        <div class="panel-heading">
          <span>PREVIEW SIGNAL</span>
          <small>Burnt clay / M-042</small>
        </div>
        <Stat label="pointer state" value="outside" testId="hover-state" />
        <Stat label="entries" value="0" testId="hover-entries" />
        <Stat label="moves" value="0" testId="hover-moves" />
        <p class="activity-note">
          Move across the first material to reveal its specification shortcut.
        </p>
      </aside>
    </section>
  );
}
