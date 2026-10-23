# @contextcue/react-native-tv

Drop-in React Native TV SDK for **ContextCue**: spoiler-safe AI Q&A while you watch. The viewer presses an "Ask" button, a right-side panel offers one-press questions ("Catch me up", "Who's who so far", ...), and answers are grounded only in dialogue that has already played. Citations are tappable and seek the player back.

- Pure React + `react-native` primitives. **No native modules, no Expo-only APIs, no platform-specific imports.**
- Works on **Fire OS** (`react-native-tvos`) and **Vega OS** (React Native for Vega); also fine on Android TV / tvOS.
- Parity with the Kotlin Fire TV Ask panel: session + 2s heartbeat (`X-TV-Token`), chips, "Spoiler-safe until mm:ss" badge, loading skeleton, citations, Read aloud, "Ask from your phone", "Asked from phone" mirrored answers, Back handling, 10-foot styles (min 24 font), visible focus states.

Screenshots: TBD.

## Integrate in ~20 lines

```tsx
import { useContextCue, ContextCueAskButton, ContextCueOverlay } from '@contextcue/react-native-tv';

function Player({ titleId }) {
  const [paused, setPaused] = useState(false);
  const timeRef = useRef(0);                     // seconds, from your player's onProgress
  const videoRef = useRef<VideoRef>(null);       // react-native-video

  const cue = useContextCue({
    apiBaseUrl: 'https://8ctx9nuzjk.execute-api.us-east-1.amazonaws.com',
    titleId,                                     // an id from GET /v1/titles
    getPositionMs: () => timeRef.current * 1000,
    isPlaying: !paused,
  });

  return (
    <View style={{ flex: 1 }}>
      <Video ref={videoRef} paused={paused} onProgress={(p) => (timeRef.current = p.currentTime)} /* ... */ />
      <ContextCueAskButton onPress={cue.open} />
      <ContextCueOverlay
        controller={cue}
        onSeek={(ms) => videoRef.current?.seek(ms / 1000)}
        onRequestPause={() => setPaused(true)}
        onRequestResume={() => setPaused(false)}
      />
    </View>
  );
}
```

Render `ContextCueOverlay` last (it is absolutely positioned, `zIndex: 1000`). It renders nothing while closed.

## API

### `useContextCue(options)` -> `ContextCue`

| Option | Type | Notes |
|---|---|---|
| `apiBaseUrl` | `string` | Required. No trailing slash needed. |
| `titleId` | `string` | Required. Must exist in the catalog (`GET /v1/titles`). |
| `getPositionMs` | `() => number` | Required. Current playhead in ms. Called on every heartbeat and when the panel opens. |
| `isPlaying` | `boolean` | Required. Drives the heartbeat `playing` flag and whether the panel pauses/resumes your player. |
| `playAudio` | `(base64, contentType) => Promise<void> \| void` | Enables **Read aloud**. See "Audio". Button is hidden without it. |
| `stopAudio` | `() => void` | Called when Read aloud is stopped or the panel closes mid-speech. |
| `audience` / `locale` | `'adult' \| 'kids'` / BCP-47 | Passed to `/v1/ask`. |
| `companionUrl` | `(code) => string` | Override the URL shown in "Ask from your phone". Default `<apiBaseUrl>/companion/?code=<code>`. |
| `fetch` | fetch-like | Override global `fetch`. |
| `heartbeatIntervalMs`, `pollIntervalMs` | `number` | Defaults 2000. |
| `disableSession` | `boolean` | No session/heartbeat/polling (asks go without a session code). |

Returns `{ state, open, close, back, controller }`. `state` is `{ open, view, ask, positionMs, ttsPlaying, sessionCode, canReadAloud, companionUrl }`.

### `<ContextCueOverlay />`

| Prop | Type | Notes |
|---|---|---|
| `controller` | `ContextCue` | The value from `useContextCue`. |
| `onSeek` | `(ms) => void` | Called with `citation.startMs - 2000` (min 0). The panel then closes and resumes. |
| `onRequestPause` | `() => void` | Called when the panel opens (or a phone answer arrives) while playing. |
| `onRequestResume` | `() => void` | Called when the panel closes, only if it paused you. |
| `renderQr` | `(url, size) => ReactNode` | Optional, e.g. `react-native-qrcode-svg`. The session code and URL are always shown as text. |
| `subscribeBack` | `(handler: () => boolean) => () => void` | Optional Back-key adapter. Default uses RN `BackHandler`. Pass your own if your platform delivers Back via another API (e.g. a TV event handler). |
| `style` | `ViewStyle` | Applied to the scrim. |

