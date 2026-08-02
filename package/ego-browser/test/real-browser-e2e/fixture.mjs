let testSiteModule;

async function loadTestSite() {
  testSiteModule ??= import("./site/dist/server.mjs");
  return testSiteModule;
}

export async function startFixtureServer(taskName) {
  return (await loadTestSite()).startTestSite(taskName);
}

export async function closeFixtureServer(server) {
  return (await loadTestSite()).closeTestSite(server);
}
