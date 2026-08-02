import Stat from "../../components/stat.jsx";

export default function CanvasSurface() {
  return (
    <section class="surface card review-canvas-layout">
      <div class="review-document">
        <div class="canvas-toolbar">
          <div
            class="btn-group btn-group-sm"
            role="group"
            aria-label="Drawing tools"
          >
            <button
              type="button"
              data-canvas-tool="pencil"
              class="btn btn-outline-secondary"
              aria-pressed="false"
            >
              Pencil
            </button>
            <button
              type="button"
              data-canvas-tool="pen"
              class="btn btn-outline-secondary active-tool"
              aria-pressed="true"
            >
              Pen
            </button>
            <button
              type="button"
              data-canvas-tool="brush"
              class="btn btn-outline-secondary"
              aria-pressed="false"
            >
              Brush
            </button>
            <button
              type="button"
              data-canvas-tool="marker"
              class="btn btn-outline-secondary"
              aria-pressed="false"
            >
              Marker
            </button>
            <button
              type="button"
              data-canvas-tool="eraser"
              class="btn btn-outline-secondary"
              aria-pressed="false"
            >
              Eraser
            </button>
          </div>
          <div class="canvas-controls" role="group" aria-label="Brush settings">
            <label class="canvas-control">
              <span>Color</span>
              <input
                id="canvas-color"
                class="form-control form-control-color"
                type="color"
                value="#2563eb"
                aria-label="Brush color"
              />
            </label>
            <label class="canvas-control">
              <span>Size</span>
              <select
                id="canvas-brush-size"
                class="form-select form-select-sm"
                aria-label="Brush size"
              >
                <option value="2">2 px</option>
                <option value="4">4 px</option>
                <option value="8" selected>
                  8 px
                </option>
                <option value="12">12 px</option>
                <option value="16">16 px</option>
                <option value="18">18 px</option>
                <option value="24">24 px</option>
                <option value="36">36 px</option>
              </select>
            </label>
          </div>
          <div
            class="btn-group btn-group-sm canvas-action-group"
            role="group"
            aria-label="Review actions"
          >
            <button
              id="undo-canvas"
              class="btn btn-outline-secondary canvas-icon-action"
              aria-label="Undo last stroke"
              title="Undo last stroke"
              disabled
            >
              <span aria-hidden="true">↶</span>
            </button>
            <button
              id="redo-canvas"
              class="btn btn-outline-secondary canvas-icon-action"
              aria-label="Redo stroke"
              title="Redo stroke"
              disabled
            >
              <span aria-hidden="true">↷</span>
            </button>
            <button
              id="save-canvas"
              class="btn btn-outline-secondary canvas-icon-action"
              aria-label="Save review"
              title="Save review"
              disabled
            >
              <span aria-hidden="true">✓</span>
            </button>
            <button
              id="restore-canvas"
              class="btn btn-outline-secondary canvas-icon-action"
              aria-label="Restore saved review"
              title="Restore saved review"
              disabled
            >
              <span aria-hidden="true">↺</span>
            </button>
            <button
              id="clear-canvas"
              class="btn btn-outline-secondary canvas-icon-action"
              aria-label="Clear markup"
              title="Clear markup"
              disabled
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div
            class="btn-group btn-group-sm canvas-export-actions"
            role="group"
            aria-label="Export actions"
          >
            <button
              id="export-canvas-png"
              class="btn btn-outline-secondary canvas-export-action"
              aria-label="Export PNG"
              disabled
            >
              PNG
            </button>
            <button
              id="export-canvas-svg"
              class="btn btn-outline-secondary canvas-export-action"
              aria-label="Export SVG"
              disabled
            >
              SVG
            </button>
          </div>
        </div>
        <div class="canvas-wrap">
          <div
            id="whiteboard-stage"
            class="whiteboard-stage"
            data-testid="whiteboard-stage"
            data-background="dot-grid"
            aria-label="Dot-grid review whiteboard"
            role="img"
          />
          <span>DOT GRID / POINTER + TOUCH</span>
        </div>
      </div>
      <aside class="canvas-sidebar">
        <div class="panel-heading">
          <span>WHITEBOARD STATE</span>
          <small>Vector strokes · Editable</small>
        </div>
        <Stat label="strokes" value="0" testId="canvas-strokes" />
        <Stat label="sampled points" value="0" testId="canvas-points" />
        <Stat label="active tool" value="Pen" testId="canvas-tool" />
        <Stat label="brush size" value="8 px" testId="canvas-brush-size" />
        <Stat
          label="save status"
          value="Not saved"
          testId="canvas-save-status"
        />
        <Stat
          label="export status"
          value="Not exported"
          testId="canvas-export-status"
        />
        <div class="review-comment">
          <i>JW</i>
          <p>
            <strong>Draw naturally</strong>
            <span>
              Use pencil, pen, brush or marker, then export the result.
            </span>
          </p>
        </div>
        <div class="review-comment">
          <i>AM</i>
          <p>
            <strong>Input coverage</strong>
            <span>The same surface accepts mouse, stylus and touch input.</span>
          </p>
        </div>
      </aside>
    </section>
  );
}
