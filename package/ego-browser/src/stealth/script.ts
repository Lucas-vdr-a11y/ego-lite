import type { Persona } from "./personas.js";

/**
 * The anti-fingerprint payload. This string is registered with
 * `Page.addScriptToEvaluateOnNewDocument`, so it runs in the page's main world
 * BEFORE any site script (including reCAPTCHA, hCaptcha, Cloudflare, and
 * DataDome bootstrap scripts) executes. `__PERSONA_JSON__` is substituted at
 * runtime with the active persona.
 *
 * Coverage (each mirrors a known automation tell):
 *  - navigator.webdriver             -> false (the single biggest CDP tell)
 *  - navigator.platform / userAgent / appVersion / vendor
 *  - navigator.languages / userAgentData (Client Hints parity)
 *  - navigator.hardwareConcurrency / deviceMemory
 *  - navigator.connection            -> stable, plausible 4g/wifi
 *  - navigator.permissions.query      -> never rejects / never throws
 *  - navigator.plugins / mimeTypes    -> non-empty, consistent fake set
 *  - window.chrome                    -> full runtime/app/loadTimes/csi object
 *  - screen.* / devicePixelRatio / outerWidth|Height
 *  - Canvas 2D                        -> deterministic LSB noise
 *  - WebGL VENDOR/RENDERER + WEBGL_debug_renderer_info unmasked strings
 *  - AudioBuffer.getChannelData       -> sub-threshold white noise
 *
 * No template literals or ${} are used inside the payload on purpose: it is
 * stored as a single-quoted JS string so it survives the TS template literal
 * and the CDP transport byte-for-byte.
 */
