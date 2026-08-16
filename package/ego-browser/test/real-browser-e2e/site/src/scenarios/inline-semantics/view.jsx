export default function InlineSemanticsSurface() {
  return (
    <section class="surface card inline-semantics-proof">
      <div class="inline-semantics-sheet">
        <article aria-labelledby="localization-proof-title">
          <header>
            <p class="eyebrow">Localization review / Singapore launch</p>
            <h2 id="localization-proof-title">Localized release proof</h2>
            <p>
              <small>
                Copy deck <data value="REL-2.4-SG">REL-2.4-SG</data> · review
                due <time dateTime="2026-08-18T17:00:00+08:00">18 August</time>
              </small>
            </p>
            <p>
              <strong>Northstar 2.4</strong> launches at 17:00{" "}
              <abbr title="Singapore Standard Time">SGT</abbr> with a verified
              zero-downtime migration.
            </p>
            <nav aria-label="Localization proof sections">
              <a href="#terminology" class="case-review-link">
                Review terminology for{" "}
                <span data-case-token="release-case">
                  {"CASE2026"}
                  <wbr />
                  {"APAC"}
                  <wbr />
                  {"SINGAPORE"}
                  <wbr />
                  {"00042"}
                </span>
              </a>
              <a href="#pronunciation">
                Open{" "}
                <ruby>
                  上海<rp>(</rp>
                  <rt>shàng hǎi</rt>
                  <rp>)</rp>
                </ruby>{" "}
                pronunciation notes
              </a>
            </nav>
          </header>

          <section
            id="terminology"
            class="inline-proof-section"
            aria-labelledby="terminology-heading"
            tabIndex="-1"
          >
            <h3 id="terminology-heading">Terminology and tone</h3>
            <p>
              <dfn id="service-window-definition">Service window</dfn> means the
              planned period for an operational change. The release is{" "}
              <em>reversible throughout that window</em>; the key customer
              promise is <b>no checkout interruption</b>, summarized as{" "}
              <mark>zero-downtime</mark>.
            </p>
            <p>
              The phrase <i lang="en-SG">kampong spirit</i> is retained only in
              the internal note. Customer copy follows{" "}
              <q cite="https://example.test/voice-guide">
                Keep every workspace moving
              </q>{" "}
              from the <cite>Northstar voice guide</cite>.
            </p>
            <p>
              Replace <s>instant global rollout</s> with{" "}
              <u class="spelling-annotation">phased regional rollout</u>.{" "}
              <span class="copy-note">
                The underlined phrase awaits legal review.
              </span>
            </p>
            <p>
              Regional owner <bdi>ليلى</bdi> will verify token{" "}
              <bdo dir="rtl">SG-2048</bdo> before promotion.
            </p>
            <p>
              Release key:{" "}
              <code>
                northstar.release.
                <wbr />
                apac.
                <wbr />
                2_4
              </code>
            </p>
          </section>

          <section
            id="pronunciation"
            class="inline-proof-section"
            aria-labelledby="pronunciation-heading"
            tabIndex="-1"
          >
            <h3 id="pronunciation-heading">Pronunciation and operator copy</h3>
            <p>
              The reviewer link keeps the Shanghai base text and its Mandarin
              pronunciation together for assistive technology.
            </p>
            <p>
              Press <kbd>⌘</kbd> + <kbd>K</kbd> to open the command palette. A
              successful check reports <samp>Localization proof ready</samp>.
            </p>
            <p>
              The performance copy must keep <var>latency</var>
              <sub>p95</sub> below 4 × 10<sup>2</sup> ms.
              <br />
              Do not translate product identifiers or trace values.
            </p>
          </section>

          <section
            class="localization-approval"
            aria-labelledby="approval-heading"
          >
            <h3 id="approval-heading">Release decision</h3>
            <p>
              Visit both proof sections before approving this localized release.
            </p>
            <button type="button" data-approve-localization disabled>
              Approve localized release
            </button>
            <p data-testid="localization-review-status" aria-live="polite">
              0 of 2 proof sections reviewed
            </p>
          </section>
        </article>
      </div>
    </section>
  );
}
