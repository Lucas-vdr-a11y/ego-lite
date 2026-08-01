import { cdp } from "./cdp-eval.js";

export function createPageEnvironmentController() {
  let viewportSize: { width: number; height: number } | null = null;
  return {
    setViewportSize: async (viewport) => {
      const width = Number(viewport?.width);
      const height = Number(viewport?.height);
      if (
        !Number.isInteger(width) ||
        width <= 0 ||
        !Number.isInteger(height) ||
        height <= 0
      ) {
        throw new TypeError(
          "page.setViewportSize requires positive integer width and height",
        );
      }
      await cdp("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
        screenWidth: width,
        screenHeight: height,
      });
      viewportSize = { width, height };
    },
    viewportSize: () => (viewportSize ? { ...viewportSize } : null),
    updateViewportSize: (value) => {
      const width = Number(value?.width ?? value?.w);
      const height = Number(value?.height ?? value?.h);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        viewportSize = { width, height };
      }
    },
    emulateMedia: async (options: any = {}) => {
      if (!options || typeof options !== "object" || Array.isArray(options)) {
        throw new TypeError("page.emulateMedia options must be an object");
      }
      const features = [];
      addFeature(features, "prefers-color-scheme", options.colorScheme);
      addFeature(features, "prefers-reduced-motion", options.reducedMotion);
      addFeature(features, "forced-colors", options.forcedColors);
      addFeature(features, "prefers-contrast", options.contrast);
      await cdp("Emulation.setEmulatedMedia", {
        media: options.media ?? "",
        features,
      });
    },
  };
}

function addFeature(features, name, value) {
  if (value === undefined) return;
  features.push({ name, value: value ?? "" });
}
