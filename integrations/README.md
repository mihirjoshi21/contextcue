# integrations/

`react-native-multi-tv-app-sample/` is a **separate git repository** (a clone of AmazonAppDev/react-native-multi-tv-app-sample, branch `contextcue-spoiler-safe-qa`). The outer repo ignores it (.gitignore); push it to your own GitHub fork:
`cd integrations/react-native-multi-tv-app-sample && git remote add fork <your-fork-url> && git push fork contextcue-spoiler-safe-qa`.

Commits: three upstream-worthy Vega build fixes (see UPSTREAM_PR.md) + one ContextCue integration commit.

## What the fork changes (ContextCue commit)
- `vendor/contextcue-react-native-tv-0.1.0.tgz` - SDK as `npm pack` tarball (no symlinks/workspace tricks for Metro); `packages/shared-ui/package.json` depends on it via `file:`. Rebuild: `npm run build -w @contextcue/react-native-tv && npm pack -w ...` then copy and `yarn install`.
- `packages/shared-ui/src/data/moviesData.ts` - `fetchContextCueTitles()` (GET /v1/titles), `titleId` on CardData.
- `.../navigation/types.ts`, `DetailsScreen.tsx` - pass optional `titleId` Home -> Details -> Player.
- `.../screens/HomeScreen.tsx` - "Spoiler-safe picks (ContextCue)" row (hidden if API unreachable).
- `.../screens/PlayerScreen.vega.tsx` - `useContextCue`, `ContextCueOverlay`, Back/D-pad guarded while panel open.
- `.../components/player/VideoOverlay.vega.tsx` - SDK `ContextCueAskButton` wrapped in the sample's `SpatialNavigationFocusableView` so D-pad reaches it.

## Diff highlight (PlayerScreen.vega.tsx)
```tsx
const cue = useContextCue({
  apiBaseUrl: CONTEXTCUE_API_URL, titleId: titleId ?? '',
  getPositionMs: () => (videoRef.current?.currentTime ?? currentTimeRef.current) * 1000,
  isPlaying: !paused, disableSession: !titleId,
});
<SpatialNavigationRoot isActive={isFocused && !cue.state.open}>
<VideoOverlay ... onAsk={titleId ? cue.open : undefined} />
<ContextCueOverlay controller={cue} onSeek={ms => seek(ms / 1000)}
  onRequestPause={() => { videoHandlerRef.current?.pause(); setPaused(true); }}
  onRequestResume={() => { videoHandlerRef.current?.play(); setPaused(false); }} />
```

## Build / run on the VVD
```
export PATH=/private/tmp/claude-501/bin:$HOME/vega/bin:$PATH   # yarn 4 via corepack, vega CLI
nohup vega virtual-device start -t 300 --no-gui &
cd integrations/react-native-multi-tv-app-sample && yarn install && cd apps/vega
yarn build:debug
vega run-app build/aarch64-debug/vega_aarch64.vpkg -d VirtualDevice
```
STATUS: the integration is written and committed but NOT yet built or run on the VVD - see the report.
