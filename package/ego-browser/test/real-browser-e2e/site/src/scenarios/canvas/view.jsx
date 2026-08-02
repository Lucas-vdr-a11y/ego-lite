import Stat from "../../components/stat.jsx";

export default function CanvasSurface() {
  return (
    <section class="surface review-canvas-layout">
      <div class="review-document">
        <div class="canvas-toolbar">
          <div>
            <button class="tool-button active-tool" aria-label="Coral pen">
              ●
            </button>
            <button class="tool-button" aria-label="Dark pen">
              ●
            </button>
            <button class="tool-button" aria-label="Highlighter">
              ▰
            </button>
          </div>
          <span>Homepage / revision 08</span>
          <button id="clear-canvas" class="quiet-action">
            Clear markup
          </button>
        </div>
        <div class="canvas-wrap">
          <div class="mock-layout" aria-hidden="true">
            <span>NEW COLLECTION / 2026</span>
            <strong>Objects for slower rooms.</strong>
            <i>Explore collection →</i>
            <div />
          </div>
          <canvas id="draw-canvas" width="960" height="480" />
          <span>ANNOTATION LAYER / 960 × 480</span>
        </div>
      </div>
      <aside class="canvas-sidebar">
        <div class="panel-heading">
          <span>REVIEW NOTES</span>
          <small>Revision 08 · Unsaved</small>
        </div>
        <Stat label="strokes" value="0" testId="canvas-strokes" />
        <Stat label="sampled points" value="0" testId="canvas-points" />
        <div class="review-comment">
          <i>JW</i>
          <p>
            <strong>Hero hierarchy</strong>
            <span>Mark the point where the headline should turn.</span>
          </p>
        </div>
        <div class="review-comment">
          <i>AM</i>
          <p>
            <strong>Primary action</strong>
            <span>Check contrast around the collection link.</span>
          </p>
        </div>
      </aside>
    </section>
  );
}
