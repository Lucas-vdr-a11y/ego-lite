/**
 * Browser-side helpers shared by selector actions that need composed-tree
 * relationships. Keep action policy at each call site: pointer actions and
 * editing actions intentionally do not retarget in the same way.
 */
export const COMPOSED_PARENT_HELPER = `
  function composedParent(element) {
    if (element?.assignedSlot) return element.assignedSlot;
    if (element?.parentElement) return element.parentElement;
    const root = element?.getRootNode ? element.getRootNode() : null;
    return root && root.nodeType === 11 ? root.host : null;
  }
`;

export const COMPOSED_TREE_HELPERS = `
  ${COMPOSED_PARENT_HELPER}
  function composedChildren(element) {
    if (!element) return [];
    if (String(element.tagName || "").toUpperCase() === "SLOT") {
      const assigned = element.assignedElements?.({ flatten: true }) || [];
      if (assigned.length > 0) return assigned;
    }
    const container = element.shadowRoot || element;
    return Array.from(container.children || []);
  }
  function nearestComposedAncestor(element, predicate) {
    let current = composedParent(element);
    while (current) {
      if (predicate(current)) return current;
      current = composedParent(current);
    }
    return null;
  }
  function composedDescendantMatches(root, predicate, stopAtMatch = false) {
    const matches = [];
    const visit = (parent) => {
      for (const child of composedChildren(parent)) {
        const matched = predicate(child);
        if (matched) matches.push(child);
        if (!(matched && stopAtMatch)) visit(child);
      }
    };
    visit(root);
    return matches;
  }
`;

/** Editing semantics layered on top of the shared composed-tree traversal. */
export const EDIT_ACTION_TARGET_HELPERS = `
  ${COMPOSED_TREE_HELPERS}
  function isExplicitContentEditable(element) {
    return Boolean(
      element?.hasAttribute?.("contenteditable") &&
      element.getAttribute("contenteditable") !== "false"
    );
  }
  function isFillableInput(element) {
    const tag = String(element?.tagName || "").toUpperCase();
    if (tag === "TEXTAREA") return true;
    if (tag !== "INPUT") return false;
    return new Set([
      "", "color", "date", "datetime-local", "email", "month", "number",
      "password", "range", "search", "tel", "text", "time", "url", "week"
    ]).has(String(element.type || "").toLowerCase());
  }
  function isFillableActionTarget(element) {
    return isExplicitContentEditable(element) || isFillableInput(element);
  }
  function isEditableFocusTarget(element) {
    const tag = String(element?.tagName || "").toUpperCase();
    if (isFillableActionTarget(element)) return !element.disabled;
    if (tag === "SELECT") return !element.disabled;
    return new Set(["textbox", "searchbox", "combobox", "spinbutton"]).has(
      String(element?.getAttribute?.("role") || "").toLowerCase()
    );
  }
  function isStrongFocusTarget(element) {
    if (!element?.isConnected || element.disabled || element.closest?.("[inert]")) {
      return false;
    }
    if (isEditableFocusTarget(element)) return true;
    const tag = String(element.tagName || "").toUpperCase();
    if (["BUTTON", "SELECT", "TEXTAREA", "SUMMARY", "IFRAME"].includes(tag)) {
      return true;
    }
    if (tag === "INPUT") return String(element.type || "").toLowerCase() !== "hidden";
    if ((tag === "A" || tag === "AREA") && element.hasAttribute("href")) return true;
    if ((tag === "AUDIO" || tag === "VIDEO") && element.hasAttribute("controls")) {
      return true;
    }
    return new Set([
      "button", "checkbox", "link", "menuitem", "menuitemcheckbox",
      "menuitemradio", "option", "radio", "slider", "switch", "tab", "treeitem"
    ]).has(String(element.getAttribute?.("role") || "").toLowerCase());
  }
`;
