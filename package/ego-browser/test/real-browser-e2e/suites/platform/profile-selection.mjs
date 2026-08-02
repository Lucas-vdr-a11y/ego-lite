export const taskSpaceProfileCase = {
  name: "TaskSpace profile selection",
  kind: "platform",
  body() {
    return `
      const profiles = await egoBrowser.listProfile();
      assert(profiles.length > 0, "egoBrowser.listProfile returns an available profile");
      assert(
        profiles.every((profile) => typeof profile.id === "string" && profile.id.length > 0),
        "egoBrowser.listProfile returns non-empty profile ids"
      );
      assertEqual(
        new Set(profiles.map((profile) => profile.id)).size,
        profiles.length,
        "egoBrowser.listProfile returns unique profile ids"
      );
      assert(
        profiles.every((profile) => typeof profile.name === "string"),
        "egoBrowser.listProfile returns profile names"
      );
      assert(
        profiles.every((profile) => typeof profile.isDefault === "boolean"),
        "egoBrowser.listProfile returns default markers"
      );

      const defaultProfiles = profiles.filter((profile) => profile.isDefault);
      assertEqual(defaultProfiles.length, 1, "egoBrowser.listProfile returns one default profile");

      const defaultName = taskName + " profile default";
      const defaultTask = await egoBrowser.newTaskSpace(defaultName);
      assertEqual(defaultTask.name, defaultName, "newTaskSpace works without a profile id");
      await defaultTask.page.goto(baseUrl + "/?profile=implicit-default", {
        waitUntil: "load",
        timeout: 10_000,
      });
      assertEqual(
        await defaultTask.page.title(),
        "Ego Browser Lab",
        "the implicit-default Profile TaskSpace is operable"
      );
      const defaultClosed = await egoBrowser.closeTaskSpace(defaultTask.id);
      assertEqual(defaultClosed.done, true, "the implicit-default Profile TaskSpace is cleaned up");

      const selectedProfile = defaultProfiles[0];
      const explicitName = taskName + " profile explicit";
      const explicitTask = await egoBrowser.newTaskSpace(explicitName, selectedProfile.id);
      assertEqual(explicitTask.name, explicitName, "newTaskSpace accepts a listed profile id");
      await explicitTask.page.goto(baseUrl + "/?profile=explicit", {
        waitUntil: "load",
        timeout: 10_000,
      });
      assertEqual(
        await explicitTask.page.title(),
        "Ego Browser Lab",
        "the explicitly selected Profile TaskSpace is operable"
      );
      const explicitClosed = await egoBrowser.closeTaskSpace(explicitTask.id);
      assertEqual(explicitClosed.done, true, "the explicit Profile TaskSpace is cleaned up");

      let missingProfileId = "__ego_browser_missing_profile__";
      while (profiles.some((profile) => profile.id === missingProfileId)) {
        missingProfileId += "_";
      }
      const invalidName = taskName + " profile invalid";
      let invalidError;
      try {
        await egoBrowser.newTaskSpace(invalidName, missingProfileId);
      } catch (error) {
        invalidError = error;
      }
      assertEqual(
        invalidError?.error_code,
        "EGO_PROFILE_NOT_FOUND",
        "newTaskSpace reports an unknown profile with a stable error code"
      );
      const spacesAfterInvalidProfile = await egoBrowser.listTaskSpace();
      assert(
        !spacesAfterInvalidProfile.some((space) => space.name === invalidName),
        "an unknown profile does not leave a TaskSpace"
      );
    `;
  },
};
