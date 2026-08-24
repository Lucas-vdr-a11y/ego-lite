// agent_helpers.js — exposes `stealth` and `captcha` helpers to ego-browser
// heredocs. Dodger-proof: it references ONLY the globals the skill already
// documents (`cdp`, `js`, `click`, `hover`, `scroll`, `browserFetch`), so it
// runs in whatever harness executes the heredoc (native ego lite app or the
// open fork) without importing any fork TypeScript.
//
// The ego-browser runtime merges the named exports of this file into the
// heredoc global scope. `stealth` and `captcha` then work like any other
// helper. Verified exports -> `stealth.enable/disable/rotate/persona/personas`
// and `captcha.detect/solve/cloudflare/recaptcha/clearance`.

// ---------------------------------------------------------------------------
// Utilities (no external deps)
// ---------------------------------------------------------------------------
function __rand(min, max) {
  return min + Math.random() * (max - min);
}
function __randInt(min, max) {
  return Math.floor(__rand(min, max + 1));
}
function __sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
// `cdp` / `js` are globals provided by ego-browser at the moment the helper is
// called inside a heredoc; reference them lazily so this module stays loadable.
function __cdp(method, params, sessionId) {
  return cdp(method, params, sessionId);
}
function __js(exp) {
  return js(String.raw`${exp}`);
}

// ---------------------------------------------------------------------------
// Persona pool (compact, internally consistent)
// ---------------------------------------------------------------------------
const __PERSONAS = [
  {
    id: "win11-chrome126",
    label: "Windows 11 + Chrome 126",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Win32",
    timezone: "America/New_York",
    lang: "en-US,en;q=0.9",
    languages: ["en-US", "en"],
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
      mobile: false,
      bitness: "64",
    },
    cores: 16,
    memory: 8,
    screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040 },
    dpr: 1,
    webglVendor: "Google Inc. (NVIDIA)",
    webglRenderer:
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    webglUnmaskedVendor: "NVIDIA Corporation",
    webglUnmaskedRenderer: "NVIDIA GeForce RTX 3060/PCIe/SSE2",
  },
  {
    id: "mac-sonoma-chrome124",
    label: "macOS Sonoma + Chrome 124",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    platform: "MacIntel",
    timezone: "America/Los_Angeles",
    lang: "en-US,en;q=0.9",
    languages: ["en-US", "en"],
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
      mobile: false,
      bitness: "64",
    },
    cores: 8,
    memory: 8,
    screen: { width: 1440, height: 900, availWidth: 1440, availHeight: 841 },
    dpr: 2,
    webglVendor: "Apple",
    webglRenderer: "Apple GPU",
    webglUnmaskedVendor: "Apple",
    webglUnmaskedRenderer: "Apple M2",
  },
  {
    id: "linux-ubuntu-chrome122",
    label: "Ubuntu 22.04 + Chrome 122",
    ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    platform: "Linux x86_64",
    timezone: "Europe/Berlin",
    lang: "en-US,en;q=0.9",
    languages: ["en-US", "en"],
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
      mobile: false,
      bitness: "64",
    },
    cores: 12,
    memory: 8,
    screen: { width: 1536, height: 864, availWidth: 1536, availHeight: 824 },
    dpr: 1,
    webglVendor: "Google Inc. (NVIDIA)",
    webglRenderer:
      "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 OpenGL 4.5.0, OpenGL 4.5)",
    webglUnmaskedVendor: "NVIDIA Corporation",
    webglUnmaskedRenderer: "NVIDIA GeForce GTX 1650/PCIe/SSE2",
  },
];
function __pickPersona(sel) {
  if (typeof sel === "number") {
    return __PERSONAS[((sel % __PERSONAS.length) + __PERSONAS.length) % __PERSONAS.length];
  }
  if (typeof sel === "string") {
    return (
      __PERSONAS.find((p) => p.id === sel || p.label.toLowerCase().includes(sel.toLowerCase())) ||
      __PERSONAS[__randInt(0, __PERSONAS.length - 1)]
    );
  }
  return __PERSONAS[__randInt(0, __PERSONAS.length - 1)];
}

