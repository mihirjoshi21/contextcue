# ContextCue — Fire TV app

Two Gradle modules: **`contextcue-sdk/`** (Android library, `com.contextcue.sdk`: API client, session
and heartbeat, Ask panel UI, skip ranges, phone "show on TV" answers, QR, Read aloud; no ExoPlayer; see
`contextcue-sdk/README.md` for the ~20-line integration) and **`app/`** (the reference sample/host:
ExoPlayer, home screen, settings, integrating the SDK the way a third party would).

Kotlin + Jetpack Compose for TV (`androidx.tv:tv-material`) + Media3 ExoPlayer. Talks to
`services/api` over plain HTTP (see `../../SPEC.md` for the wire contract). The app name is a
single constant (`AppConfig.APP_NAME`, backed by `BuildConfig.APP_DISPLAY_NAME`) so renaming the
product is a one-line change plus a rebuild.

## Requirements

- JDK 17
- Android SDK (`~/Library/Android/sdk` or set `ANDROID_HOME`/`ANDROID_SDK_ROOT`), platform 35 +
  build-tools 34+
- No local Gradle install needed — this repo ships a Gradle wrapper (`./gradlew`), pinned to
  Gradle 8.9.

## Build

```sh
cd apps/firetv-android
./gradlew assembleDebug        # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease      # -> app/build/outputs/apk/release/app-release.apk (debug-signed)
./gradlew testDebugUnitTest    # 45 JVM unit tests (SDK + app): timestamp formatting, API JSON parsing,
                                # heartbeat throttle, skip-range/playbackStartMs logic,
                                # phone-shared-answer dedupe, SDK controller contract
```

## Run the backend first

The app needs `services/api` reachable over HTTP. From the repo root:

```sh
npm install                       # once
PROVIDER=mock npm run dev -w @contextcue/api   # boots on :8787, no AWS creds needed
```

## Install

**Android emulator** (Android TV system image):

```sh
sdkmanager "system-images;android-34;android-tv;arm64-v8a"
avdmanager create avd -n contextcue_tv -k "system-images;android-34;android-tv;arm64-v8a" -d tv_1080p
emulator -avd contextcue_tv -no-window -no-audio &   # headless; drop the flags for a window
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -a android.intent.action.MAIN -c android.intent.category.LEANBACK_LAUNCHER \
    -n com.contextcue.tv/.MainActivity
```

The emulator's default API base URL (`http://10.0.2.2:8787`) already points at your host
machine's `services/api` — nothing to configure for emulator testing.

**Real Fire TV Stick (same Wi-Fi network as your dev machine):**

1. On the Fire TV: Settings → My Fire TV → Developer Options → turn on ADB debugging and "Apps
   from Unknown Sources".
2. Find its IP: Settings → My Fire TV → About → Network.
3. From your dev machine:
   ```sh
   adb connect <fire-tv-ip>:5555
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```
4. Launch "ContextCue" from the Fire TV home screen (it registers as a Leanback launcher app).
5. Open it, press the gear icon (top-right) → Settings, and set the API base URL to your dev
   machine's LAN IP, e.g. `http://192.168.1.23:8787` (the emulator-only `10.0.2.2` alias will
   **not** work on a real device). Make sure `services/api` is running and your machine's
   firewall allows inbound connections on port 8787.

## Using the app

- **Home**: hero + a row of titles fetched from `GET /v1/titles`. D-pad left/right/up/down to
  move focus (scale + purple border + glow on focus), select to play, gear icon (top-right) for
  Settings.
- **Player**: custom transport controls (rewind/pause/forward 10s, Ask, position). A session is
  created on open (`POST /v1/sessions`) and its position is heartbeat-updated
  (`PUT /v1/sessions/:code`) roughly every 2 seconds while playing.
- **Ask panel**: press the **Menu** button, or press **select while paused**, to open it. Video
  dims to ~40% and a right-side panel slides in with the four canned-question chips ("Catch me
  up", "Who's who so far", "What just happened?", "Why did they do that?"), a "⌨️ Type or dictate"
  chip (opens the system on-screen keyboard for a free-text question — many Fire TV remotes
  support voice dictation via its mic key; **unverified on real hardware**), and "Ask from your
  phone" (QR code + session code for the companion web app). Selecting a citation timestamp seeks
  back 2 seconds before that line and resumes playback. Answer + citations scroll together as one
  list if long. **Back** closes the panel and resumes.
- **Show on TV**: if someone asks a question from the phone companion with "show on TV" checked,
  the Fire TV app polls the session every ~2s, and the next distinct answer auto-pauses and opens
  the Ask panel labeled "📱 Asked from phone" — no TV-side action needed.
- **Skip broadcast interludes**: if a title has `playbackStartMs` and/or `skipRanges` (e.g. Night
  of the Living Dead's TV-host segments), first open starts past the intro, and playback
  auto-skips any interlude it plays into, showing a brief "⏩ Skipped: <label>" chip.
- **Welcome back**: if you leave the title paused for 5+ minutes, or background the app and come
  back, a one-press "want a 20-second recap?" card appears.
- **Errors**: if the backend can't be reached, screens show the API base URL that was tried and a
  button straight to Settings.
- **Artwork**: title cards and the Home hero (blurred backdrop of whichever card has D-pad focus,
  plus its license line) load `poster` via Coil, falling back to a plain gradient if there's no
  poster or it fails to load.

## Architecture notes

- `contextcue-sdk/.../data/ApiClient.kt` - OkHttp + kotlinx.serialization, one method per SPEC.md
  endpoint, returns `ApiResult<T>` so every screen can render a friendly error state.
- `contextcue-sdk/.../ContextCue.kt` - `ContextCue.Controller`: session, heartbeat
  (`util/HeartbeatThrottle.kt`), shared-answer polling, skipRanges, welcome-back, Ask state machine.
  Plain class with its own scope and explicit `release()`.
- `contextcue-sdk/.../ContextCueCompose.kt` - `rememberContextCueController`, `ContextCueOverlay`,
  `ContextCueAskButton`, `handleKey`.
- `app/.../ui/player/PlayerViewModel.kt` - host-only: owns the ExoPlayer and transport state.
  `PlayerScreen.kt` wires lambdas over that player into the SDK.
- `app/.../data/SettingsRepository.kt` - DataStore-backed API base URL override.
- No DI framework: view models are constructed with `remember { ... }` at the call site.

## Debug-only screenshot/QA deep link

Never wired into a release build (`BuildConfig.DEBUG`-gated):

```sh
adb shell am start -n com.contextcue.tv/.MainActivity \
    --es titleId night-of-the-living-dead-1968 --el seekMs 3480000
```

Jumps straight into that title and seeks to the given position, instead of navigating there by
hand every time — used to take the screenshots in `docs/screenshots/`.

## Known gaps

- CC/subtitle toggle is not implemented (SPEC.md marks it "nice-to-have"); subtitles stay off,
  which is the required default.
- Voice dictation through the "Type or dictate" chip's on-screen keyboard is unverified on real
  Fire TV hardware/remotes (no physical device available in this environment).
- No instrumentation/Compose UI tests — verification was done by building, running the JVM unit
  tests, and exercising the app live on an Android TV emulator against a running backend (see
  `docs/screenshots/firetv-*.png` and the commit history).