### `<ContextCueAskButton onPress label? style? hasTVPreferredFocus? />`

Focusable `Pressable` with a visible focus ring.

### Framework-free exports

`ContextCueController`, `createApiClient`, `HeartbeatThrottle`, `SharedAnswerDeduper`, `panelReducer`, `formatTimestamp`, `ASK_CHIPS`, `theme`. Build a fully custom UI on top of the controller if you prefer.

## Audio (Read aloud)

React Native has no built-in audio. `/v1/speak` returns base64 mp3 (Amazon Polly); you supply playback:

```tsx
useContextCue({
  /* ... */
  playAudio: async (b64) => {                    // expo-av example
    const { sound } = await Audio.Sound.createAsync({ uri: `data:audio/mpeg;base64,${b64}` });
    await new Promise<void>((done) => { sound.setOnPlaybackStatusUpdate((s) => s.isLoaded && s.didJustFinish && done()); sound.playAsync(); });
    await sound.unloadAsync();
  },
});
```

`react-native-video` (a hidden `<Video source={{ uri: 'data:audio/mpeg;base64,...' }} audioOnly />`) and the Vega W3C media `AudioPlayer` work the same way: resolve the promise when playback ends. Returning `void` is treated as "finished". On the mock backend `audioBase64` is empty and `playAudio` is not called.

## Platform notes

- **Fire OS**: use [`react-native-tvos`](https://github.com/react-native-tvos/react-native-tvos). Focus uses `Pressable` `onFocus/onBlur` and `hasTVPreferredFocus`; the first chip gets initial focus. The remote Back key reaches `BackHandler`.
- **Vega OS** (React Native for Vega): the same code path; nothing imports `@amazon-devices/*`. If Back arrives through a different mechanism in your app, pass `subscribeBack`. Audio via `@amazon-devices/react-native-w3cmedia` goes in `playAudio`.
- Network: plain `fetch` + JSON. No SSE/streaming is used (`POST /v1/ask`).
- Not verified on real hardware yet.

## Wiring into `AmazonAppDev/react-native-multi-tv-app-sample`

The sample's `PlayerScreen` (`packages/shared-ui/src/screens/PlayerScreen.tsx`) owns `paused` state, a `currentTimeRef` in **seconds** (from `VideoPlayer`'s `onProgress`), and `videoRef.current.seek(seconds)` (react-native-video). Wire it as above:

```tsx
const cue = useContextCue({ apiBaseUrl, titleId, getPositionMs: () => currentTimeRef.current * 1000, isPlaying: !paused });
// in the tree, after <VideoOverlay/>:
<ContextCueAskButton onPress={cue.open} />
<ContextCueOverlay controller={cue} onSeek={(ms) => seek(ms / 1000)} onRequestPause={() => setPaused(true)} onRequestResume={() => setPaused(false)} />
```

Caveats: (1) the sample's `RemoteControlManager` keydown listener handles `Back` with `navigation.goBack()`; while the panel is open, either skip it (`if (cue.state.open) return cue.back()`) or ignore it and rely on `BackHandler`. (2) It also seeks on Left/Right; ignore those while `cue.state.open`. (3) The sample uses `react-tv-space-navigation` on Android; if overlay focus is not captured, wrap the overlay in a `SpatialNavigationRoot`/`DefaultFocus` or rely on `hasTVPreferredFocus`. (4) The Vega variant (`PlayerScreen.vega.tsx`) uses the W3C `VideoPlayer`: use `getPositionMs: () => videoPlayer.currentTime * 1000`, `onSeek: (ms) => { videoPlayer.currentTime = ms / 1000 }`, `onRequestPause: () => videoPlayer.pause()`, `onRequestResume: () => videoPlayer.play()`, and a `titleId` that exists in the ContextCue catalog (the sample's own catalog ids will not).

## Develop

```
npm run build -w @contextcue/react-native-tv   # tsc -> dist (ESM + d.ts)
npm test -w @contextcue/react-native-tv        # vitest
```

MIT.
