export const TEST_CASES = [
  {
    slug: "clicks",
    route: "/tests/clicks",
    number: "01",
    title: "Dispatch queue",
    eyebrow: "Clicks / order operations",
    description:
      "Review live orders, approve the selected shipment, and open contextual actions.",
  },
  {
    slug: "hover",
    route: "/tests/hover",
    number: "02",
    title: "Product shelf",
    eyebrow: "Hover / collection preview",
    description:
      "Browse a small material collection and reveal product details without leaving the shelf.",
  },
  {
    slug: "drag-drop",
    route: "/tests/drag-drop",
    number: "03",
    title: "Sprint board",
    eyebrow: "Drag & drop / planning",
    description:
      "Move work between workflow stages using both a pressed pointer and native card dragging.",
  },
  {
    slug: "canvas",
    route: "/tests/canvas",
    number: "04",
    title: "Review canvas",
    eyebrow: "Canvas / visual feedback",
    description:
      "Annotate a layout review with freehand strokes, color tools, and a visible revision record.",
  },
  {
    slug: "forms",
    route: "/tests/forms",
    number: "05",
    title: "Project request",
    eyebrow: "Forms / intake workflow",
    description:
      "Complete a realistic project brief with priorities, approval state, and an updating summary.",
  },
  {
    slug: "keyboard",
    route: "/tests/keyboard",
    number: "06",
    title: "Editorial desk",
    eyebrow: "Keyboard / document editing",
    description:
      "Edit a draft title and rich body while the document records shortcuts and key activity.",
  },
  {
    slug: "uploads",
    route: "/tests/uploads",
    number: "07",
    title: "Asset delivery",
    eyebrow: "Uploads / campaign handoff",
    description:
      "Deliver one or more campaign assets and review their browser-provided file metadata.",
  },
  {
    slug: "scroll",
    route: "/tests/scroll",
    number: "08",
    title: "Field journal",
    eyebrow: "Scroll / reading experience",
    description:
      "Read a long field note while independently exploring a dense activity timeline.",
  },
  {
    slug: "navigation",
    route: "/tests/navigation",
    number: "09",
    title: "Knowledge map",
    eyebrow: "Navigation / workspace links",
    description:
      "Follow a reference in the current workspace or open an independent research page.",
  },
  {
    slug: "dialogs",
    route: "/tests/dialogs",
    number: "10",
    title: "Release controls",
    eyebrow: "Dialogs / protected actions",
    description:
      "Run notification, approval, and naming steps around a staged product release.",
  },
  {
    slug: "downloads",
    route: "/tests/downloads",
    number: "11",
    title: "Report archive",
    eyebrow: "Downloads / exported records",
    description:
      "Inspect a small archive and download a deterministic operations report.",
  },
  {
    slug: "frames",
    route: "/tests/frames",
    number: "12",
    title: "Embedded checkout",
    eyebrow: "Frames / partner surface",
    description:
      "Complete an embedded partner action while keeping order context in the host page.",
  },
  {
    slug: "network",
    route: "/tests/network",
    number: "13",
    title: "Shipment tracker",
    eyebrow: "Network / live lookup",
    description:
      "Request the latest shipment state and render the response as a compact delivery timeline.",
  },
  {
    slug: "review-workflow",
    route: "/tests/review-workflow",
    number: "14",
    title: "Evidence review",
    eyebrow: "Workflow / controlled review",
    description:
      "Assign an expert, record a blocking finding, complete the author revision, and approve the evidence trail.",
  },
  {
    slug: "collaborative-docs",
    route: "/tests/collaborative-docs",
    number: "15",
    title: "Decision document",
    eyebrow: "Docs / live collaboration",
    description:
      "Edit one shared decision record across browser tabs and preserve a deterministic version history.",
  },
  {
    slug: "spreadsheet",
    route: "/tests/spreadsheet",
    number: "16",
    title: "Pilot workbook",
    eyebrow: "Spreadsheet / budget planning",
    description:
      "Edit budget cells, recalculate the planned spend, add rows, and save the workbook through a real data grid.",
  },
  {
    slug: "rich-text",
    route: "/tests/rich-text",
    number: "17",
    title: "Release editor",
    eyebrow: "Rich text / editorial formatting",
    description:
      "Write and format a release article, inspect its semantic HTML, and persist the editorial draft.",
  },
];

export function findTestCase(slug) {
  return TEST_CASES.find((testCase) => testCase.slug === slug);
}