// ---------------------------------------------------------------------------
// Stealth payload (injected before any page script via addScriptToEvaluateOnNewDocument)
// ---------------------------------------------------------------------------
function __payload(P) {
  return `(() => {
    var P = ${JSON.stringify(P)};
    function def(o,k,v){ try{ Object.defineProperty(o,k,{ get:v, configurable:true }); }catch(e){} }
    def(Navigator.prototype,'webdriver',function(){ return false; });
    def(Navigator.prototype,'platform',function(){ return P.platform; });
    def(Navigator.prototype,'vendor',function(){ return 'Google Inc.'; });
    def(Navigator.prototype,'userAgent',function(){ return P.ua; });
    def(Navigator.prototype,'appVersion',function(){ return P.ua.replace(/^[^()]*(?=\\()/,''); });
    def(Navigator.prototype,'languages',function(){ return P.languages; });
    def(Navigator.prototype,'hardwareConcurrency',function(){ return P.cores; });
    def(Navigator.prototype,'deviceMemory',function(){ return P.memory; });
    def(Navigator.prototype,'maxTouchPoints',function(){ return 0; });
    def(Navigator.prototype,'doNotTrack',function(){ return null; });
    def(Navigator.prototype,'onLine',function(){ return true; });
    def(Navigator.prototype,'userAgentData',function(){ return { brands:P.secChUa.brands, mobile:P.secChUa.mobile, platform:P.secChUa.platform, getHighEntropyValues:function(){ return Promise.resolve({ brands:P.secChUa.fullVersionList, mobile:P.secChUa.mobile, platform:P.secChUa.platform, architecture:P.secChUa.architecture||'', model:P.secChUa.model||'', bitness:P.secChUa.bitness||'64', wow64:false }); } }; });
    def(Navigator.prototype,'connection',function(){ return { rtt:50, downlink:10, effectiveType:'4g', saveData:false, type:'wifi' }; });
    try {
      if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate = function(){ return Promise.resolve({ usage: 5e7+Math.floor(Math.random()*2e8)%200000000, quota: 1073741824, usageDetails:{} }); };
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) navigator.mediaDevices.enumerateDevices = function(){ return Promise.resolve([ {deviceId:'default',kind:'audioinput',label:'',groupId:'default'},{deviceId:'default',kind:'audiooutput',label:'',groupId:'default'},{deviceId:'default',kind:'videoinput',label:'',groupId:'default'} ]); };
    } catch(e){}
    var chromeObj={ app:{isInstalled:false,InstallState:{DISABLED:'disabled',INSTALLED:'installed',NOT_INSTALLED:'not_installed'},RunningState:{CANARY:'canary',CHROME:'chrome',CHROMIUM:'chromium',DEVELOPMENT:'development',STABLE:'stable',UNKNOWN:'unknown'}}, runtime:{connect:function(){return {postMessage:function(){},disconnect:function(){}}},sendMessage:function(){return Promise.resolve();},getManifest:function(){return {};},getURL:function(){return '';}}, loadTimes:function(){return {connectionInfo:'h2',wasFetchedViaSpdy:true,npnNegotiatedProtocol:'h2'};}, csi:function(){return {startE:0,onloadT:0,pageT:0,tran:15};}, webstore:{install:function(){}} };
    try{ Object.defineProperty(window,'chrome',{ get:function(){return chromeObj;}, configurable:true }); }catch(e){ window.chrome=chromeObj; }
    function ds(k,v){ try{ Object.defineProperty(Screen.prototype,k,{ get:function(){return v;}, configurable:true }); }catch(e){} }
    ds('width',P.screen.width); ds('height',P.screen.height); ds('availWidth',P.screen.availWidth); ds('availHeight',P.screen.availHeight); ds('colorDepth',24); ds('pixelDepth',24);
    try{ Object.defineProperty(window,'devicePixelRatio',{ get:function(){return P.dpr;}, configurable:true }); }catch(e){}
    try{ if(screen.orientation){ Object.defineProperty(screen.orientation,'type',{get:function(){return 'landscape-primary';},configurable:true}); Object.defineProperty(screen.orientation,'angle',{get:function(){return 0;},configurable:true}); } }catch(e){}
    // canvas LSB noise
    var seed=Math.floor(Math.random()*1e9);
    var gid=CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData=function(){ var img=gid.apply(this,arguments); var d=img.data; for(var i=0;i<d.length;i+=4){ var n=((seed+i)%5)-2; d[i]+=n;d[i+1]+=n;d[i+2]+=n; } return img; };
    var tdu=HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL=function(){ try{ var c=this.getContext('2d'); if(c&&c.getImageData){ var img=c.getImageData(0,0,this.width,this.height); c.putImageData(img,0,0);} }catch(e){} return tdu.apply(this,arguments); };
    // WebGL
    var ogp=(typeof WebGLRenderingContext!=='undefined')?WebGLRenderingContext.prototype.getParameter:null;
    function pg(p){ try{ var dbg=this.getExtension('WEBGL_debug_renderer_info'); if(dbg){ if(p===dbg.UNMASKED_VENDOR_WEBGL) return P.webglUnmaskedVendor; if(p===dbg.UNMASKED_RENDERER_WEBGL) return P.webglUnmaskedRenderer; } if(p===this.VENDOR) return P.webglVendor; if(p===this.RENDERER) return P.webglRenderer; }catch(e){} return ogp.apply(this,arguments); }
    if(typeof WebGLRenderingContext!=='undefined') WebGLRenderingContext.prototype.getParameter=pg;
    if(typeof WebGL2RenderingContext!=='undefined') WebGL2RenderingContext.prototype.getParameter=pg;
    // audio
    var ogc=(typeof AudioBuffer!=='undefined'&&AudioBuffer.prototype.getChannelData)?AudioBuffer.prototype.getChannelData:null;
    if(ogc){ AudioBuffer.prototype.getChannelData=function(ch){ var d=ogc.call(this,ch); if(d&&d.length){ for(var i=0;i<d.length;i+=111){ d[i]+=(Math.random()-0.5)*1e-7; } } return d; }; }
  })();`;
}

