# Embedded SDK disposal

When Ego Lite unloads or replaces an embedded ego-browser Node context, it
should call and await the module's exported `disposeEgoSdk()` function before
destroying that context.

The function rejects unfinished CDP requests, clears Page/session state, and
removes `onCDPMessage` and `onSendCDPMessageError` only when they are still
owned by that SDK instance. This prevents native code from retaining callbacks
into a discarded JavaScript context.

No new binding method is required. The host only needs to honor the module
lifecycle hook. Older SDK builds without `disposeEgoSdk` may be unloaded as
before.

Acceptance: load the SDK, complete one CDP command, leave another command
pending, call `disposeEgoSdk()`, then verify that the pending command rejects
and both native callback slots are empty before the Node context is destroyed.
