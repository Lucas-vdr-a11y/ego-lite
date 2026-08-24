/**
 * Anti-detection persona pool.
 *
 * Each persona is internally consistent: the User-Agent, the Client Hints
 * (`sec-ch-ua`) brands, the `platform`, the IANA `timezone`, the `accept-language`,
 * the screen geometry, the WebGL vendor/renderer strings, and the installed font
 * list all describe the same real machine. Detectors correlate these signals; a
 * mismatched tuple (e.g. a macOS User-Agent with a Windows timezone) is itself a
 * fingerprint that screams "automation".
 *
 * Ported in spirit from vibheksoni/stealth-browser-mcp's nodriver launch profile
 * strategy, expressed here as a reusable data layer for ego-browser's CDP client.
 */

export type SecChUa = {
  brands: { brand: string; version: string }[];
  fullVersionList: { brand: string; version: string }[];
  platform: string;
  architecture?: string;
  model?: string;
  mobile: boolean;
  bitness?: string;
};

export type Persona = {
  id: string;
  label: string;
  userAgent: string;
  platform: string;
  secChUa: SecChUa;
  acceptLanguage: string;
  languages: string[];
  timezone: string;
  locale: string;
  viewport: { width: number; height: number };
  screen: {
    width: number;
    height: number;
    availWidth: number;
    availHeight: number;
  };
  devicePixelRatio: number;
  hardwareConcurrency: number;
  deviceMemory: number;
  webglVendor: string;
  webglRenderer: string;
  webglUnmaskedVendor: string;
  webglUnmaskedRenderer: string;
  fonts: string[];
};