const STEALTH_TEMPLATE = `
(function(){
  var P = __PERSONA_JSON__;
  function def(o, k, v){ try { Object.defineProperty(o, k, { get: v, configurable: true }); } catch(e){} }
  function isHttp(){ try { return /^https?:$/.test(location.protocol); } catch(e){ return true; } }

  def(Navigator.prototype, 'webdriver', function(){ return false; });
  def(Navigator.prototype, 'platform', function(){ return P.platform; });
  def(Navigator.prototype, 'vendor', function(){ return 'Google Inc.'; });
  def(Navigator.prototype, 'userAgent', function(){ return P.userAgent; });
  def(Navigator.prototype, 'appVersion', function(){ return P.userAgent.replace(/^[^()]*(?=\\()/, ''); });
  def(Navigator.prototype, 'languages', function(){ return P.languages; });
  def(Navigator.prototype, 'language', function(){ return P.languages[0]; });
  def(Navigator.prototype, 'hardwareConcurrency', function(){ return P.hardwareConcurrency; });
  def(Navigator.prototype, 'deviceMemory', function(){ return P.deviceMemory; });
  def(Navigator.prototype, 'userAgentData', function(){ return {
      brands: P.secChUa.brands,
      mobile: P.secChUa.mobile,
      platform: P.secChUa.platform,
      getHighEntropyValues: function(){ return Promise.resolve({
        brands: P.secChUa.fullVersionList,
        mobile: P.secChUa.mobile,
        platform: P.secChUa.platform,
        architecture: P.secChUa.architecture || '',
        model: P.secChUa.model || '',
        bitness: P.secChUa.bitness || '64',
        wow64: false
      }); }
    }; });
  def(Navigator.prototype, 'connection', function(){ return {
      rtt: 50, downlink: 10, effectiveType: '4g', saveData: false, type: 'wifi',
      addEventListener: function(){}, removeEventListener: function(){}, onchange: null
    }; });
  if (Navigator.prototype.permissions) {
    def(Navigator.prototype, 'permissions', function(){
      return {
        query: function(d){ var s = 'prompt'; return Promise.resolve({ state: s, onchange: null }); },
        request: function(){ return Promise.resolve({ state: 'prompt' }); }
      };
    });
  }

  function makePlugin(name, filename, mimeType, mimeDesc){
    var entry = { type: mimeType, suffixes: ' ', description: mimeDesc };
    return {
      name: name, filename: filename, description: mimeDesc, length: 1,
      '0': entry,
      item: function(i){ return i === 0 ? entry : null; },
      namedItem: function(n){ return n === mimeType ? entry : null; }
    };
  }
  var pluginsData = [
    makePlugin('Chrome PDF Plugin', 'internal-pdf-viewer', 'application/x-google-chrome-pdf', 'Portable Document Format'),
    makePlugin('Chrome PDF Viewer', 'mhjfbmdgcfjbbpaeojklgmpbpmlhninm', 'application/pdf', 'PDF Viewer'),
    makePlugin('Native Client', 'ppapi', 'application/x-nacl', 'Native Client Executable'),
    makePlugin('Native Client', 'ppapi', 'application/x-pnacl', 'Native Client Executable')
  ];
  var mimeList = [];
  for (var pi = 0; pi < pluginsData.length; pi++) { mimeList.push(pluginsData[pi]['0']); }
  function PluginArray(){}
  PluginArray.prototype = {
    length: pluginsData.length,
    item: function(i){ return pluginsData[i] || null; },
    namedItem: function(n){ for (var i=0;i<pluginsData.length;i++){ if (pluginsData[i].name===n) return pluginsData[i]; } return null; },
    refresh: function(){}
  };
  function MimeArray(){}
  MimeArray.prototype = {
    length: mimeList.length,
    item: function(i){ return mimeList[i] || null; },
    namedItem: function(n){ for (var i=0;i<mimeList.length;i++){ if (mimeList[i].type===n) return mimeList[i]; } return null; }
  };
  var pluginArrayInst = new PluginArray();
  for (var pj = 0; pj < pluginsData.length; pj++) { pluginArrayInst[pj] = pluginsData[pj]; }
  try {
    pluginArrayInst[Symbol.iterator] = function(){ var i = 0; return { next: function(){ return { done: i >= pluginsData.length, value: i < pluginsData.length ? pluginsData[i++] : undefined }; } }; };
  } catch(e){}
  def(Navigator.prototype, 'plugins', function(){ return pluginArrayInst; });
  def(Navigator.prototype, 'mimeTypes', function(){ return new MimeArray(); });

  // Extra consistency for detectors that read these (Chrome-desktop values).
  def(Navigator.prototype, 'maxTouchPoints', function(){ return 0; });
  def(Navigator.prototype, 'doNotTrack', function(){ return null; });
  def(Navigator.prototype, 'onLine', function(){ return true; });
  try {
    if (screen.orientation){
      Object.defineProperty(screen.orientation, 'type', { get: function(){ return 'landscape-primary'; }, configurable: true });
      Object.defineProperty(screen.orientation, 'angle', { get: function(){ return 0; }, configurable: true });
    }
  } catch(e){}
  try {
    if (navigator.storage && navigator.storage.estimate){
      navigator.storage.estimate = function(){ return Promise.resolve({ usage: 5e7 + Math.floor(Math.random()*2e8) % 200000000, quota: 1073741824, usageDetails: {} }); };
    }
  } catch(e){}
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices){
      navigator.mediaDevices.enumerateDevices = function(){ return Promise.resolve([
        { deviceId: 'default', kind: 'audioinput', label: '', groupId: 'default' },
        { deviceId: 'default', kind: 'audiooutput', label: '', groupId: 'default' },
        { deviceId: 'default', kind: 'videoinput', label: '', groupId: 'default' }
      ]); };
    }
  } catch(e){}

  var chromeObj = {
    app: { isInstalled: false,
      InstallState: { DISABLED:'disabled', INSTALLED:'installed', NOT_INSTALLED:'not_installed' },
      RunningState: { CANARY:'canary', CHROME:'chrome', CHROMIUM:'chromium', DEVELOPMENT:'development', STABLE:'stable', UNKNOWN:'unknown' } },
    runtime: {
      OnInstalledReason: { CHROME_UPDATE:'chrome_update', INSTALL:'install', SHARED_MODULE_UPDATE:'shared_module_update', UPDATE:'update' },
      OnRestartRequiredReason: { APP_UPDATE:'app_update', OS_UPDATE:'os_update', PERIODIC:'periodic' },
      PlatformArch: { ARM:'arm', ARM64:'arm64', MIPS:'mips', MIPS64:'mips64', X86_32:'x86-32', X86_64:'x86-64' },
      PlatformNaclArch: { ARM:'arm', ARM64:'arm64', MIPS:'mips', MIPS64:'mips64', X86_32:'x86-32', X86_64:'x86-64' },
      PlatformOs: { ANDROID:'android', CROS:'cros', LINUX:'linux', MAC:'mac', OPENBSD:'openbsd', WIN:'win' },
      RequestUpdateCheckStatus: { NO_UPDATE:'no_update', THROTTLED:'throttled', UPDATE_AVAILABLE:'update_available' },
      connect: function(){ return {}; },
      getManifest: function(){ return {}; },
      getURL: function(){ return ''; },
      sendMessage: function(){ return Promise.resolve(); },
      setUninstallURL: function(){}
    },
    loadTimes: function(){ return { commitLoadTime:0, connectionInfo:'h2', finishDocumentLoadTime:0, finishLoadTime:0, firstPaintAfterLoadTime:0, firstPaintTime:0, navigationType:'Other', requestTime:0, startLoadTime:0, wasAlternateProtocolAvailable:false, wasFetchedViaSpdy:true, wasNpnNegotiated:true }; },
    csi: function(){ return { startE:0, onloadT:0, pageT:0, tran:0, fid: undefined }; },
    webstore: { install: function(){}, onInstallStageChanged: {}, onDownloadProgress: {} }
  };
  try { Object.defineProperty(window, 'chrome', { get: function(){ return chromeObj; }, configurable: true }); } catch(e){ window.chrome = chromeObj; }

  function defScreen(k, v){ try { Object.defineProperty(Screen.prototype, k, { get: function(){ return v; }, configurable: true }); } catch(e){} }
  defScreen('width', P.screen.width);
  defScreen('height', P.screen.height);
  defScreen('availWidth', P.screen.availWidth);
  defScreen('availHeight', P.screen.availHeight);
  defScreen('colorDepth', 24);
  defScreen('pixelDepth', 24);
  try { Object.defineProperty(window, 'devicePixelRatio', { get: function(){ return P.devicePixelRatio; }, configurable: true }); } catch(e){}
  try { Object.defineProperty(window, 'outerWidth', { get: function(){ return P.screen.width; }, configurable: true }); } catch(e){}
  try { Object.defineProperty(window, 'outerHeight', { get: function(){ return P.screen.height; }, configurable: true }); } catch(e){}

  var canvasSeed = Math.floor(Math.random() * 1e9);
  function noiseCanvas(ctx){
    var w = ctx.canvas.width, h = ctx.canvas.height;
    if (!w || !h) return;
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4){
      var n = ((canvasSeed + i) % 7) - 3;
      d[i] = d[i] + n; d[i+1] = d[i+1] + n; d[i+2] = d[i+2] + n;
    }
    ctx.putImageData(img, 0, 0);
  }
  var origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function(){
    var img = origGetImageData.apply(this, arguments);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4){ var n = ((canvasSeed + i) % 5) - 2; d[i] = d[i] + n; d[i+1] = d[i+1] + n; d[i+2] = d[i+2] + n; }
    return img;
  };
  var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(){
    try { var c = this.getContext('2d'); if (c && c.getImageData) noiseCanvas(c); } catch(e){}
    return origToDataURL.apply(this, arguments);
  };
  var origToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function(){
    try { var c = this.getContext('2d'); if (c && c.getImageData) noiseCanvas(c); } catch(e){}
    return origToBlob.apply(this, arguments);
  };

  var WV = P.webglVendor, WR = P.webglRenderer, WUV = P.webglUnmaskedVendor, WUR = P.webglUnmaskedRenderer;
  function patchWebGL(proto){
    if (!proto) return;
    var origGetParameter = proto.getParameter;
    proto.getParameter = function(p){
      try {
        var dbg = this.getExtension('WEBGL_debug_renderer_info');
        if (dbg){
          if (p === dbg.UNMASKED_VENDOR_WEBGL) return WUV;
          if (p === dbg.UNMASKED_RENDERER_WEBGL) return WUR;
        }
        if (p === this.VENDOR) return WV;
        if (p === this.RENDERER) return WR;
      } catch(e){}
      return origGetParameter.apply(this, arguments);
    };
  }
  patchWebGL(typeof WebGLRenderingContext !== 'undefined' ? WebGLRenderingContext.prototype : null);
  patchWebGL(typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext.prototype : null);

  var origGetChannelData = (typeof AudioBuffer !== 'undefined' && AudioBuffer.prototype.getChannelData) ? AudioBuffer.prototype.getChannelData : null;
  if (origGetChannelData){
    AudioBuffer.prototype.getChannelData = function(channel){
      var data = origGetChannelData.call(this, channel);
      if (data && data.length){
        for (var i = 0; i < data.length; i += 111){
          data[i] = data[i] + (Math.random() - 0.5) * 1e-7;
        }
      }
      return data;
    };
  }
})();
`;

export function buildStealthScript(persona: Persona): string {
  return STEALTH_TEMPLATE.replace("__PERSONA_JSON__", JSON.stringify(persona));
}
