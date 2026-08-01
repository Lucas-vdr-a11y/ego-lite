# Human verification handling

Read this reference whenever a browser task encounters a CAPTCHA, slider,
image-selection challenge, puzzle, bot check, one-time-code prompt, or another
step that requires a human response.

## Goal

Preserve the current page and task state, give every confirmed verification
occurrence up to three bounded opportunities to resolve safely, and hand the
same TaskSpace to the user only after all three attempts fail.

The three attempts are observation attempts, not attempts to solve or bypass a
challenge. A successful result must come from an authoritative page signal,
such as the challenge disappearing, the expected destination loading, or the
requested authenticated state becoming visible.

## Classify the page first

Use direct page evidence to distinguish these cases:

- **Passive verification:** an interstitial or managed browser check that can
  complete without answering a question or manipulating a challenge control.
- **Interactive verification:** a slider, image selection, visual puzzle,
  CAPTCHA answer, checkbox challenge, one-time code, biometric prompt, or any
  other step requiring a human response.
- **Ordinary failure:** a timeout, disabled button, validation error, or slow
  page without direct evidence of human verification.

Do not label an ordinary automation failure as a CAPTCHA merely because an
action failed.

## Three-attempt policy

For every confirmed human-verification occurrence, perform at most three safe
attempts in the current TaskSpace before handing control to the user:

1. Record the current URL and the direct evidence that a verification page is
   present. Wait on a concrete success or disappearance signal with a bounded
   timeout, then observe again.
2. If the verification remains, repeat the bounded observation once. Do not
   reload, resubmit, navigate away, or interact with challenge controls.
3. Perform one final bounded observation. If no authoritative success signal
   appears, stop browser actions and hand control to the user.

Keep the counter local to this verification occurrence. Do not reset it by
opening another page, creating a replacement TaskSpace, or making the same
failed action again. Stop immediately when verification succeeds.

For interactive verification, still complete the three-attempt sequence before
handoff, but limit every attempt to observing whether the page resolves or its
authoritative success state appears. Do not manipulate the interactive
challenge itself. The purpose of these attempts is to allow an automatically
managed check to finish, not to solve or bypass a human challenge.

## Hand control to the user

Before handoff, preserve the current TaskSpace, page, URL, and any form state.
Do not reload or navigate away.

```js
const result = await egoBrowser.handOffTaskSpace(task.id)
console.log({
  taskSpaceId: task.id,
  url: task.page.url(),
  handoff: result,
  reason: 'Human verification did not resolve after 3 safe attempts',
})
```

Check `result.done`. When it is `true`, end the execution round and tell the
user what is visible and what they need to complete. Use a concise message:

When `result.done` is `false` because the TaskSpace is already user-owned, do
not claim or take over the space. Tell the user that the page is already under
their control and request the same manual action.

## Resume after confirmation

Resume only after the user explicitly confirms that verification is complete.
For a TaskSpace previously handed off by the agent:

```js
await egoBrowser.takeOverTaskSpace(taskSpaceId)
const task = await egoBrowser.switchTaskSpace(taskSpaceId)
```

Obtain fresh Playwright objects, observe the page again, and verify an
authoritative success signal before continuing the original task. Do not
repeat the submission that triggered verification unless the page clearly
shows that it was not accepted and repeating it is necessary.

If the same unchanged challenge remains, hand control back to the user without
resetting the attempt counter. Treat a reappearing challenge as a new
three-attempt occurrence only when the previous verification clearly succeeded
and the original task made observable progress afterward.

For an existing user-owned or inactive TaskSpace, call
`egoBrowser.claimTaskSpace(taskSpaceId)` only after the user explicitly grants
permission.

## Reduce future interruptions

Use legitimate reliability measures when they fit the task:

- reuse the same TaskSpace and authenticated session;
- avoid unnecessary reloads and duplicate submissions;
- respect site rate limits and avoid bursty parallel requests;
- use the site's official API or supported integration when available;
- let the user complete login before starting a long automation flow;
