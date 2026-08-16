import CanvasSurface from "./canvas/view.jsx";
import ClicksSurface from "./clicks/view.jsx";
import CollaborativeDocsSurface from "./collaborative-docs/view.jsx";
import DialogsSurface from "./dialogs/view.jsx";
import DocumentOutlineSurface from "./document-outline/view.jsx";
import DownloadsSurface from "./downloads/view.jsx";
import DragDropSurface from "./drag-drop/view.jsx";
import FormsSurface from "./forms/view.jsx";
import FramesSurface from "./frames/view.jsx";
import HoverSurface from "./hover/view.jsx";
import KeyboardSurface from "./keyboard/view.jsx";
import NavigationSurface from "./navigation/view.jsx";
import NetworkSurface from "./network/view.jsx";
import ReviewWorkflowSurface from "./review-workflow/view.jsx";
import RichTextSurface from "./rich-text/view.jsx";
import ScrollSurface from "./scroll/view.jsx";
import SpreadsheetSurface from "./spreadsheet/view.jsx";
import UploadsSurface from "./uploads/view.jsx";
import VisualPathSurface from "./visual-path/view.jsx";
import SvgMathmlSurface from "./svg-mathml/view.jsx";
import TextContentSurface from "./text-content/view.jsx";
import InlineSemanticsSurface from "./inline-semantics/view.jsx";
import MediaEmbedsSurface from "./media-embeds/view.jsx";
import TableSemanticsSurface from "./table-semantics/view.jsx";
import NativeFormControlsSurface from "./native-form-controls/view.jsx";
import WebComponentsSurface from "./web-components/view.jsx";
import ContractAmendmentSurface from "./contract-amendment/view.jsx";

export const surfaces = {
  clicks: ClicksSurface,
  hover: HoverSurface,
  "drag-drop": DragDropSurface,
  canvas: CanvasSurface,
  forms: FormsSurface,
  keyboard: KeyboardSurface,
  uploads: UploadsSurface,
  scroll: ScrollSurface,
  navigation: NavigationSurface,
  dialogs: DialogsSurface,
  "document-outline": DocumentOutlineSurface,
  downloads: DownloadsSurface,
  frames: FramesSurface,
  network: NetworkSurface,
  "review-workflow": ReviewWorkflowSurface,
  "collaborative-docs": CollaborativeDocsSurface,
  spreadsheet: SpreadsheetSurface,
  "rich-text": RichTextSurface,
  "visual-path": VisualPathSurface,
  "svg-mathml": SvgMathmlSurface,
  "text-content": TextContentSurface,
  "inline-semantics": InlineSemanticsSurface,
  "media-embeds": MediaEmbedsSurface,
  "table-semantics": TableSemanticsSurface,
  "native-form-controls": NativeFormControlsSurface,
  "web-components": WebComponentsSurface,
  "contract-amendment": ContractAmendmentSurface,
};