let __persona = null;
let __scriptId = null;

// ---------------------------------------------------------------------------
// stealth
// ---------------------------------------------------------------------------
export const stealth = {
  async enable(opts = {}) {
    const P = __pickPersona(opts.persona);
    await __cdp("Emulation.setUserAgentOverride", {
      userAgent: P.ua,
      acceptLanguage: P.lang,
      platform: P.platform,
      userAgentMetadata: P.secChUa,
    }).catch(() => {});
    await __cdp("Emulation.setTimezoneOverride", { timezoneId: P.timezone }).catch(
      () => {},
    );
    const r = await __cdp("Page.addScriptToEvaluateOnNewDocument", {
      source: __payload(P),
    }).catch(() => ({ identifier: null }));
    __scriptId = r.identifier || (r.result && r.result.identifier) || null;
    __persona = P;
    return P;
  },
  async disable() {
    if (__scriptId) {
      await __cdp("Page.removeScriptToEvaluateOnNewDocument", {
        identifier: __scriptId,
      }).catch(() => {});
    }
    await __cdp("Emulation.setUserAgentOverride", { userAgent: "" }).catch(() => {});
    await __cdp("Emulation.setTimezoneOverride", { timezoneId: "" }).catch(() => {});
    __scriptId = null;
    __persona = null;
  },
  async rotate(opts = {}) {
    await this.disable();
    return this.enable({ random: true, ...opts });
  },
  persona() {
    return __persona;
  },
  personas() {
    return __PERSONAS.map((p) => ({ id: p.id, label: p.label }));
  },
};

