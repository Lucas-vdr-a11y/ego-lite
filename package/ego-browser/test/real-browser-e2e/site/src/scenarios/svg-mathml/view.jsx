const forecastPoints = [
  { week: 1, demand: 84, x: 100, y: 216 },
  { week: 2, demand: 96, x: 260, y: 178 },
  { week: 3, demand: 112, x: 420, y: 128 },
  { week: 4, demand: 129, x: 580, y: 76 },
];

export default function SvgMathmlSurface() {
  return (
    <section class="surface capacity-model" data-testid="capacity-model">
      <div class="capacity-chart-panel">
        <div class="scenario-toolbar">
          <div>
            <span>FULFILMENT / NEXT 4 WEEKS</span>
            <strong>Weekly shipment forecast</strong>
          </div>
          <output data-testid="capacity-risk-status">Risk not reviewed</output>
        </div>

        <div class="capacity-chart-frame">
          <svg
            viewBox="0 0 720 320"
            role="group"
            aria-label="Weekly shipment forecast"
            preserveAspectRatio="xMidYMid meet"
          >
            <title>Weekly shipment forecast</title>
            <desc>
              Four selectable weekly demand points and a capacity threshold at
              120 shipments.
            </desc>

            <g class="chart-grid" aria-hidden="true">
              <line x1="72" y1="256" x2="624" y2="256" />
              <line x1="72" y1="202" x2="624" y2="202" />
              <line x1="72" y1="148" x2="624" y2="148" />
              <line x1="72" y1="94" x2="624" y2="94" />
            </g>
            <g class="chart-axis-labels" aria-hidden="true">
              <text x="20" y="261">
                60
              </text>
              <text x="20" y="207">
                80
              </text>
              <text x="14" y="153">
                100
              </text>
              <text x="14" y="99">
                120
              </text>
              {forecastPoints.map((point) => (
                <text x={point.x} y="286" text-anchor="middle">
                  W{point.week}
                </text>
              ))}
            </g>

            <line
              class="capacity-threshold"
              x1="72"
              y1="94"
              x2="624"
              y2="94"
              aria-hidden="true"
            />
            <text
              class="capacity-threshold-label"
              x="624"
              y="116"
              text-anchor="end"
              aria-hidden="true"
            >
              CURRENT CAPACITY · 120
            </text>
            <path
              class="forecast-line"
              d="M100 216 L260 178 L420 128 L580 76"
              fill="none"
              aria-hidden="true"
            />

            {forecastPoints.map((point) => (
              <circle
                class={`forecast-point${point.week === 2 ? " is-selected" : ""}`}
                cx={point.x}
                cy={point.y}
                r="12"
                fill="none"
                role="button"
                tabindex="0"
                aria-label={`Review week ${point.week} forecast: ${point.demand} shipments`}
                aria-pressed={point.week === 2 ? "true" : "false"}
                data-forecast-week={point.week}
                data-forecast-demand={point.demand}
              />
            ))}

            <foreignObject x="398" y="222" width="286" height="72">
              <div
                xmlns="http://www.w3.org/1999/xhtml"
                class="capacity-risk-action"
              >
                <button
                  type="button"
                  class="btn btn-sm btn-outline-secondary"
                  aria-label="Acknowledge week 4 capacity risk"
                  aria-pressed="false"
                  data-capacity-risk-action
                >
                  Acknowledge week 4 capacity risk
                </button>
              </div>
            </foreignObject>
          </svg>
        </div>
      </div>

      <aside class="capacity-model-panel" aria-label="Capacity calculation">
        <div class="panel-heading">
          <span>SELECTED FORECAST</span>
          <small>Native SVG + MathML</small>
        </div>

        <dl class="capacity-selection">
          <div>
            <dt>Period</dt>
            <dd>
              <output data-testid="selected-forecast-week">Week 2</output>
            </dd>
          </div>
          <div>
            <dt>Demand</dt>
            <dd>
              <output data-testid="selected-forecast-demand">
                96 shipments
              </output>
            </dd>
          </div>
        </dl>

        <section
          class="capacity-formula"
          aria-labelledby="capacity-formula-title"
        >
          <h2 id="capacity-formula-title">Required capacity</h2>
          <math
            display="block"
            aria-label="Capacity formula: 96 shipments times one plus 10 percent buffer equals 106 shipments"
          >
            <mrow>
              <msub>
                <mi>C</mi>
                <mtext>required</mtext>
              </msub>
              <mo>=</mo>
              <mn data-testid="formula-demand">96</mn>
              <mo>×</mo>
              <mrow>
                <mo>(</mo>
                <mn>1</mn>
                <mo>+</mo>
                <mfrac>
                  <mn data-testid="formula-buffer">10</mn>
                  <mn>100</mn>
                </mfrac>
                <mo>)</mo>
              </mrow>
              <mo>=</mo>
              <mn data-testid="formula-result">106</mn>
            </mrow>
          </math>
        </section>

        <form class="capacity-controls" data-capacity-form novalidate>
          <label for="capacity-buffer">Capacity buffer percentage</label>
          <div class="capacity-control-row">
            <input
              id="capacity-buffer"
              class="form-control"
              type="number"
              min="0"
              max="50"
              step="1"
              value="10"
            />
            <button type="submit" class="btn btn-primary">
              Calculate required capacity
            </button>
          </div>
          <output data-testid="capacity-form-status" aria-live="polite">
            Reviewing Week 2 at 10% buffer
          </output>
        </form>

        <button
          type="button"
          class="btn btn-sm btn-outline-secondary capacity-reset"
          data-capacity-reset
        >
          Reset capacity model
        </button>
      </aside>
    </section>
  );
}
