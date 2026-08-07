import Stat from "../../components/stat.jsx";

import {
  ALL_TARGETS,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  PRECISION_CHIPS,
  PRIMARY_TARGETS,
  swatchColor,
} from "./targets.mjs";

function Swatch({ target }) {
  return (
    <div class="visual-cell" style={`margin-left:${target.gap}px`}>
      <button
        type="button"
        id={`swatch-${target.id}`}
        class="visual-swatch"
        data-target-id={target.id}
        data-state="pending"
        aria-label={`${target.label} calibration target`}
        style={`width:${target.width}px;height:${target.height}px;background:${swatchColor(target.pending)}`}
      />
      <span class="visual-caption">
        {target.label} · {target.width}×{target.height}
      </span>
    </div>
  );
}

export default function VisualPathSurface() {
  return (
    <section class="surface card visual-path-layout">
      <div class="visual-stack">
        <section class="visual-block">
          <div class="panel-heading">
            <span>01 / PRIMARY TARGETS</span>
            <small>Uneven sizes and gaps</small>
          </div>
          <p class="visual-note">
            Each swatch carries its own gray. Hitting one repaints it to a
            second gray, so the image itself reports the result.
          </p>
          <div class="visual-row" data-testid="primary-targets">
            {PRIMARY_TARGETS.map((target) => (
              <Swatch target={target} />
            ))}
          </div>
        </section>

        <section class="visual-block">
          <div class="panel-heading">
            <span>02 / PRECISION CHIPS</span>
            <small>40px down to 8px</small>
          </div>
          <p class="visual-note">
            The small chips fail first when a coordinate is off by a pixel or
            two.
          </p>
          <div class="visual-row" data-testid="precision-chips">
            {PRECISION_CHIPS.map((chip) => (
              <Swatch target={chip} />
            ))}
          </div>
        </section>

        <section class="visual-block">
          <div class="panel-heading">
            <span>03 / CANVAS STAGE</span>
            <small>No structure to read</small>
          </div>
          <p class="visual-note">
            The stage exposes no elements at all. Press and drag to leave a
            stroke; the drawn pixels are the only record.
          </p>
          <canvas
            id="visual-canvas"
            class="visual-canvas"
            data-testid="visual-canvas"
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            aria-label="Calibration drawing stage"
          />
        </section>
      </div>

      <aside class="stat-stack visual-panel" aria-label="Aim readback">
        <div class="panel-heading">
          <span>AIM READBACK</span>
          <small>Reported by the page</small>
        </div>
        <Stat
          label="targets hit"
          value={`0 / ${ALL_TARGETS.length}`}
          testId="visual-targets-done"
        />
        <Stat label="clicks" value="0" testId="visual-click-count" />
        <Stat label="misses" value="0" testId="visual-miss-count" />
        <Stat label="canvas strokes" value="0" testId="visual-canvas-strokes" />
        <p class="activity-note mb-2">
          Last click:{" "}
          <output data-testid="visual-last-click">No click yet</output>
        </p>
        <p class="activity-note mb-2">
          Environment: <output data-testid="visual-viewport">unmeasured</output>
        </p>
        <button
          id="reset-visual"
          type="button"
          class="btn btn-sm btn-outline-secondary"
        >
          Reset targets
        </button>
        <p class="activity-note">
          Every click leaves a red ring and crosshair at the pixel it landed on.
          A dashed ring means the click hit nothing.
        </p>
      </aside>
    </section>
  );
}
