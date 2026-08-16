export default function NativeFormControlsSurface() {
  return (
    <section class="surface card native-form-controls-surface">
      <header class="native-form-controls-heading">
        <div>
          <span>APAC RELEASE / NATIVE REVIEW</span>
          <h2>Cross-border release review</h2>
        </div>
        <p>
          Validate the Shanghai release record with browser-native controls
          before the 18 August handoff.
        </p>
      </header>

      <form id="cross-border-release-review" class="native-form-controls-form">
        <fieldset>
          <legend>Release identity</legend>
          <div class="native-form-controls-grid">
            <div class="native-form-control">
              <label for="release-reference">Release reference</label>
              <input
                id="release-reference"
                name="releaseReference"
                type="text"
                required
                pattern="[A-Z]{2}-[0-9]{4}-[0-9]{4}"
                title="Use two letters, a four-digit year, and a four-digit release number"
                placeholder="SG-2026-0815"
                autocomplete="off"
              />
              <small>Format: SG-2026-0815</small>
            </div>

            <div class="native-form-control">
              <label for="launch-city">Launch city</label>
              <input
                id="launch-city"
                name="launchCity"
                type="text"
                list="launch-city-list"
                required
                autocomplete="off"
                placeholder="Start typing a launch city"
              />
              <datalist id="launch-city-list">
                <option value="Singapore"></option>
                <option value="Shanghai"></option>
                <option value="Shenzhen"></option>
                <option value="Tokyo"></option>
              </datalist>
              <small>The list suggests active APAC launch hubs.</small>
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Market and dossier</legend>
          <div class="native-form-controls-grid">
            <div class="native-form-control">
              <label for="primary-market">Primary release market</label>
              <select id="primary-market" name="primaryMarket" required>
                <optgroup label="Southeast Asia">
                  <option value="sg-singapore" selected>
                    Singapore hub
                  </option>
                  <option value="id-jakarta">Jakarta hub</option>
                </optgroup>
                <optgroup label="Greater China">
                  <option value="cn-shanghai">Shanghai hub</option>
                  <option value="cn-shenzhen">Shenzhen hub</option>
                </optgroup>
              </select>
              <small>Open with the pointer, then use native typeahead.</small>
            </div>

            <div class="native-form-control native-template-control">
              <label for="release-template">Release template</label>
              <select
                id="release-template"
                name="releaseTemplate"
                class="customizable-select"
                required
              >
                <button type="button" class="customizable-select-button">
                  <selectedcontent></selectedcontent>
                </button>
                <optgroup label="Regional dossiers">
                  <option value="regional-baseline" selected>
                    Regional baseline dossier
                  </option>
                </optgroup>
                <optgroup label="City dossiers">
                  <option value="shanghai-dossier">
                    Shanghai launch dossier
                  </option>
                  <option value="singapore-dossier">
                    Singapore launch dossier
                  </option>
                </optgroup>
              </select>
              <small>
                Uses a customizable select when the browser supports it.
              </small>
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Release evidence</legend>
          <div class="native-form-control native-form-control-wide">
            <label for="review-notes">Reviewer notes</label>
            <textarea
              id="review-notes"
              name="reviewNotes"
              rows={4}
              required
              minLength={30}
              placeholder="Record the evidence checked for this release."
            ></textarea>
          </div>

          <div class="native-form-controls-readiness">
            <div>
              <label for="risk-buffer">Risk buffer utilization</label>
              <meter
                id="risk-buffer"
                min={0}
                max={100}
                low={40}
                high={80}
                optimum={20}
                value={35}
              >
                35 percent
              </meter>
              <small>Updates from the selected release market</small>
            </div>
            <div>
              <label for="review-progress">Review completion</label>
              <progress id="review-progress" max={5} value={0}>
                0 of 5 checks
              </progress>
              <small>Tracks five required release evidence fields</small>
            </div>
          </div>
        </fieldset>

        <div class="native-form-controls-summary">
          <div>
            <span>REVIEW STATE</span>
            <output
              id="native-review-status"
              name="reviewStatus"
              for="release-reference launch-city primary-market release-template review-notes"
              data-testid="native-review-status"
            >
              Awaiting native validation
            </output>
          </div>
          <div>
            <span>SUBMITTED FORM DATA</span>
            <output data-testid="native-form-data">Not submitted</output>
          </div>
        </div>

        <button type="submit" class="btn btn-primary native-form-submit">
          Submit release review
        </button>
      </form>
    </section>
  );
}
