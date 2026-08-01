type TextMatcher = {
  text?: string;
  exact?: boolean;
  regex?: string;
  flags?: string;
};

type InternalScope = {
  base: string;
  child: string;
};

type InternalFilter = {
  base: string;
  hasText?: TextMatcher;
  hasNotText?: TextMatcher;
  has?: string;
  hasNot?: string;
};

type InternalBinary = {
  left: string;
  right: string;
};

type InternalRole = {
  role: string;
  name?: TextMatcher;
  checked?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  includeHidden?: boolean;
  level?: number;
  pressed?: boolean;
  selected?: boolean;
};

export function queryAllExpression(selector, rootExpression = "document") {
  const raw = String(selector);
  const nth = parseInternalNth(raw);
  if (nth) {
    return `(() => {
      const elements = ${queryAllExpression(nth.selector, rootExpression)};
      const element = ${nth.index === "last" ? "elements.at(-1)" : `elements[${JSON.stringify(nth.index)}]`};
      return element ? [element] : [];
    })()`;
  }
  const scope = parseInternalJson<InternalScope>(raw, "scope");
  if (scope) {
    return `(() => {
      const roots = ${queryAllExpression(scope.base, rootExpression)};
      const out = [];
      for (const root of roots) out.push(...${queryAllExpression(scope.child, "root")});
      return Array.from(new Set(out));
    })()`;
  }
  const filter = parseInternalJson<InternalFilter>(raw, "filter");
  if (filter) {
    return `(() => {
      const elements = ${queryAllExpression(filter.base, rootExpression)};
      return elements.filter((element) => ${filterCondition(filter, "element")});
    })()`;
  }
  const intersection = parseInternalJson<InternalBinary>(raw, "and");
  if (intersection) {
    return `(() => {
      const right = new Set(${queryAllExpression(intersection.right, rootExpression)});
      return ${queryAllExpression(intersection.left, rootExpression)}.filter((element) => right.has(element));
    })()`;
  }
  const union = parseInternalJson<InternalBinary>(raw, "or");
  if (union) {
    return `Array.from(new Set([
      ...${queryAllExpression(union.left, rootExpression)},
      ...${queryAllExpression(union.right, rootExpression)}
    ]))`;
  }
  const internalRole = parseInternalJson<InternalRole>(raw, "role");
  if (internalRole) {
    return roleElementsExpression(internalRole, rootExpression);
  }
  const normalized = raw.startsWith("loc=") ? raw.slice(4) : raw;
  const xpath = xpathSelector(raw);
  if (xpath !== null) {
    return `(() => {
      const scopeRoot = ${rootExpression};
      let expression = ${JSON.stringify(xpath)};
      if (expression.startsWith("/") && scopeRoot.nodeType !== 9) expression = "." + expression;
      const snapshot = document.evaluate(expression, scopeRoot, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const elements = [];
      for (let i = 0; i < snapshot.snapshotLength; i += 1) elements.push(snapshot.snapshotItem(i));
      return elements;
    })()`;
  }
  if (normalized.startsWith("css:")) {
    return querySelectorAllExpression(rootExpression, normalized.slice(4));
  }
  if (normalized.startsWith("href:")) {
    return hrefElementsExpression(normalized.slice(5), rootExpression);
  }
  if (normalized.startsWith("text:")) {
    return textElementsExpression(
      parseTextLocator(normalized.slice(5)),
      rootExpression,
    );
  }
  if (raw.startsWith("text=")) {
    return textElementsExpression(
      { text: raw.slice(5), exact: false },
      rootExpression,
    );
  }
  if (normalized.startsWith("label:")) {
    return labelElementsExpression(
      parseTextLocator(normalized.slice(6)),
      rootExpression,
    );
  }
  if (normalized.startsWith("placeholder:")) {
    return attributeElementsExpression(
      "input[placeholder], textarea[placeholder]",
      "placeholder",
      parseTextLocator(normalized.slice(12)),
      rootExpression,
    );
  }
  if (normalized.startsWith("alt:")) {
    return attributeElementsExpression(
      "img[alt], input[alt]",
      "alt",
      parseTextLocator(normalized.slice(4)),
      rootExpression,
    );
  }
  if (normalized.startsWith("title:")) {
    return attributeElementsExpression(
      "[title]",
      "title",
      parseTextLocator(normalized.slice(6)),
      rootExpression,
    );
  }
  if (normalized.startsWith("testid:")) {
    return attributeElementsExpression(
      "[data-testid]",
      "data-testid",
      parseTextLocator(normalized.slice(7)),
      rootExpression,
    );
  }
  const role = parseRoleLocator(normalized);
  if (role) {
    return roleElementsExpression(role, rootExpression);
  }
  return querySelectorAllExpression(rootExpression, raw);
}