export const PERSONAS: Persona[] = [
  {
    id: "win11-chrome126",
    label: "Windows 11 + Chrome 126 (x64, NVIDIA RTX 3060)",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Win32",
    secChUa: {
      brands: [
        { brand: "Not.A/Brand", version: "8" },
        { brand: "Chromium", version: "126" },
        { brand: "Google Chrome", version: "126" },
      ],
      fullVersionList: [
        { brand: "Not.A/Brand", version: "8.0.0.0" },
        { brand: "Chromium", version: "126.0.0.0" },
        { brand: "Google Chrome", version: "126.0.0.0" },
      ],
      platform: "Windows",
      architecture: "x86",
      model: "",
      mobile: false,
      bitness: "64",
    },
    acceptLanguage: "en-US,en;q=0.9",
    languages: ["en-US", "en"],
    timezone: "America/New_York",
    locale: "en-US",
    viewport: { width: 1920, height: 1080 },
    screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040 },
    devicePixelRatio: 1,
    hardwareConcurrency: 16,
    deviceMemory: 8,
    webglVendor: "Google Inc. (NVIDIA)",
    webglRenderer:
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    webglUnmaskedVendor: "NVIDIA Corporation",
    webglUnmaskedRenderer: "NVIDIA GeForce RTX 3060/PCIe/SSE2",
    fonts: [
      "Arial",
      "Calibri",
      "Cambria",
      "Consolas",
      "Courier New",
      "Georgia",
      "Segoe UI",
      "Tahoma",
      "Times New Roman",
      "Trebuchet MS",
      "Verdana",
      "Webdings",
    ],
  },
  {
    id: "win10-chrome125",
    label: "Windows 10 + Chrome 125 (x64, Intel UHD)",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    platform: "Win32",
    secChUa: {
      brands: [
        { brand: "Not.A/Brand", version: "8" },
        { brand: "Chromium", version: "125" },
        { brand: "Google Chrome", version: "125" },
      ],
      fullVersionList: [
        { brand: "Not.A/Brand", version: "8.0.0.0" },
        { brand: "Chromium", version: "125.0.0.0" },
        { brand: "Google Chrome", version: "125.0.0.0" },
      ],
      platform: "Windows",
      architecture: "x86",
      model: "",
      mobile: false,
      bitness: "64",
    },
    acceptLanguage: "en-US,en;q=0.9",
    languages: ["en-US", "en"],
    timezone: "America/Chicago",
    locale: "en-US",
    viewport: { width: 1536, height: 864 },
    screen: { width: 1536, height: 864, availWidth: 1536, availHeight: 824 },
    devicePixelRatio: 1,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    webglVendor: "Google Inc. (Intel)",
    webglRenderer:
      "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    webglUnmaskedVendor: "Intel Inc.",
    webglUnmaskedRenderer: "Intel(R) UHD Graphics 630",
    fonts: [
      "Arial",
      "Calibri",
      "Cambria",
      "Consolas",
      "Courier New",
      "Georgia",
      "Segoe UI",
      "Tahoma",
      "Times New Roman",
      "Trebuchet MS",
      "Verdana",
    ],
  },
  {
    id: "mac-sonoma-chrome124",
    label: "macOS Sonoma 14 + Chrome 124 (Apple Silicon M2)",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    platform: "MacIntel",
    secChUa: {
      brands: [
        { brand: "Not.A/Brand", version: "8" },
        { brand: "Chromium", version: "124" },
        { brand: "Google Chrome", version: "124" },
      ],
      fullVersionList: [
        { brand: "Not.A/Brand", version: "8.0.0.0" },
        { brand: "Chromium", version: "124.0.0.0" },
        { brand: "Google Chrome", version: "124.0.0.0" },
      ],
      platform: "macOS",
      architecture: "arm64",
      model: "",
      mobile: false,
      bitness: "64",
    },
    acceptLanguage: "en-US,en;q=0.9",
    languages: ["en-US", "en"],
    timezone: "America/Los_Angeles",
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
    screen: { width: 1440, height: 900, availWidth: 1440, availHeight: 841 },
    devicePixelRatio: 2,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    webglVendor: "Apple",
    webglRenderer: "Apple GPU",
    webglUnmaskedVendor: "Apple",
    webglUnmaskedRenderer: "Apple M2",
    fonts: [
      "Arial",
      "Arial Black",
      "Helvetica",
      "Helvetica Neue",
      "Menlo",
      "Monaco",
      "Times",
      "Times New Roman",
      "Georgia",
      "Courier New",
      "Geneva",
      "Lucida Grande",
    ],
  },
  {
    id: "mac-ventura-chrome123",
    label: "macOS Ventura 13 + Chrome 123 (Intel i7)",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    platform: "MacIntel",
    secChUa: {
      brands: [
        { brand: "Not.A/Brand", version: "8" },
        { brand: "Chromium", version: "123" },
        { brand: "Google Chrome", version: "123" },
      ],
      fullVersionList: [
        { brand: "Not.A/Brand", version: "8.0.0.0" },
        { brand: "Chromium", version: "123.0.0.0" },
        { brand: "Google Chrome", version: "123.0.0.0" },
      ],
      platform: "macOS",
      architecture: "x86",
      model: "",
      mobile: false,
      bitness: "64",
    },
    acceptLanguage: "en-US,en;q=0.9",
    languages: ["en-US", "en"],
    timezone: "America/Denver",
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
    screen: { width: 1280, height: 800, availWidth: 1280, availHeight: 748 },
    devicePixelRatio: 2,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    webglVendor: "Apple",
    webglRenderer: "Apple GPU",
    webglUnmaskedVendor: "Apple",
    webglUnmaskedRenderer: "Intel Iris OpenGL Engine",
    fonts: [
      "Arial",
      "Helvetica",
      "Helvetica Neue",
      "Menlo",
      "Monaco",
      "Times",
      "Times New Roman",
      "Georgia",
      "Courier New",
      "Geneva",
      "Lucida Grande",
    ],
  },
  {
    id: "linux-ubuntu-chrome122",
    label: "Ubuntu 22.04 + Chrome 122 (x64, NVIDIA GTX 1650)",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    platform: "Linux x86_64",
    secChUa: {
      brands: [
        { brand: "Not.A/Brand", version: "8" },
        { brand: "Chromium", version: "122" },
        { brand: "Google Chrome", version: "122" },
      ],
      fullVersionList: [
        { brand: "Not.A/Brand", version: "8.0.0.0" },
        { brand: "Chromium", version: "122.0.0.0" },
        { brand: "Google Chrome", version: "122.0.0.0" },
      ],
      platform: "Linux",
      architecture: "x86",
      model: "",
      mobile: false,
      bitness: "64",
    },
    acceptLanguage: "en-US,en;q=0.9",
    languages: ["en-US", "en"],
    timezone: "Europe/Berlin",
    locale: "en-US",
    viewport: { width: 1536, height: 864 },
    screen: { width: 1536, height: 864, availWidth: 1536, availHeight: 824 },
    devicePixelRatio: 1,
    hardwareConcurrency: 12,
    deviceMemory: 8,
    webglVendor: "Google Inc. (NVIDIA)",
    webglRenderer:
      "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 OpenGL 4.5.0, OpenGL 4.5)",
    webglUnmaskedVendor: "NVIDIA Corporation",
    webglUnmaskedRenderer: "NVIDIA GeForce GTX 1650/PCIe/SSE2",
    fonts: [
      "DejaVu Sans",
      "DejaVu Sans Mono",
      "Liberation Sans",
      "Liberation Serif",
      "FreeSans",
      "Ubuntu",
      "Cantarell",
      "Arial",
    ],
  },
  {
    id: "win11-chrome120",
    label: "Windows 11 + Chrome 120 (x64, AMD Radeon)",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    platform: "Win32",
    secChUa: {
      brands: [
        { brand: "Not.A/Brand", version: "8" },
        { brand: "Chromium", version: "120" },
        { brand: "Google Chrome", version: "120" },
      ],
      fullVersionList: [
        { brand: "Not.A/Brand", version: "8.0.0.0" },
        { brand: "Chromium", version: "120.0.0.0" },
        { brand: "Google Chrome", version: "120.0.0.0" },
      ],
      platform: "Windows",
      architecture: "x86",
      model: "",
      mobile: false,
      bitness: "64",
    },
    acceptLanguage: "en-GB,en;q=0.9",
    languages: ["en-GB", "en"],
    timezone: "Europe/London",
    locale: "en-GB",
    viewport: { width: 2560, height: 1440 },
    screen: { width: 2560, height: 1440, availWidth: 2560, availHeight: 1400 },
    devicePixelRatio: 1,
    hardwareConcurrency: 12,
    deviceMemory: 16,
    webglVendor: "Google Inc. (AMD)",
    webglRenderer:
      "ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    webglUnmaskedVendor: "Google Inc. (AMD)",
    webglUnmaskedRenderer: "AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0",
    fonts: [
      "Arial",
      "Calibri",
      "Cambria",
      "Consolas",
      "Courier New",
      "Georgia",
      "Segoe UI",
      "Tahoma",
      "Times New Roman",
      "Trebuchet MS",
      "Verdana",
    ],
  },
];

export function listPersonaSummaries() {
  return PERSONAS.map((p) => ({ id: p.id, label: p.label }));
}

function defaultRng(): () => number {
  return Math.random;
}

export function pickPersona(
  selector?: string | number,
  rng: () => number = defaultRng(),
): Persona {
  if (selector === undefined || selector === null) {
    return randomPersona(rng);
  }
  if (typeof selector === "number") {
    const idx =
      ((selector % PERSONAS.length) + PERSONAS.length) % PERSONAS.length;
    return PERSONAS[idx];
  }
  const byId = PERSONAS.find((p) => p.id === selector);
  if (byId) {
    return byId;
  }
  // Allow a fuzzy substring match, useful for CLI/EGO_STEALTH_PERSONA.
  const fuzzy = PERSONAS.find(
    (p) =>
      p.label.toLowerCase().includes(selector.toLowerCase()) ||
      p.id.includes(selector.toLowerCase()),
  );
  if (fuzzy) {
    return fuzzy;
  }
  return randomPersona(rng);
}

export function randomPersona(rng: () => number = defaultRng()): Persona {
  const idx = Math.floor(rng() * PERSONAS.length) % PERSONAS.length;
  return PERSONAS[idx];
}
