# Friction log

Structured, dev-experience friction encountered while building ContextCue for the AWS Builder /
Fire TV hackathon submission. Every entry below happened while building this project; nothing here
is invented for the log.

---

### 1. Bedrock: bare Claude model ID silently doesn't work for on-demand calls

- **Task**: call Bedrock's Converse API with `modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0'`.
- **Steps**: read Bedrock model documentation, picked the model ID as it's commonly written, wired
  it into `BedrockProvider`.
- **Expected vs. actual**: expected the bare model ID to work for `bedrock-runtime` Converse/Invoke
  calls, like it does for some other providers/models. Actual: AWS's own docs state explicitly that
  for Haiku 4.5 (and the newer Sonnet 5), the bare ID is listed as **"N/A"** for on-demand
  throughput — only a `us.`/`eu.`/`au.`/`jp.`/`global.`-prefixed cross-region inference profile ID
  is valid.
- **Severity**: Medium (would have caused a runtime failure at demo time if not caught during
  research, not just a slow request).
- **Workaround**: used the `us.`-prefixed inference profile ID
  (`us.anthropic.claude-haiku-4-5-20251001-v1:0`), confirmed against the model's own Bedrock model
  card page.
- **Actionable suggestion**: Bedrock's model-picker/quickstart code snippets could surface a louder,
  more prominent warning (not just a table footnote) when a model requires an inference profile ID —
  this is an easy trap for anyone copying a model ID from a name/announcement rather than the exact
  sample code block.

### 2. Vega SDK: 20GB disk requirement blocks a from-scratch hackathon install

- **Task**: evaluate/install the Vega Developer Tools (Vega SDK, CLI, Virtual Device) as an
  alternative Fire TV build target.
- **Steps**: read the official install docs (`developer.amazon.com/docs/vega/.../install-vega-sdk.html`),
  checked disk budget before running the installer script.
- **Expected vs. actual**: expected a typical CLI + SDK install (low single-digit GB, similar to
  most mobile/web toolchains). Actual: official troubleshooting docs state **≥20GB free disk space**
  is required for VDT install — more than 3x the disk budget available for this task on the dev
  machine.
- **Severity**: High (blocked evaluating the Vega path entirely within this project's constraints;
  not a bug, but a real barrier to entry).
- **Workaround**: skipped the full SDK/Virtual Device install; verified only that the underlying
  React Native package (`@amazon-devices/react-native-kepler`) installs via plain `npm install` with
  no auth prompt, as a partial substitute for hands-on evaluation.
- **Actionable suggestion**: a documented "minimal CLI only, no Virtual Device" install path (for
  developers who just want to scaffold/build and test on a real device or in CI) would lower the
  barrier significantly versus requiring the full 20GB toolchain up front.

### 3. No official Fire TV emulator exists

- **Task**: run/test the Fire TV Android app without a physical device on hand at all times.
- **Steps**: searched Amazon's own developer docs for a Fire TV emulator.
- **Expected vs. actual**: expected an Amazon-branded Fire TV emulator/simulator, analogous to
  Android Studio's device emulators for phones. Actual: Amazon's own docs state developers should
  test "using an actual Fire TV device... instead of a virtual emulator" — the closest documented
  stand-in is a generic Google Android TV AVD, which lacks Amazon services (no Alexa, different
  remote-control key-code mapping in places).
- **Severity**: Medium (workable, but real-device testing remains necessary before judging, which
  is a scheduling/access constraint, not just a technical one).
- **Workaround**: used a standard Android TV AVD (API 28/30) for iterative development; documented a
  real-device `adb` sideload path for final verification.
- **Actionable suggestion**: an official, Amazon-maintained Fire TV emulator/system image (even a
  community-supported one bundled with Android Studio's SDK Manager) would materially speed up Fire
  TV app iteration for every hackathon participant without physical hardware constantly on hand.

### 4. MCP Streamable HTTP + Hono: the correct transport class isn't documented at the top level

- **Task**: mount an MCP server on a Hono app that also needs to run identically on Lambda.
- **Steps**: read the `@modelcontextprotocol/sdk` README/docs for HTTP transport guidance.
- **Expected vs. actual**: expected the SDK's top-level docs to point at a Hono/web-standard
  integration directly. Actual: the correct class,
  `WebStandardStreamableHTTPServerTransport`, was only found by reading the SDK's own **bundled
  example file** (`dist/esm/examples/server/honoWebStandardStreamableHttp.js`) inside
  `node_modules` — not surfaced in the README or the main docs site in a way that was found during
  research.
- **Severity**: Low-Medium (cost real research time; would be higher severity for a less
  Hono/web-standard-fluent team).
- **Workaround**: used the transport found in the bundled example, confirmed it also matches
  `hono/aws-lambda`'s Request/Response contract so the same handler runs unmodified on Lambda.
- **Actionable suggestion**: promote the web-standard transport (and its Hono compatibility) to the
  SDK's main README/quickstart — it's exactly the integration path anyone building a
  Lambda-deployable MCP server needs, and right now it's effectively undocumented outside the
  example source.

### 5. AWS sign-in sessions expired repeatedly mid-task

- **Task**: test the Bedrock provider against live AWS, run the eval with `EVAL_JUDGE=bedrock`, and deploy with `cdk deploy`.
- **Steps**: used `aws sso login` early on, and later `aws login --profile contextcue` on the hackathon account.
- **Expected vs. actual**: we expected a sign-in to last a working session. In practice sessions expired several times, sometimes mid-deploy (`Need to perform AWS calls ... but no credentials have been configured`). Each time, real-model testing and deploys stopped until we signed in again.
- **Severity**: Medium. Expiring sessions are expected, but the cost adds up on a deadline.
- **Workaround**: signed in again with `aws login --profile contextcue`, and kept a separate named profile so the default profile used by other work stayed untouched.
- **Actionable suggestion**: have `aws login` warn before a session expires, and let the CDK CLI offer to start sign-in when credentials are missing instead of failing.

### 6. No official subtitle track exists for any public-domain feature film

- **Task**: find a feature-length film with existing subtitles to use as the flagship spoiler-safety
  demo title.
- **Steps**: checked six public-domain feature film candidates on archive.org (Charade, His Girl
  Friday, Detour, D.O.A. 1950, Plan 9 from Outer Space, Nosferatu 1922, Night of the Living Dead).
- **Expected vs. actual**: expected at least one official/studio subtitle file among six classic
  titles. Actual: **every** subtitle file found for these titles is machine-generated (ASR), and
  most are low-quality/garbled (e.g. one file read "After the moon they handle her" for dialogue that
  should have been intelligible). Only two titles had clean, punctuated, YouTube-quality
  auto-captions.
- **Severity**: Medium (didn't block the project — a usable file was found — but consumed
  significant research time and required building a bespoke cleanup script).
- **Workaround**: used Night of the Living Dead's auto-captions, built
  `content/scripts/clean-rollup-srt.mjs` to de-duplicate YouTube-style roll-up caption repetition
  (raw: 3,153 cues / ~123K characters of duplicated text → cleaned: 1,172 cues / ~40K characters),
  strip inline ASR timing tags, and cut a ~6.5-minute host intro that precedes the film plus a host
  outro that explicitly narrates the ending as film criticism (a real, checked-in spoiler in the raw
  file).
- **Actionable suggestion**: this is squarely what this project's own Amazon Transcribe fallback
  path exists to solve for arbitrary content — the cleanup heuristics built here (roll-up
  de-duplication, speaker-marker splitting, overlong-cue re-segmentation) are directly reusable as a
  post-processing step for real Transcribe output, and are worth formalizing into a shared utility
  if this product continues past the hackathon.

### 7. CDK: `AWS_REGION` cannot be set as an explicit Lambda environment variable

- **Task**: set `AWS_REGION` explicitly in the Lambda's environment so the Bedrock/Polly clients
  have a known region without relying on ambient defaults.
- **Steps**: added `AWS_REGION` to the Lambda `environment` block in the CDK stack.
- **Expected vs. actual**: expected this to work like any other environment variable. Actual: `cdk
  synth` fails outright — Lambda reserves `AWS_REGION` as a runtime-managed variable and CDK refuses
  to let you set it explicitly.
- **Severity**: Low (caught immediately at synth time, not at runtime or demo time).
- **Workaround**: removed the explicit env var; the application code reads `process.env.AWS_REGION`
  at runtime and gets it from the Lambda runtime's own automatic injection either way.
- **Actionable suggestion**: CDK's synth-time error message for this case was clear enough to
  self-resolve quickly — no complaint about the error itself, just flagging it as a first-timer trap
  worth a one-line callout in CDK's own Lambda construct documentation ("do not set AWS_REGION
  explicitly — it's provided automatically").

### 8. Chrome headless silently clamps the layout viewport below 500px width

- **Task**: capture phone-companion screenshots at realistic mobile widths (360/390/430px) to verify
  a horizontal-overflow bug fix and produce real screenshots for docs.
- **Steps**: ran `chrome --headless=new --window-size=390,844 --screenshot=out.png` (and similar)
  against the companion dev server.
- **Expected vs. actual**: expected the rendered layout viewport to match the requested width.
  Actual: this machine's Chrome build (153.0.8010.54) silently clamps any `--window-size` request
  below 500px to a **minimum layout viewport width of 500px** — verified directly by comparing
  `window.innerWidth` via `--dump-dom` across widths (390/450/499 all reported `500`; 501 reported
  `501`). The output PNG is still saved at the requested pixel dimensions, so nothing errors — it
  silently renders a wider desktop-ish layout and **crops** it, which looks exactly like a real
  overflow/clipping bug in the resulting screenshot. This nearly caused a false-positive bug report
  (a screen not actually part of the reported issue looked like it also overflowed at 390px purely
  because of this clamp).
- **Severity**: Medium (cost real debugging time chasing a rendering bug that didn't exist, and
  risked shipping a "fix" for the wrong problem based on a misleading screenshot).
- **Workaround**: drove Chrome DevTools Protocol directly (`Emulation.setDeviceMetricsOverride` +
  `Page.captureScreenshot` over the `--remote-debugging-port` WebSocket, ~70 lines of Node, no
  headless-CLI flags involved) to set the *true* layout viewport, then independently confirmed via a
  full DOM scan (`getBoundingClientRect().right > innerWidth` for every element) that nothing
  actually crossed the viewport edge at 360/390/430 before trusting any screenshot.
- **Actionable suggestion**: Chrome's headless `--window-size`/`--screenshot` flag combination
  should either honor widths below 500px or fail loudly (a warning on stderr) rather than silently
  substituting a different viewport and rendering a screenshot that looks plausible but measures the
  wrong thing. This is a general Chrome DevTools/headless-mode issue, not Amazon/AWS-specific, but
  directly affected verifying a real UI bug in this project.

### 9. Non-story broadcast segments hidden inside a public-domain video rip (found twice, not once)

- **Task**: prepare a clean, spoiler-safety-appropriate subtitle track for the archive.org
  broadcast rip of Night of the Living Dead used as the flagship demo title.
- **Steps**: an initial keyword-search-based pass identified and removed an obvious ~6.5-minute
  host intro/outro wrapper (a community-TV broadcast package, not a clean film rip). Later, while
  authoring eval-harness trap cases and independently re-verifying every fact against the raw
  transcript (`evals/scripts/verify-cases.mjs`), a careful **linear** re-read (not just keyword
  search) found a **second, previously-missed host segment spliced into the middle of the film's own
  in-story radio news bulletin** (00:40:57–00:42:52) — a film-review/director-name/franchise-legacy
  digression that reads like film commentary, not broadcast banter, so the original keyword pass
  never flagged it as host content.
- **Expected vs. actual**: expected one contiguous intro/outro cut to fully separate "host content"
  from "film content." Actual: host content was interleaved *inside* the film's own dialogue,
  invisible to a keyword-only pass, and specifically dangerous because it names the film's real
  director — exactly the kind of world-knowledge-leak vector the product's spoiler guard exists to
  catch, except occurring naturally in the source data rather than as a hypothetical test case.
- **Severity**: High (a real, load-bearing spoiler/leak vector that shipped undetected through one
  full cleanup pass and was only caught by an unrelated, more rigorous verification exercise built
  for a different purpose).
- **Workaround**: generalized the cleanup script (`content/scripts/clean-rollup-srt.mjs`) from a
  single start/end trim to an arbitrary list of excluded ranges
  (`night-of-the-living-dead-1968.host-segments.json`, with exact quoted boundary lines and
  reasoning per range); regenerated the subtitle file; enforced the same ranges server-side as
  `skipRanges`, filtered out of the cue list before context building, retrieval, or the characters
  heuristic ever see them (not just skipped in the player UI); updated the two affected eval cases
  from "should reveal the director's name after N minutes" to "must never reveal it at any position"
  once the in-story reveal itself was confirmed to be host content, not film content.
- **Actionable suggestion**: for any project sourcing "clean" public-domain content from
  archive.org-style community/broadcast rips, budget for a full linear re-read of any auto-generated
  transcript, not just a keyword pass for expected wrapper phrases — non-film content can be
  stylistically similar enough to blend into a scene (here, a radio-news-bulletin-shaped digression
  inside an actual in-story radio news bulletin) that pattern matching alone will miss it.

### 10. `npm test` engine mismatch warning across workspaces (vitest major version split)

- **Task**: run `npm install` across all workspaces from the repo root.
- **Steps**: `packages/core` pins `vitest@^2.1.4` (to share a hoisted copy with `apps/companion`,
  also on `^2.1.x`); `services/api` independently uses `vitest@^5.0.2`.
- **Expected vs. actual**: expected a clean install. Actual: Node 25.2.1 in this dev environment
  doesn't satisfy vitest 5's declared `engines` range (`^22.12 || ^24 || >=26`) — npm prints an
  `EBADENGINE` warning on install. The test runner works fine in practice in this environment, but a
  stricter CI environment that enforces `engines` (e.g. `npm ci --engine-strict`) would fail where
  this one only warns.
- **Severity**: Low (cosmetic in this environment; could be higher in a CI
  pipeline that enforces engines strictly).
- **Workaround**: none applied — noted as a known, non-blocking warning
  rather than pinned around, since the two packages have independent, deliberate reasons for their
  respective vitest major versions (see Decisions, core #7 and api/infra #2).
- **Actionable suggestion**: if this project continues, either align on a single vitest major across
  workspaces or add an explicit `engines` override/CI flag to avoid surprising a future contributor
  running a strict-engine CI setup.

### 11. Vega installer (`get_vvm.sh`) cannot run non-interactively; fails with "failed to read input: EOF"

- **Task**: install Vega SDK on macOS 26 / M3 Pro from an automated (non-TTY) agent shell.
- **Steps**: `curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh | bash` (also tried with `</dev/null`).
- **Expected vs. actual**: docs say "press Enter for default directory". Actual: the script installs only the Vega CLI 1.4.2 to `~/vega/bin`, then dies at "Enter new component installation directory (press Enter to keep current): Error: failed to get SDK path: failed to read input: EOF" and prints "[X] Vega CLI not set up". No SDK/VVD is installed, and there is no documented `--yes`/`--sdk-dir` flag. Also, `~/vega/env` (which the docs say to `source`) does not exist in this version.
- **Severity**: Medium (blocks CI/agent installs; silent partial install).
- **Workaround**: `export PATH=$HOME/vega/bin:$PATH; yes "" | vega sdk install` (installs SDK 0.24.12112 + VVD, ~5.4 GB in `~/vega`). Add the PATH export to your shell profile.
- **Suggestion**: honor defaults when stdin is not a TTY, add `--yes`, and update docs (`source ~/vega/env` is stale; real flow is `vega sdk install`).

### 12. Vega Virtual Device GUI build crashes ~50s after "Virtual device ready" on macOS 26; `--no-gui` is stable

- **Task**: `vega virtual-device start`.
- **Expected vs. actual**: expected a persistent emulator window. Actual: (a) first-ever start printed "Deadline reached (60s) but virtual device unresponsive" because the default timeout is 60s (a second start with `-t 300` succeeded in ~10s); (b) in default GUI mode the qemu process reports ready, then crashes silently ~50s later (crashpad dumps in `/tmp/android-$USER/emu-crash-*.db/completed`, `vega virtual-device status` -> `running:false`); no error is shown to the user.
- **Severity**: High (looks like a working install, then the device disappears and `vega run-app -d VirtualDevice` says "Cannot find an instance of Vega Virtual Device").
- **Workaround**: `nohup vega virtual-device start -t 300 --no-gui &` - stable (verified running >5 min). Headless means `screencapture` is useless (no window).
- **Suggestion**: surface the emulator exit/crash in the CLI; default timeout >=180s for first boot; document `--no-gui` for macOS 26.

### 13. VVD shares adb port 5037 with Android Studio's adb; `vega device list` flaps between "Found" and "No devices found"

- **Task**: use `vega device ...` while an Android TV emulator (emulator-5554) was already running.
- **Expected vs. actual**: expected isolation. Actual: Vega's `vda` and the Android SDK `adb` both use tcp:5037; the VVD registers as `emulator-5556` in the same server. `vega device list` intermittently printed "No devices found" and `run-cmd` errored "No connected Vega devices found" even though qemu was running; it recovered after ~20s. Passing the serial (`-d emulator-5556`) was more reliable. Careful: `adb kill-server` would drop the Android emulator too.
- **Severity**: Medium.
- **Workaround**: retry after a few seconds; use `vega device ... -d emulator-5556`.
- **Suggestion**: use a distinct default port for vda (or `ANDROID_ADB_SERVER_PORT` isolation) and document the coexistence caveat.

### 14. No documented screenshot command for the VVD; `screenshooter` fails

- **Task**: capture the VVD screen.
- **Steps**: `vega device run-cmd -c 'screenshooter /tmp/s.png'`.
- **Expected vs. actual**: expected a PNG. Actual: "creating a buffer file for 8294400 B failed: Permission denied / error marshalling arguments for shoot". `vega device --help` lists no screenshot command, and `vega device copy-from` has swapped help text (`--source` described as "on the host", `--destination` "on the device").
- **Severity**: Medium.
- **Workaround**: use the emulator console (it is the Android emulator fork): read `~/.emulator_console_auth_token`, connect to localhost:5556, send `auth <token>` then `screenrecord screenshot <dir>` -> writes `Screenshot_<ts>.png` (1920x1080) into `<dir>`. Works headless.
- **Suggestion**: add `vega device screenshot`.

### 15. `AmazonAppDev/react-native-multi-tv-app-sample` Vega target does not build out of the box on SDK 0.24

- **Task**: `yarn install && yarn build:vega:debug` (apps/vega).
- **Expected vs. actual**: README claims Vega support. Actual, three sequential failures: (1) `react-native build-kepler` is deprecated (works with a warning, forwards to `build-vega`); (2) Metro/Babel fails: `[Reanimated] Babel plugin exception: Cannot find module '@babel/plugin-transform-template-literals'` (peer deps of `@amazon-devices/react-native-reanimated` not declared); (3) `vega build refused: 2 OS-version compliance error(s)`: manifest lacks `[os.version] min/target`.
- **Severity**: Medium (about 15 minutes to diagnose; error messages were good for #3).
- **Workaround**: in apps/vega `yarn add -D @babel/plugin-proposal-nullish-coalescing-operator @babel/plugin-proposal-optional-chaining @babel/plugin-transform-arrow-functions @babel/plugin-transform-shorthand-properties @babel/plugin-transform-template-literals`; then `vega project update-manifest --os-version 1.2 --os-min 1.2`; then `yarn build:debug`. After that it builds and runs on the VVD (screenshot: docs/screenshots/vega-multitv.png). Also needs yarn 4.5 (`corepack`), which is not installed by default with Node 25.
- **Suggestion**: upstream these fixes to the sample; Vega docs should call out that old samples need `update-manifest`.

### 16. New AWS account: Bedrock blocked by "account is being verified" for hours
- **Task:** First Bedrock Converse call from a brand-new Free-plan account.
- **Steps:** `aws bedrock-runtime converse --model-id us.anthropic.claude-haiku-4-5-20251001-v1:0 ...`
- **Expected:** A response, or a clear "enable model access" error.
- **Actual:** `AccessDeniedException: Your account is currently being verified...` and no indication of how long or what to do besides waiting / emailing.
- **Severity:** High (blocked all real-model testing for several hours on a hackathon timeline).
- **Workaround:** Built and tested against a local mock provider; retried later.
- **Suggestion:** Show verification status in the Bedrock console and surface an ETA; let Free-plan accounts use Bedrock playground/test calls during verification.

### 17. Anthropic use-case form: CLI call succeeded but the SDK still got "use case details have not been submitted"
- **Task:** Call Claude Haiku 4.5 from the Node.js AWS SDK after a successful CLI test.
- **Expected:** If one Converse call works, all do.
- **Actual:** `ResourceNotFoundException: Model use case details have not been submitted for this account` from the SDK, minutes after the CLI call returned text. Our provider swallowed the error, so the app just showed a fallback until we added logging.
- **Severity:** Medium.
- **Workaround:** Submitted the form in the Bedrock console, waited ~15 minutes.
- **Suggestion:** Prompt for the use-case form as part of first-call onboarding, and make the error message say where the form is.

### 18. react-tv-space-navigation (used by Amazon's multi-TV sample): rows that mount later go to the end of the focus order
- **Task:** Add a "Spoiler-safe picks" row (loaded from our API) above the sample's rows on Vega.
- **Expected:** D-pad Up/Down follows the visual order.
- **Actual:** The row rendered first visually but was unreachable — it registered after the other rows, so focus order put it last.
- **Severity:** Medium (looks like a broken integration).
- **Workaround:** Load the row's data together with the catalog so all rows mount in one pass.
- **Suggestion:** Document this in the sample's README ("rows must mount in order or use explicit indexes"), or expose an index prop for dynamically inserted rows.

### 19. Android TV system image ships with `hw.keyboard=no`: emulator ignores Mac keyboard and mouse
- **Task:** Let a human try the Fire OS build in the Android TV emulator.
- **Actual:** No clicks (TV has no touch) and no keyboard input — it looked frozen.
- **Severity:** Low/Medium for newcomers.
- **Workaround:** Set `hw.keyboard=yes` in the AVD `config.ini`; use arrows/Enter/Esc or Extended controls → D-pad.
- **Suggestion:** Default TV AVDs to `hw.keyboard=yes`, and a Fire OS emulator image would remove the need for this entirely.
