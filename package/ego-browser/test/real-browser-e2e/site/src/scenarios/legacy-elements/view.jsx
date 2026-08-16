const supplierSeal =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='64' viewBox='0 0 96 64'%3E%3Crect width='96' height='64' rx='8' fill='%23fef3c7'/%3E%3Ccircle cx='48' cy='32' r='20' fill='none' stroke='%2392400e' stroke-width='4'/%3E%3Cpath d='M34 32h28M48 18v28' stroke='%2392400e' stroke-width='3'/%3E%3C/svg%3E";

export default function LegacyElementsSurface() {
  return (
    <section
      class="surface card legacy-elements"
      data-compatibility-state="pending"
    >
      <header class="legacy-elements-heading">
        <p class="eyebrow">Historical supplier import / Compatibility only</p>
        <h2>Legacy supplier manifest compatibility</h2>
        <p>
          <strong>
            Compatibility fixture — not recommended for new documents.
          </strong>{" "}
          These elements reproduce an archived supplier manifest so the browser
          harness can report how Chromium actually parses it.
        </p>
      </header>

      <section
        class="legacy-formatting-card"
        aria-labelledby="legacy-formatting-heading"
      >
        <h3 id="legacy-formatting-heading">Imported formatting sample</h3>
        <p>
          <span data-format-baseline>Baseline supplier label</span>{" "}
          <acronym
            title="Electronic Data Interchange"
            data-testid="legacy-acronym"
          >
            EDI
          </acronym>{" "}
          <big data-testid="legacy-big">Expedited legacy handling</big>{" "}
          <font
            color="#7c2d12"
            face="monospace"
            size="4"
            data-testid="legacy-font"
          >
            Tier 4 legacy supplier
          </font>
        </p>
        <center data-testid="legacy-center">
          <span>Archived supplier heading</span>
        </center>
        <p class="legacy-narrow-window">
          <nobr data-testid="legacy-nobr">
            SG-SHA consolidated manifest reference SUP-208 must remain on one
            imported line
          </nobr>
        </p>
        <p>
          <strike data-testid="legacy-strike">
            Obsolete warehouse routing
          </strike>{" "}
          <tt data-testid="legacy-tt">SUP-208/SG-SHA</tt>
        </p>
      </section>

      <section
        class="legacy-directory-card"
        aria-labelledby="legacy-directory-heading"
      >
        <h3 id="legacy-directory-heading">Imported manifest directory</h3>
        <dir data-testid="legacy-directory">
          <li>
            <a href="#manifest-line-sup-208">
              Open imported manifest line SUP-208
            </a>
          </li>
          <li>
            <a href="#legacy-parser-evidence">Open parser evidence</a>
          </li>
        </dir>
      </section>

      <section
        id="legacy-parser-evidence"
        class="legacy-parser-card"
        aria-labelledby="legacy-parser-heading"
      >
        <h3 id="legacy-parser-heading">Imported parser evidence</h3>
        <content data-testid="legacy-content">
          Imported content insertion point: consignee notes retained.
        </content>
        <menu>
          <menuitem data-testid="legacy-menuitem">
            Imported menu command: inspect supplier lot.
          </menuitem>
        </menu>
        <shadow data-testid="legacy-shadow">
          Imported shadow insertion point: customs ledger retained.
        </shadow>

        <p>
          Supplier origin:{" "}
          <ruby data-testid="legacy-ruby">
            <rb>新</rb>
            <rb>加坡</rb>
            <rp>(</rp>
            <rt>Singapore</rt>
            <rp>)</rp>
            <rtc>
              <rt>Supplier origin</rt>
            </rtc>
          </ruby>
        </p>

        <figure class="legacy-seal">
          <image
            id="legacy-supplier-seal"
            src={supplierSeal}
            alt="Scanned supplier seal"
            width="96"
            height="64"
          />
          <figcaption>
            Seal copied from the archived manifest source.
          </figcaption>
        </figure>

        <marquee data-testid="legacy-marquee" scrollAmount={0} direction="left">
          Imported alert: manual customs review required for SUP-208.
        </marquee>

        <object
          class="legacy-plugin-record"
          data="data:application/x-legacy-supplier,archive"
          type="application/x-legacy-supplier"
        >
          <param name="archive" value="supplier-manifest-v3.pdf" />
          <p>Legacy supplier archive plug-in is unavailable.</p>
        </object>
        <noembed data-testid="legacy-noembed">
          Legacy plug-in fallback remains hidden in an embed-capable browser.
        </noembed>

        <xmp data-testid="legacy-xmp">
          <button id="xmp-fake-approve">Approve imported manifest</button>
          supplier-line=SUP-208
        </xmp>
      </section>

      <section
        id="manifest-line-sup-208"
        tabIndex="-1"
        class="legacy-manifest-review"
        aria-labelledby="legacy-manifest-review-heading"
      >
        <h3 id="legacy-manifest-review-heading">Manifest line SUP-208</h3>
        <p>
          Singapore supplier lot 88A is awaiting a modern compatibility review
          before Shanghai release.
        </p>
        <div class="legacy-manifest-actions">
          <button
            type="button"
            class="btn btn-outline-secondary"
            data-review-legacy-manifest
          >
            Review imported manifest
          </button>
          <button
            type="button"
            class="btn btn-primary"
            data-approve-legacy-manifest
            disabled
          >
            Approve supplier manifest
          </button>
        </div>
        <output data-testid="legacy-manifest-status" aria-live="polite">
          Legacy manifest awaiting review.
        </output>
      </section>
    </section>
  );
}
