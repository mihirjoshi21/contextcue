# Candidate upstream PR: "Fix Vega build: missing babel plugins, manifest os-version, build script"

Target: AmazonAppDev/react-native-multi-tv-app-sample (apps/vega). Verified against Vega SDK 0.24.12112 / CLI 1.4.2 on macOS 26 (arm64); the app then builds and launches on the Vega Virtual Device.

Three independent commits on branch `contextcue-spoiler-safe-qa` (cherry-pick onto a clean branch):

1. `vega: add missing Babel plugins required by @amazon-devices/react-native-reanimated` - Metro fails with `[Reanimated] Babel plugin exception: Cannot find module '@babel/plugin-transform-template-literals'`. Adds the five peer plugins as devDependencies of apps/vega.
2. `vega: declare [os.version] in manifest.toml` - `vega build` refuses with "2 OS-version compliance error(s)". Generated with `vega project update-manifest --os-version 1.2 --os-min 1.2`.
3. `vega: use build-vega instead of deprecated build-kepler` - `react-native build-kepler` prints a deprecation warning and forwards to `build-vega`.

Test plan: `yarn install && yarn build:vega:debug` then `vega run-app apps/vega/build/aarch64-debug/vega_aarch64.vpkg -d VirtualDevice`.
