import { homeCase } from "./shared.mjs";

export const playwrightTargetCases = [
  {
    name: "regression PWB-07 stale target guard",
    body: homeCase(`
      const scratch = await tabs.openOrReuse(
        baseUrl + "/secondary?scratch=" + Date.now(),
        { wait: true, timeout: 5000 }
      );
      assert(scratch?.targetId, "PWB-07 new tab returns targetId");
      await tabs.close(scratch);
      const refreshed = await tabs.list();
      assert(
        !refreshed.some((tab) => tab.targetId === scratch.targetId),
        "PWB-07 closed target is absent from refreshed tabs"
      );
      await assertRejects(
        () => tabs.activate(scratch),
        "tabs.activate target not found",
        "PWB-07 stale target fails at the validated boundary"
      );
    `),
  },
  {
    name: "regression PWB-08 target field guard",
    body: homeCase(`
      const openTabs = await tabs.list();
      assert(
        openTabs.every((tab) => typeof tab.targetId === "string" && tab.targetId.length > 0),
        "PWB-08 tabs.list exposes targetId"
      );
      const missing = openTabs.find((tab) => tab.url.includes("/never-created-target"));
      assertEqual(missing, undefined, "PWB-08 missing lookup is checked before dereference");
      await assertRejects(
        () => tabs.activate({ id: openTabs[0].targetId }),
        "tabs.activate requires a targetId",
        "PWB-08 id/targetId mismatch fails with an owned error"
      );
    `),
  },
];