function xpathSelector(selector: string) {
  if (selector.startsWith("xpath=")) return selector.slice(6);
  if (/^\(*\/\//.test(selector) || selector.startsWith("..")) return selector;
  return null;
}

function parseInternalJson<T>(selector: string, kind: string): T | null {
  const prefix = `internal:${kind}:`;
  if (!selector.startsWith(prefix)) {
    return null;
  }
  try {
    return JSON.parse(decodeURIComponent(selector.slice(prefix.length)));
  } catch {
    return null;
  }
}

function parseInternalNth(selector) {
  const nthMatch = /^internal:nth=(\d+);([\s\S]+)$/.exec(String(selector));
  if (nthMatch) return { index: Number(nthMatch[1]), selector: nthMatch[2] };
  const lastMatch = /^internal:last;([\s\S]+)$/.exec(String(selector));
  if (lastMatch) return { index: "last", selector: lastMatch[1] };
  return null;
}

function filterCondition(filter: InternalFilter, elementExpression: string) {
  const checks = [];
  if (filter.hasText) {
    checks.push(
      textMatcherExpression(
        `${elementExpression}.innerText || ${elementExpression}.textContent`,
        filter.hasText,
      ),
    );
  }
  if (filter.hasNotText) {
    checks.push(
      `!(${textMatcherExpression(
        `${elementExpression}.innerText || ${elementExpression}.textContent`,
        filter.hasNotText,
      )})`,
    );
  }
  if (filter.has) {
    checks.push(
      `${queryAllExpression(filter.has, elementExpression)}.length > 0`,
    );
  }
  if (filter.hasNot) {
    checks.push(
      `${queryAllExpression(filter.hasNot, elementExpression)}.length === 0`,
    );
  }
  return checks.length ? checks.join(" && ") : "true";
}

function querySelectorAllExpression(rootExpression: string, selector: string) {
  const hasText = parsePlaywrightHasTextSelector(selector);
  if (hasText) {
    const match = textMatchExpression(
      "el.innerText || el.textContent",
      hasText.text,
      false,
    );
    return `${querySelectorAllExpression(rootExpression, hasText.base)}.filter((el) => ${match})`;
  }
  return `Array.from(${rootExpression}.querySelectorAll(${JSON.stringify(selector)}))`;
}

function parsePlaywrightHasTextSelector(selector: string) {
  const raw = String(selector).trim();
  const marker = ":has-text(";
  const index = raw.lastIndexOf(marker);
  if (index < 0 || !raw.endsWith(")")) {
    return null;
  }
  const text = parseQuotedTextArgument(
    raw.slice(index + marker.length, -1).trim(),
  );
  if (text === null) {
    return null;
  }
  return {
    base: raw.slice(0, index).trim() || "*",
    text,
  };
}

function parseQuotedTextArgument(raw: string) {
  if (raw.length < 2) {
    return null;
  }
  const quote = raw[0];
  if ((quote !== '"' && quote !== "'") || raw[raw.length - 1] !== quote) {
    return null;
  }
  if (quote === '"') {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return raw.slice(1, -1);
    }
  }
  return raw.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}

function hrefElementsExpression(href, rootExpression = "document") {
  return `${querySelectorAllExpression(rootExpression, "a[href]")}.filter((el) => {
    try {
      const url = new URL(el.href, location.href);
      const path = url.pathname + url.search + url.hash;
      return path === ${JSON.stringify(href)} || url.href === ${JSON.stringify(href)};
    } catch {
      return false;
    }
  })`;
}

function parseTextLocator(raw) {
  if (raw.startsWith("regex:")) {
    try {
      const value = JSON.parse(decodeURIComponent(raw.slice(6)));
      if (
        value &&
        typeof value.source === "string" &&
        typeof value.flags === "string"
      ) {
        return { regex: value.source, flags: value.flags };
      }
    } catch {
      // Fall through and treat malformed input as literal text.
    }
  }
  if (raw.startsWith("exact:")) {
    return { text: parseLocatorString(raw.slice(6)), exact: true };
  }
  return { text: parseLocatorString(raw), exact: false };
}

function parseLocatorString(raw) {
  const trimmed = String(raw).trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function textMatcherExpression(valueExpression, matcher: TextMatcher) {
  if (matcher.regex !== undefined) {
    return `new RegExp(${JSON.stringify(matcher.regex)}, ${JSON.stringify(matcher.flags || "")}).test(String(${valueExpression} || ''))`;
  }
  return textMatchExpression(
    valueExpression,
    matcher.text ?? "",
    Boolean(matcher.exact),
  );
}

function textMatchExpression(valueExpression, text, exact) {
  const needle = JSON.stringify(String(text).replace(/\s+/g, " ").trim());
  const normalized = `String(${valueExpression} || '').replace(/\\s+/g, ' ').trim()`;
  return exact
    ? `${normalized} === ${needle}`
    : `${normalized}.includes(${needle})`;
}

function textElementsExpression(locator, rootExpression = "document") {
  const query =
    rootExpression === "document"
      ? "document.querySelectorAll('body *')"
      : `${rootExpression}.querySelectorAll('*')`;
  const match = textMatcherExpression("textOf(el)", locator);
  const childMatch = textMatcherExpression("textOf(child)", locator);
  return `(() => {
    const textCache = new WeakMap();
    const textOf = (element) => {
      if (textCache.has(element)) return textCache.get(element);
      let text = '';
      if (element.childNodes) {
        for (const node of element.childNodes) {
          if (node.nodeType === 1) text += textOf(node);
          else if (node.nodeType === 3 || node.nodeType === 4) text += node.nodeValue || '';
        }
      } else {
        text = element.textContent || '';
      }
      textCache.set(element, text);
      return text;
    };
    return Array.from(${query}).filter((el) => {
      if (!(${match})) return false;
      return !Array.from(el.children || []).some((child) => ${childMatch});
    });
  })()`;
}

function labelElementsExpression(locator, rootExpression = "document") {
  const labelMatch = textMatcherExpression(
    "label.innerText || label.textContent",
    locator,
  );
  const ariaMatch = textMatcherExpression(
    "el.getAttribute('aria-label')",
    locator,
  );
  const labelledByMatch = textMatcherExpression("labelledBy", locator);
  return `(() => {
    const controls = [];
    for (const label of ${querySelectorAllExpression(rootExpression, "label")}) {
      if (!(${labelMatch})) continue;
      const control = label.control || (label.getAttribute('for') ? document.getElementById(label.getAttribute('for')) : null);
      if (control) controls.push(control);
    }
    for (const el of ${querySelectorAllExpression(rootExpression, "input, textarea, select, button, [role]")}) {
      if (el.getAttribute('aria-label') && ${ariaMatch}) controls.push(el);
      const ids = (el.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean);
      if (ids.length) {
        const labelledBy = ids.map((id) => document.getElementById(id)?.textContent || '').join(' ');
        if (${labelledByMatch}) controls.push(el);
      }
    }
    return Array.from(new Set(controls));
  })()`;
}

function attributeElementsExpression(
  selector,
  attribute,
  locator,
  rootExpression = "document",
) {
  const match = textMatcherExpression(
    `el.getAttribute(${JSON.stringify(attribute)})`,
    locator,
  );
  return `${querySelectorAllExpression(rootExpression, selector)}.filter((el) => ${match})`;
}

function parseRoleLocator(value: string) {
  const roleMatch = /^role:([A-Za-z0-9_-]+)(?:\[name=(.+)\])?$/.exec(value);
  if (!roleMatch) {
    return null;
  }
  return {
    role: roleMatch[1],
    name:
      roleMatch[2] === undefined
        ? undefined
        : parseLocatorMatcher(roleMatch[2]),
  };
}

function roleElementsExpression(
  locator: InternalRole,
  rootExpression = "document",
) {
  return `(() => {
    const accessibleName = (el) => {
      const labelledBy = (el.getAttribute('aria-labelledby') || '')
        .split(/\\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ')
        .replace(/\\s+/g, ' ')
        .trim();
      if (labelledBy) return labelledBy;
      const aria = el.getAttribute('aria-label');
      if (aria) return aria.replace(/\\s+/g, ' ').trim();
      if (el.tagName.toLowerCase() === 'fieldset') {
        const legend = Array.from(el.children || []).find((child) => child.tagName.toLowerCase() === 'legend');
        if (legend) return (legend.innerText || legend.textContent || '').replace(/\\s+/g, ' ').trim();
      }
      if (el instanceof HTMLImageElement) return (el.getAttribute('alt') || '').replace(/\\s+/g, ' ').trim();
      if (el instanceof HTMLInputElement && (el.type === 'button' || el.type === 'submit' || el.type === 'reset')) {
        return (el.value || el.getAttribute('value') || '').replace(/\\s+/g, ' ').trim();
      }
      if ('labels' in el && el.labels && el.labels.length) {
        return Array.from(el.labels).map((label) => label.textContent || '').join(' ').replace(/\\s+/g, ' ').trim();
      }
      return (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    };
    return ${querySelectorAllExpression(rootExpression, roleCandidateSelector())}.filter((el) => {
      const explicitRole = (el.getAttribute('role') || '').split(/\\s+/).filter(Boolean)[0];
      const implicitRole = (() => {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (tag === 'button') return 'button';
        if (tag === 'a' && el.hasAttribute('href')) return 'link';
        if (tag === 'textarea') return 'textbox';
        if (tag === 'select') return 'combobox';
        if (tag === 'option') return 'option';
        if (tag === 'fieldset') return 'group';
        if (tag === 'img' && el.hasAttribute('alt')) return 'img';
        if (/^h[1-6]$/.test(tag)) return 'heading';
        if (tag === 'input') {
          if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
          if (type === 'checkbox') return 'checkbox';
          if (type === 'radio') return 'radio';
          if (type === 'range') return 'slider';
          return 'textbox';
        }
        return '';
      })();
      const role = explicitRole || implicitRole;
      if (role !== ${JSON.stringify(locator.role)}) return false;
      if (!${JSON.stringify(Boolean(locator.includeHidden))}) {
        if (el.hidden || el.closest('[hidden], [aria-hidden="true"]')) return false;
        for (let current = el; current; current = current.parentElement) {
          if (getComputedStyle(current).display === 'none') return false;
        }
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      ${roleStateConditions(locator)}
      ${roleNameCondition(locator.name)}
    });
  })()`;
}

function roleStateConditions(locator: InternalRole) {
  const checks: string[] = [];
  if (locator.checked !== undefined) {
    checks.push(
      `((el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) ? el.checked : el.getAttribute('aria-checked') === 'true') === ${JSON.stringify(locator.checked)}`,
    );
  }
  if (locator.disabled !== undefined) {
    checks.push(
      `Boolean(el.closest('[aria-disabled="true"], :disabled')) === ${JSON.stringify(locator.disabled)}`,
    );
  }
  if (locator.expanded !== undefined) {
    checks.push(
      `el.hasAttribute('aria-expanded') && (el.getAttribute('aria-expanded') === 'true') === ${JSON.stringify(locator.expanded)}`,
    );
  }
  if (locator.level !== undefined) {
    checks.push(
      `(Number(el.getAttribute('aria-level') || (/^H[1-6]$/.test(el.tagName) ? el.tagName.slice(1) : 0))) === ${JSON.stringify(locator.level)}`,
    );
  }
  if (locator.pressed !== undefined) {
    checks.push(
      `el.hasAttribute('aria-pressed') && (el.getAttribute('aria-pressed') === 'true') === ${JSON.stringify(locator.pressed)}`,
    );
  }
  if (locator.selected !== undefined) {
    checks.push(
      `((el instanceof HTMLOptionElement) ? el.selected : el.getAttribute('aria-selected') === 'true') === ${JSON.stringify(locator.selected)}`,
    );
  }
  return checks.map((check) => `if (!(${check})) return false;`).join("\n");
}

function roleNameCondition(name) {
  if (name === undefined) {
    return "return true;";
  }
  if (isTextMatcher(name)) {
    return `return ${textMatcherExpression("accessibleName(el)", name)};`;
  }
  return `return accessibleName(el) === ${JSON.stringify(String(name))};`;
}

function parseLocatorMatcher(raw: string) {
  const parsed = parseLocatorString(raw);
  if (
    typeof parsed === "string" &&
    parsed.trim().startsWith("{") &&
    parsed.trim().endsWith("}")
  ) {
    try {
      const value = JSON.parse(parsed);
      if (isTextMatcher(value)) {
        return value;
      }
    } catch {
      return parsed;
    }
  }
  return parsed;
}

function isTextMatcher(value): value is TextMatcher {
  return Boolean(
    value &&
    typeof value === "object" &&
    (typeof value.regex === "string" || typeof value.text === "string"),
  );
}

function roleCandidateSelector() {
  return "button, a[href], input, textarea, select, option, fieldset, img[alt], h1, h2, h3, h4, h5, h6, [role]";
}
