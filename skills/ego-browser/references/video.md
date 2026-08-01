# Video recording support

## Current status

TaskSpace pages are native Playwright Pages attached to an existing BrowserContext through `chromium.connectOverCDP()`. The context is not created with Playwright's `recordVideo` option, so `task.page.video()` returns `null` in the current runtime.

The former ego-browser `page.screencast.start()` / `page.screencast.stop()` extension and its FFmpeg recorder were removed when TaskSpaces adopted native Playwright. There is currently no supported API for recording a TaskSpace page directly to WebM or another video format.

## Handling a video request

1. Establish or resume the TaskSpace normally.
2. Check the current runtime once:

   ```js
   const video = task.page.video()
   console.log({ videoRecordingAvailable: video !== null })
   ```

3. When the result is `null`, tell the user that TaskSpace video recording is unavailable. Offer screenshots or a Playwright trace only when either artifact would satisfy the user's goal. A trace is not a video, so label it accurately.
4. When an actual video is required, stop and report that the runtime needs a supported recorder implementation. Do not claim that recording succeeded and do not create a placeholder video.

## Unsupported workarounds

- Do not use the removed `page.screencast` extension.
- Do not call `task.context.browser().newContext({ recordVideo: ... })`. That creates a BrowserContext outside the TaskSpace ownership, login-state, handoff, and cleanup model.
- Do not improvise a raw CDP-and-FFmpeg recorder unless the user explicitly asks to develop and validate that new capability. Frame timing, acknowledgements, finalization, and cleanup require a tested implementation.