// ---------------------------------------------------------------------------
// captcha
// ---------------------------------------------------------------------------
export const captcha = {
  async detect() {
    try {
      const r = await __js(`(() => { const q=(s)=>document.querySelectorAll(s).length>0; return {
        ts: q('input[name="ts-response"]')||q('input[name="cf-turnstile-response"]'),
        cf: q('iframe[src*="challenges.cloudflare.com"]'),
        g: typeof window.grecaptcha!=='undefined',
        geo: typeof window.grecaptcha!=='undefined'&&typeof window.grecaptcha.enterprise!=='undefined'
      }; })()`);
      if (r?.ts) return "cloudflare-turnstile";
      if (r?.cf) return "cloudflare-iuam";
      if (r?.geo) return "recaptcha-enterprise";
      if (r?.g) return "recaptcha-v3";
      return "unknown";
    } catch {
      return "unknown";
    }
  },
  async cloudflare(opts = {}) {
    const deadline = Date.now() + (opts.timeoutMs ?? 30000);
    const autoClick = opts.autoClick !== false;
    const probe = `(() => { const inp=document.querySelectorAll('input[name="ts-response"]'); const v=[]; for(const e of inp){ if(e&&e.value&&e.value.length>10) v.push(e.value); } if(v.length) return v; if(window.__tsTokenPromise&&typeof window.__tsTokenPromise.then==='function') return window.__tsTokenPromise.then(x=>Array.isArray(x)?x:[x]); return null; })()`;
    if (autoClick) await this.clickTurnstile();
    while (Date.now() < deadline) {
      try {
        const val = await __js(probe);
        const arr = Array.isArray(val) ? val.filter((x) => typeof x === "string" && x.length) : [];
        if (arr.length) return { token: arr[0], tokens: arr };
      } catch {}
      if (autoClick) await this.clickTurnstile();
      await __sleep(opts.clickIntervalMs ?? 1000);
    }
    const val = await __js(probe).catch(() => null);
    const arr = Array.isArray(val) ? val.filter((x) => typeof x === "string") : [];
    if (arr.length) return { token: arr[0], tokens: arr };
    throw new Error("turnstile solve timed out");
  },
  async clickTurnstile() {
    try {
      const coords = await __js(`(() => { const c=[]; const push=(r)=>{ if(!r||r.width<=0||r.height<=0) return; c.push({x:r.x+30,y:r.y+r.height/2}); }; const el=document.querySelectorAll('[name="cf-turnstile-response"]'); if(el.length){ el.forEach(e=>{ const p=e.parentElement; if(p) push(p.getBoundingClientRect()); }); } else { let f=false; document.querySelectorAll('div').forEach(i=>{ try{ const r=i.getBoundingClientRect(); if(!f&&r.width>290&&r.width<=310){push(r);f=true;} }catch(e){} }); if(!f) document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]').forEach(i=>{ try{ push(i.getBoundingClientRect()); }catch(e){} }); } return c; })()`);
      if (Array.isArray(coords) && coords.length) {
        await hover([coords[0].x, coords[0].y]);
        await click([coords[0].x, coords[0].y]);
        return true;
      }
    } catch {}
    return false;
  },
  async recaptcha(opts = {}) {
    const sitekey = opts.sitekey;
    if (!sitekey) throw new Error("recaptcha requires sitekey");
    const action = opts.action ?? "submit";
    const enterprise = !!opts.enterprise;
    const readyKeys = enterprise
      ? ["grecaptcha", "enterprise"]
      : ["grecaptcha"];
    // humanize: read the page before solving
    await __sleep(__randInt(2000, 5000));
    try {
      await scroll({ dy: __randInt(200, 450) });
      await __sleep(__randInt(300, 800));
    } catch {}
    // inject grecaptcha if absent
    const api = enterprise ? "grecaptcha.enterprise" : "grecaptcha";
    const src = enterprise
      ? `https://www.google.com/recaptcha/enterprise.js?render=${sitekey}`
      : `https://www.google.com/recaptcha/api.js?render=${sitekey}`;
    await __js(`new Promise((res,rej)=>{ const get=()=>${api}.split('.').reduce((o,k)=>(o==null?o:o[k]),window); if(get()) return res(); const s=document.createElement('script'); s.src=${JSON.stringify(src)}; s.async=true; s.onload=()=>res(); s.onerror=()=>rej(new Error('inject failed')); document.head.appendChild(s); })`);
    const token = await __js(`new Promise((res,rej)=>{ const g=${enterprise?'window.grecaptcha.enterprise':'window.grecaptcha'}; if(!g){rej(new Error('grecaptcha not loaded'));return;} g.ready(()=>{ g.execute(${JSON.stringify(sitekey)},{action:${JSON.stringify(action)}}).then(res).catch(rej); }); })`);
    return token;
  },
  async clearance() {
    try {
      const cookies = await __cdp("Network.getCookies", {});
      const all = cookies?.cookies || cookies?.result?.cookies || [];
      const c = all.find((x) => x.name === "cf_clearance");
      return c ? { name: c.name, value: c.value, domain: c.domain } : null;
    } catch {
      return null;
    }
  },
  async solve(opts = {}) {
    const kind = opts.kind ?? (await this.detect());
    if (opts.url) {
      const info = await js(String.raw`window.location.href`).catch(() => "");
      if (!info || !info.includes(new URL(opts.url).origin)) {
        await openOrReuseTab(opts.url, { wait: true });
      }
    }
    if (kind === "cloudflare-turnstile" || kind === "cloudflare-iuam") {
      const r = await this.cloudflare(opts);
      const clearance = await this.clearance();
      return { kind, ...r, clearance };
    }
    if (kind === "recaptcha-v3" || kind === "recaptcha-enterprise" || kind === "recaptcha-v2") {
      const token = await this.recaptcha(opts);
      return { kind, token };
    }
    throw new Error(`no supported challenge detected: ${kind}`);
  },
};
