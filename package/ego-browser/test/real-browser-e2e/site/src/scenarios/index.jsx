import CanvasSurface from "./canvas/view.jsx";
import ClicksSurface from "./clicks/view.jsx";
import DialogsSurface from "./dialogs/view.jsx";
import DownloadsSurface from "./downloads/view.jsx";
import DragDropSurface from "./drag-drop/view.jsx";
import FormsSurface from "./forms/view.jsx";
import FramesSurface from "./frames/view.jsx";
import HoverSurface from "./hover/view.jsx";
import KeyboardSurface from "./keyboard/view.jsx";
import NavigationSurface from "./navigation/view.jsx";
import NetworkSurface from "./network/view.jsx";
import ScrollSurface from "./scroll/view.jsx";
import UploadsSurface from "./uploads/view.jsx";

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
  downloads: DownloadsSurface,
  frames: FramesSurface,
  network: NetworkSurface,
};
