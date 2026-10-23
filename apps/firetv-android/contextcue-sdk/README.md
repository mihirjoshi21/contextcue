# contextcue-sdk

Spoiler-safe AI Q&A for any Fire OS video app, as an Android library
(`com.contextcue.sdk`, Jetpack Compose for TV). The host owns the player; the SDK has **no
ExoPlayer/Media3 dependency**.

## Integrate in ~20 lines (Compose + ExoPlayer)

```kotlin
// settings.gradle.kts: include(":contextcue-sdk")   build.gradle.kts: implementation(project(":contextcue-sdk"))
@Composable
fun PlayerScreen(player: ExoPlayer, titleId: String) {
    val contextCue = rememberContextCueController(
        apiBaseUrl = "https://8ctx9nuzjk.execute-api.us-east-1.amazonaws.com",
        titleId = titleId,                          // id from GET /v1/titles
        positionProvider = { player.currentPosition },
        isPlaying = { player.isPlaying },
        onSeek = { player.seekTo(it) },
        onPause = { player.pause() },
        onResume = { player.play() },
        // skipRanges = title.skipRanges,           // optional: auto-skip interludes
    )
    Box(Modifier.fillMaxSize().onKeyEvent { contextCue.handleKey(it) }) {   // Menu key toggles the panel
        AndroidView(factory = { PlayerView(it).apply { this.player = player; useController = false } })
        ContextCueAskButton(contextCue, Modifier.align(Alignment.TopEnd))    // optional visible button
        ContextCueOverlay(contextCue)                                        // panel, phone answers, recap
    }
}
```

`rememberContextCueController` creates the controller and releases it when the composable leaves.
Outside Compose use `ContextCue.Controller(context, ...)` and call `release()` yourself.
The manifest needs `INTERNET` (merged in by the SDK) and, for plain-http dev backends, a network
security config in the host.

## What the host provides

| Input | Purpose |
|---|---|
| `positionProvider` | The playhead (ms). Sent with every question; this is the spoiler ceiling. |
| `isPlaying` | Drives heartbeat cadence and the "welcome back" (paused 5+ min) prompt. |
| `titleId` | Which title's transcript/knowledge the backend uses. |
| `apiBaseUrl` | The ContextCue backend (`services/api`). |
| `onSeek` / `onPause` / `onResume` | The SDK never touches your player directly. |

## What the SDK does

- Creates a session and sends a position heartbeat every ~2s (`X-TV-Token` on every PUT, one
  re-create on 403).
- Ask panel: four canned chips, type-or-dictate, "Ask from your phone" QR + session code, answer
  card with timestamped citations (select = seek 2s earlier and resume), Read aloud (platform
  `MediaPlayer`, no ExoPlayer).
- Polls for phone-companion "show on TV" answers (deduped by id): pauses and shows the answer.
- `skipRanges`: seeks past listed intervals and shows a "Skipped" chip. `controller.showNotice()`
  lets the host show the same chip for its own skips.
- "Welcome back, want a 20-second recap?" after a 5+ minute pause or backgrounding.
- Back closes the panel (resuming playback). Theme tokens (`Cc*`, `CcType`, `ContextCueTheme`).

## Spoiler guarantees

The ceiling is enforced **server-side**: every `/v1/ask` carries the playhead `positionMs` and the
backend only retrieves and answers from content at or before it (see `SPEC.md`). The SDK shows
"Spoiler-safe until mm:ss" from that same value but is not the enforcement point, so a buggy or
modified client cannot widen what the model sees beyond what the position it sends allows.
