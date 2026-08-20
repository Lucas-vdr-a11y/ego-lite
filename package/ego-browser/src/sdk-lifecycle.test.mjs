import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("disposeEgoSdk releases native callbacks and rejects pending CDP work", () => {
  const sdkUrl = new URL("../dist/src/index.js", import.meta.url).href;
  const runtimeUrl = new URL("../dist/src/browser-runtime.js", import.meta.url)
    .href;
  const script = `
    globalThis.ego = {
      respond: true,
      sendCDPMessage(payload) {
        const request = JSON.parse(payload);
        if (!this.respond) return;
        queueMicrotask(() => this.onCDPMessage(JSON.stringify({
          id: request.id,
          result: { targetInfos: [] },
        })));
      },
    };
    const sdk = await import(${JSON.stringify(sdkUrl)});
    const runtime = await import(${JSON.stringify(runtimeUrl)});
    await runtime.browserCdp("Target.getTargets", {}, undefined, 1_000);
    if (typeof ego.onCDPMessage !== "function") {
      throw new Error("CDP callbacks were not installed");
    }
    ego.respond = false;
    const pending = runtime.browserCdp("Target.getTargets", {}, undefined, 10_000);
    await sdk.disposeEgoSdk();
    if (ego.onCDPMessage !== undefined || ego.onSendCDPMessageError !== undefined) {
      throw new Error("disposeEgoSdk left native callbacks installed");
    }
    await pending.then(
      () => { throw new Error("pending CDP work unexpectedly resolved"); },
      (error) => {
        if (!/disposed/.test(error.message)) throw error;
      },
    );
    process.stderr.write("sdk lifecycle ok");
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    {
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /sdk lifecycle ok/);
});
