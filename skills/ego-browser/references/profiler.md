# Browser Profile selection

Use this reference only when the user explicitly requires a specific browser Profile for a newly created TaskSpace. Only a direct, declarative requirement such as “create this TaskSpace with my Work Profile” or “use Profile 2 for this browser task” qualifies.

For ordinary browser work, do not inspect or select Profiles. Create the TaskSpace normally and let the browser use its default regular Profile:

```js
const task = await egoBrowser.newTaskSpace(shortGoalName)
```

Do not infer a Profile requirement from the target website, an expected login, an account name, the current page, available Profiles, or previous tasks. “Open Gmail”, “use my existing login”, and similar requests do not authorize choosing a specific Profile.

## Explicit Profile requirement

Only after the user explicitly names or identifies the required Profile, list the available Profiles:

```js
const profiles = await egoBrowser.listProfile()
```

Profile `id` is the unique locator accepted by `newTaskSpace`; `name` is a user-visible label and may be duplicated. Never pass a display name as `profileId`.

When the user provides an exact Profile id:

```js
const profile = profiles.find(item => item.id === requestedProfileId)
if (!profile) {
  throw new Error(`Profile not found: ${requestedProfileId}`)
}

const task = await egoBrowser.newTaskSpace(shortGoalName, profile.id)
```

When the user provides a display name, resolve it without guessing:

```js
const matches = profiles.filter(item => item.name === requestedProfileName)
if (matches.length !== 1) {
  throw new Error(`Profile name is missing or ambiguous: ${requestedProfileName}`)
}

const [profile] = matches
const task = await egoBrowser.newTaskSpace(shortGoalName, profile.id)
```

If no Profile matches, or multiple Profiles share the requested name, stop and ask the user which Profile id to use. Do not silently fall back to the default Profile.

Profile selection applies only when creating a TaskSpace. An existing TaskSpace keeps the Profile with which it was created; do not create a replacement TaskSpace unless the user explicitly requests the Profile-specific creation or authorizes replacing the existing space.
