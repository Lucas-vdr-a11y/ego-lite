import { scenarioCase } from "./scenario-case.mjs";

export const nativeFormControlsScenarioCase = scenarioCase(
  "native-form-controls",
  `
    const releaseReview = page.locator("#cross-border-release-review");
    const initialSnapshot = await releaseReview.ariaSnapshot({ ref: true });
    assertIncludes(
      initialSnapshot,
      'group "Release identity"',
      "the release identity fieldset keeps its native legend name",
    );
    assertIncludes(
      initialSnapshot,
      'textbox "Release reference"',
      "the required release reference is exposed as a named native textbox",
    );
    assertIncludes(
      initialSnapshot,
      'combobox "Primary release market"',
      "the classic market select has its visible label as an accessible name",
    );
    assertEqual(
      await releaseReview.evaluate((element) => element.tagName),
      "FORM",
      "the release review uses a native form root",
    );
    for (const elementName of [
      "button",
      "datalist",
      "fieldset",
      "input",
      "label",
      "legend",
      "meter",
      "optgroup",
      "option",
      "output",
      "progress",
      "select",
      "textarea",
    ]) {
      assert(
        (await releaseReview.locator(elementName).count()) > 0,
        "the rendered release review contains a native " + elementName + " element",
      );
    }

    const releaseReference = page.getByLabel("Release reference", {
      exact: true,
    });
    const releaseSubmit = page.getByRole("button", {
      name: "Submit release review",
      exact: true,
    });
    const riskBuffer = page.locator("#risk-buffer");
    const reviewProgress = page.locator("#review-progress");
    assertEqual(
      await reviewProgress.evaluate((element) => element.value),
      0,
      "the completion indicator starts at zero before any user review",
    );
    assertEqual(
      await riskBuffer.evaluate((element) => element.value),
      35,
      "the risk meter starts at the regional baseline",
    );

    await observedAction(page, releaseSubmit, "click");
    const emptyReferenceValidity = await releaseReference.evaluate(
      (element) => ({
        focused: element === document.activeElement,
        message: element.validationMessage,
        valueMissing: element.validity.valueMissing,
      }),
    );
    assertEqual(
      emptyReferenceValidity.valueMissing,
      true,
      "an empty visible submission invokes the browser required constraint",
    );
    assert(
      emptyReferenceValidity.message.trim().length > 0,
      "the browser provides a non-empty localized required validation message",
    );
    assertEqual(
      emptyReferenceValidity.focused,
      true,
      "native validation focuses the first invalid release control",
    );

    await observedAction(page, releaseReference, "fill", "SG-2026");
    await observedAction(page, releaseSubmit, "click");
    const patternValidity = await releaseReference.evaluate((element) => ({
      focused: element === document.activeElement,
      message: element.validationMessage,
      patternMismatch: element.validity.patternMismatch,
      valueMissing: element.validity.valueMissing,
    }));
    assertEqual(
      patternValidity.valueMissing,
      false,
      "the invalid release reference is no longer classified as missing",
    );
    assertEqual(
      patternValidity.patternMismatch,
      true,
      "the second visible submission invokes the authored native pattern",
    );
    assert(
      patternValidity.message.trim().length > 0,
      "the browser provides a non-empty localized pattern validation message",
    );
    assertEqual(
      patternValidity.focused,
      true,
      "pattern validation keeps focus on the invalid reference",
    );
    assertEqual(
      await reviewProgress.evaluate((element) => element.value),
      0,
      "an invalid release reference does not advance completion",
    );

    await observedPageKey(
      page,
      'textbox "Release reference"',
      "ControlOrMeta+A",
    );
    await observedPageKey(page, 'textbox "Release reference"', "Backspace");
    await observedCurrentKeyboard(
      page,
      'textbox "Release reference"',
      "type",
      "SG-2026-0815",
    );
    assertEqual(
      await releaseReference.inputValue(),
      "SG-2026-0815",
      "real keyboard editing repairs the release reference",
    );
    assertEqual(
      await releaseReference.evaluate((element) => element.validity.valid),
      true,
      "the keyboard-repaired reference satisfies the native pattern",
    );
    assertEqual(
      await reviewProgress.evaluate((element) => element.value),
      1,
      "repairing the first required control advances completion once",
    );

    const launchCity = page.getByLabel("Launch city", { exact: true });
    await observedPageKey(page, 'combobox "Launch city"', "Tab");
    assertEqual(
      await launchCity.evaluate((element) => element === document.activeElement),
      true,
      "Tab reaches the datalist-backed launch city without programmatic focus",
    );
    const datalistInteractionSnapshot = await page
      .locator("body")
      .ariaSnapshot({ ref: true });
    assertIncludes(
      datalistInteractionSnapshot,
      'combobox "Launch city"',
      "the structure tree establishes the datalist keyboard context",
    );
    await observedCurrentKeyboard(
      page,
      'combobox "Launch city"',
      "type",
      "Sh",
    );
    assertEqual(
      await launchCity.inputValue(),
      "Sh",
      "real keyboard input narrows the datalist to Shanghai and Shenzhen",
    );
    await observedPageKey(page, 'combobox "Launch city"', "ArrowDown");
    await observedPageKey(page, 'combobox "Launch city"', "Enter");
    const datalistKeyboardValue = await launchCity.inputValue();
    const authoredLaunchCities = await page
      .locator("#launch-city-list option")
      .evaluateAll((options) => options.map((option) => option.value));
    const datalistKeyboardSelected = datalistKeyboardValue === "Shanghai";
    assert(
      datalistKeyboardValue === "Sh" ||
        authoredLaunchCities.includes(datalistKeyboardValue),
      "the native datalist key attempt preserves the typed prefix or chooses an authored suggestion" +
        " (value=" + JSON.stringify(datalistKeyboardValue) + ")",
    );
    assertEqual(
      await page.locator('#launch-city-list option[value="Shanghai"]').count(),
      1,
      "the native datalist contains the authored Shanghai suggestion",
    );
    if (!datalistKeyboardSelected) {
      await observedPageKey(page, 'combobox "Launch city"', "Escape");
      await observedAction(page, launchCity, "click");
      await observedPageKey(
        page,
        'combobox "Launch city"',
        "ControlOrMeta+A",
      );
      await observedPageKey(page, 'combobox "Launch city"', "Backspace");
      await observedCurrentKeyboard(
        page,
        'combobox "Launch city"',
        "type",
        "Shanghai",
      );
    }
    assertEqual(
      await launchCity.inputValue(),
      "Shanghai",
      "the user completes Shanghai with real keys when the native suggestion popup is unavailable",
    );
    assertEqual(
      await reviewProgress.evaluate((element) => element.value),
      2,
      "typing the required launch city advances completion",
    );

    const primaryMarket = page.getByLabel("Primary release market", {
      exact: true,
    });
    assertEqual(
      await primaryMarket.inputValue(),
      "sg-singapore",
      "the classic select starts in the Southeast Asia group",
    );
    let classicPickerFailure;
    try {
      await observedAction(page, primaryMarket, "click");
      const openClassicSelectSnapshot = await page
        .locator("body")
        .ariaSnapshot({ ref: true });
      const classicSelectExpandedDiagnostic =
        openClassicSelectSnapshot.includes("[expanded]");
      assertEqual(
        await primaryMarket.evaluate(
          (element) => element === document.activeElement,
        ),
        true,
          "pointer opening focuses the classic select; expanded exposed=" +
          String(classicSelectExpandedDiagnostic),
      );
      const selectCdpSession = await task.context.newCDPSession(page);
      try {
        const documentNode = await selectCdpSession.send("DOM.getDocument", {
          depth: 0,
        });
        const selectNode = await selectCdpSession.send("DOM.querySelector", {
          nodeId: documentNode.root.nodeId,
          selector: "#primary-market",
        });
        const describedSelect = await selectCdpSession.send(
          "DOM.describeNode",
          { nodeId: selectNode.nodeId },
        );
        const backendNodeId = describedSelect.node.backendNodeId;
        const selectTree = await selectCdpSession.send(
          "Accessibility.getPartialAXTree",
          { backendNodeId, fetchRelatives: false },
        );
        const rawSelect = selectTree.nodes.find(
          (candidate) => candidate.backendDOMNodeId === backendNodeId,
        );
        const expanded = rawSelect?.properties?.find(
          (property) => property.name === "expanded",
        )?.value?.value;
        assertEqual(
          expanded,
          true,
          "the native classic select reports expanded=true while its pointer-opened picker is visible",
        );
      } finally {
        await selectCdpSession.detach();
      }
    } catch (error) {
      classicPickerFailure = error;
      throw error;
    } finally {
      try {
        await observedPageKey(
          page,
          'combobox "Primary release market"',
          "Escape",
        );
      } catch (cleanupError) {
        if (!classicPickerFailure) throw cleanupError;
      }
    }
    assertEqual(
      await primaryMarket.inputValue(),
      "sg-singapore",
      "Escape closes the classic picker without changing its selection",
    );
    assertEqual(
      await primaryMarket.evaluate(
        (element) => element === document.activeElement,
      ),
      true,
      "Escape keeps the classic select focused for native typeahead",
    );
    await observedCurrentKeyboard(
      page,
      'combobox "Primary release market"',
      "type",
      "Shanghai",
    );
    assertEqual(
      await primaryMarket.inputValue(),
      "cn-shanghai",
      "native typeahead crosses from Southeast Asia to Greater China",
    );
    assertEqual(
      await primaryMarket
        .locator("option:checked")
        .evaluate((option) => option.parentElement?.label),
      "Greater China",
      "the typeahead result belongs to the intended optgroup",
    );
    assertEqual(
      await reviewProgress.evaluate((element) => element.value),
      3,
      "the cross-optgroup user selection advances completion",
    );
    assertEqual(
      await riskBuffer.evaluate((element) => element.value),
      72,
      "selecting Shanghai updates the market-derived risk meter",
    );

    const releaseTemplate = page.getByLabel("Release template", {
      exact: true,
    });
    assertIncludes(
      await releaseTemplate.ariaSnapshot(),
      'combobox "Release template"',
      "the template select retains its visible label as its accessible name",
    );
    const customizableSelectSupported = await page.evaluate(
      () =>
        "HTMLSelectedContentElement" in window &&
        CSS.supports("appearance", "base-select"),
    );
    if (customizableSelectSupported) {
      let customizablePickerFailure;
      try {
        assertEqual(
          await releaseTemplate.locator("selectedcontent").evaluate(
            (element) => element.constructor.name,
          ),
          "HTMLSelectedContentElement",
          "the supported browser upgrades the native selectedcontent element",
        );
        await observedAction(page, releaseTemplate, "click");
        const shanghaiTemplate = page.getByRole("option", {
          name: "Shanghai launch dossier",
          exact: true,
        });
        await observedAction(page, shanghaiTemplate, "click");
        assertEqual(
          await releaseTemplate.inputValue(),
          "shanghai-dossier",
          "a real customizable-picker option click updates the native value",
        );
        assertEqual(
          (
            await releaseTemplate.locator("selectedcontent").textContent()
          ).trim(),
          "Shanghai launch dossier",
          "selectedcontent clones the visibly chosen option label",
        );
        assertIncludes(
          await releaseTemplate.ariaSnapshot(),
          'combobox "Release template"',
          "the selected customizable control preserves its accessible name",
        );
        assertEqual(
          await reviewProgress.evaluate((element) => element.value),
          4,
          "the real customizable option click advances completion",
        );
      } catch (error) {
        customizablePickerFailure = error;
        throw error;
      } finally {
        if (customizablePickerFailure) {
          try {
            await observedPageKey(
              page,
              'combobox "Release template"',
              "Escape",
            );
          } catch (cleanupError) {
            if (!customizablePickerFailure) throw cleanupError;
          }
        }
      }
    } else {
      assertEqual(
        await releaseTemplate.inputValue(),
        "regional-baseline",
        "unsupported browsers retain the native baseline option",
      );
    }

    const reviewNotes = page.getByLabel("Reviewer notes", { exact: true });
    await observedAction(
      page,
      reviewNotes,
      "fill",
      "Shanghai customs evidence and launch ownership confirmed.",
    );
    assertEqual(
      await reviewNotes.inputValue(),
      "Shanghai customs evidence and launch ownership confirmed.",
      "the native textarea retains the reviewer evidence",
    );
    assertEqual(
      await riskBuffer.evaluate((element) => element.value),
      72,
      "the meter exposes the authoritative cross-border risk utilization",
    );
    assertEqual(
      await reviewProgress.evaluate((element) => element.value),
      customizableSelectSupported ? 5 : 4,
      "the progress control reflects every required field reviewed so far",
    );

    await observedAction(page, releaseSubmit, "click");
    assertIncludes(
      await page.getByTestId("native-review-status").textContent(),
      "SG-2026-0815 is ready for Shanghai",
      "a valid user submission updates the native output status",
    );
    assertEqual(
      await reviewProgress.evaluate((element) => element.value),
      5,
      "the valid visible submission advances completion to its native max",
    );
    const nativeFormData = JSON.parse(
      await page.getByTestId("native-form-data").textContent(),
    );
    assertEqual(
      nativeFormData.releaseReference,
      "SG-2026-0815",
      "FormData preserves the keyboard-repaired release reference",
    );
    assertEqual(
      nativeFormData.launchCity,
      "Shanghai",
      "FormData preserves the complete datalist-backed city input",
    );
    assertEqual(
      nativeFormData.primaryMarket,
      "cn-shanghai",
      "FormData preserves the cross-optgroup typeahead selection",
    );
    assertEqual(
      nativeFormData.releaseTemplate,
      customizableSelectSupported
        ? "shanghai-dossier"
        : "regional-baseline",
      "FormData preserves the template selected by the available native UI",
    );
    assertEqual(
      nativeFormData.reviewNotes,
      "Shanghai customs evidence and launch ownership confirmed.",
      "FormData preserves the textarea evidence",
    );

    const rangeControlSnapshot = await releaseReview.ariaSnapshot({
      ref: true,
    });
    const cdpSession = await task.context.newCDPSession(page);
    let meterAx;
    let progressAx;
    try {
      const documentNode = await cdpSession.send("DOM.getDocument", {
        depth: 0,
      });
      const rawAxNode = async (selector) => {
        const domNode = await cdpSession.send("DOM.querySelector", {
          nodeId: documentNode.root.nodeId,
          selector,
        });
        const describedNode = await cdpSession.send("DOM.describeNode", {
          nodeId: domNode.nodeId,
        });
        const backendNodeId = describedNode.node.backendNodeId;
        const tree = await cdpSession.send(
          "Accessibility.getPartialAXTree",
          {
            backendNodeId,
            fetchRelatives: false,
          },
        );
        return tree.nodes.find(
          (candidate) => candidate.backendDOMNodeId === backendNodeId,
        );
      };
      meterAx = await rawAxNode("#risk-buffer");
      progressAx = await rawAxNode("#review-progress");
    } finally {
      await cdpSession.detach();
    }
    assertEqual(
      meterAx?.role?.value,
      "meter",
      "Chromium exposes the native meter role",
    );
    assertEqual(
      meterAx?.name?.value,
      "Risk buffer utilization",
      "Chromium names the meter from its legal label element",
    );
    assertEqual(
      progressAx?.role?.value,
      "progressbar",
      "Chromium exposes the native progress role",
    );
    assertEqual(
      progressAx?.name?.value,
      "Review completion",
      "Chromium names progress from its legal label element",
    );

    const missingRangeControlNames = [
      ['meter "Risk buffer utilization"', "Risk buffer utilization meter"],
      ['progressbar "Review completion"', "Review completion progressbar"],
    ]
      .filter(([expected]) => !rangeControlSnapshot.includes(expected))
      .map(([, label]) => label);
    assertEqual(
      missingRangeControlNames.join(", "),
      "",
      "the framework snapshot preserves Chromium native range-control names:\\n" +
        rangeControlSnapshot,
    );
  `,
);
