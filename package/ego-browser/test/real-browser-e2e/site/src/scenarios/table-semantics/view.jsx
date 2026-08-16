export default function TableSemanticsSurface() {
  return (
    <section class="surface card table-semantics-review">
      <article class="table-semantics-sheet" aria-labelledby="transfer-title">
        <header>
          <p class="eyebrow">APAC operations / transfer review</p>
          <h2 id="transfer-title">Transfer allocation review</h2>
          <p>
            Sort each origin group by arrival date, select the next route for
            review, and confirm the committed cases and value.
          </p>
        </header>

        <div class="transfer-table-shell">
          <table data-testid="transfer-allocation">
            <caption>Transfer commitments for 15 August 2026</caption>
            <colgroup>
              <col class="transfer-origin-column" />
              <col class="transfer-destination-column" />
              <col span={2} class="transfer-commitment-column" />
              <col class="transfer-eta-column" />
              <col class="transfer-review-column" />
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} scope="col">
                  Origin
                </th>
                <th rowSpan={2} scope="col">
                  Destination
                </th>
                <th id="commitment-header" colSpan={2} scope="colgroup">
                  Commitment
                </th>
                <th id="eta-header" rowSpan={2} scope="col" aria-sort="none">
                  <button type="button" data-sort-eta>
                    ETA
                  </button>
                </th>
                <th id="review-header" rowSpan={2} scope="col">
                  Review
                </th>
              </tr>
              <tr>
                <th id="cases-header" scope="col">
                  Cases
                </th>
                <th id="value-header" scope="col">
                  Value
                </th>
              </tr>
            </thead>

            <tbody data-origin="Singapore">
              <tr
                data-route="singapore-shanghai"
                data-origin="Singapore"
                data-destination="Shanghai"
                data-eta="2026-08-20"
                data-cases="120"
                data-value="48000"
                data-selected="false"
              >
                <th id="origin-singapore" rowSpan={2} scope="rowgroup">
                  Singapore
                </th>
                <th id="route-singapore-shanghai" scope="row">
                  Shanghai
                </th>
                <td headers="origin-singapore route-singapore-shanghai cases-header commitment-header">
                  120
                </td>
                <td headers="origin-singapore route-singapore-shanghai value-header commitment-header">
                  S$48,000
                </td>
                <td headers="origin-singapore route-singapore-shanghai eta-header">
                  <time dateTime="2026-08-20">20 Aug</time>
                </td>
                <td headers="origin-singapore route-singapore-shanghai review-header">
                  <label>
                    <input
                      type="checkbox"
                      data-review-route
                      aria-label="Review Singapore to Shanghai transfer"
                    />{" "}
                    Select
                  </label>
                </td>
              </tr>
              <tr
                data-route="singapore-tokyo"
                data-origin="Singapore"
                data-destination="Tokyo"
                data-eta="2026-08-18"
                data-cases="80"
                data-value="31200"
                data-selected="false"
              >
                <th id="route-singapore-tokyo" scope="row">
                  Tokyo
                </th>
                <td headers="origin-singapore route-singapore-tokyo cases-header commitment-header">
                  80
                </td>
                <td headers="origin-singapore route-singapore-tokyo value-header commitment-header">
                  S$31,200
                </td>
                <td headers="origin-singapore route-singapore-tokyo eta-header">
                  <time dateTime="2026-08-18">18 Aug</time>
                </td>
                <td headers="origin-singapore route-singapore-tokyo review-header">
                  <label>
                    <input
                      type="checkbox"
                      data-review-route
                      aria-label="Review Singapore to Tokyo transfer"
                    />{" "}
                    Select
                  </label>
                </td>
              </tr>
            </tbody>

            <tbody data-origin="Malaysia">
              <tr
                data-route="malaysia-shanghai"
                data-origin="Malaysia"
                data-destination="Shanghai"
                data-eta="2026-08-17"
                data-cases="60"
                data-value="21000"
                data-selected="false"
              >
                <th id="origin-malaysia" rowSpan={2} scope="rowgroup">
                  Malaysia
                </th>
                <th id="route-malaysia-shanghai" scope="row">
                  Shanghai
                </th>
                <td headers="origin-malaysia route-malaysia-shanghai cases-header commitment-header">
                  60
                </td>
                <td headers="origin-malaysia route-malaysia-shanghai value-header commitment-header">
                  S$21,000
                </td>
                <td headers="origin-malaysia route-malaysia-shanghai eta-header">
                  <time dateTime="2026-08-17">17 Aug</time>
                </td>
                <td headers="origin-malaysia route-malaysia-shanghai review-header">
                  <label>
                    <input
                      type="checkbox"
                      data-review-route
                      aria-label="Review Malaysia to Shanghai transfer"
                    />{" "}
                    Select
                  </label>
                </td>
              </tr>
              <tr
                data-route="malaysia-seoul"
                data-origin="Malaysia"
                data-destination="Seoul"
                data-eta="2026-08-22"
                data-cases="45"
                data-value="16000"
                data-selected="false"
              >
                <th id="route-malaysia-seoul" scope="row">
                  Seoul
                </th>
                <td headers="origin-malaysia route-malaysia-seoul cases-header commitment-header">
                  45
                </td>
                <td headers="origin-malaysia route-malaysia-seoul value-header commitment-header">
                  S$16,000
                </td>
                <td headers="origin-malaysia route-malaysia-seoul eta-header">
                  <time dateTime="2026-08-22">22 Aug</time>
                </td>
                <td headers="origin-malaysia route-malaysia-seoul review-header">
                  <label>
                    <input
                      type="checkbox"
                      data-review-route
                      aria-label="Review Malaysia to Seoul transfer"
                    />{" "}
                    Select
                  </label>
                </td>
              </tr>
            </tbody>

            <tfoot>
              <tr>
                <th colSpan={2} scope="row">
                  Selected commitment
                </th>
                <td data-testid="selected-cases">0 cases</td>
                <td data-testid="selected-value">S$0</td>
                <td colSpan={2} data-testid="review-readiness">
                  No route selected
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p data-testid="transfer-review-status" aria-live="polite">
          No transfer selected.
        </p>
      </article>
    </section>
  );
}
