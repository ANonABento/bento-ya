# macOS Bundle Launch Notes

## Finder Launch Crash

KaitenCode originally used `com.bento-ya.app` as the Tauri bundle identifier. Tauri warns against bundle identifiers ending in `.app` because that suffix conflicts with the `.app` package extension used by macOS application bundles. On affected Finder/LaunchServices launches, the app could abort during `tao::did_finish_launching`, producing a crash report with `SIGABRT` on the main thread before the window finished opening.

It was then changed to `com.bentoya.desktop` to keep the reverse-DNS shape without using the reserved-looking `.app` suffix. The renamed app now uses `com.kaitencode.desktop`; macOS treats this as a new app identity, so users re-grant protected permissions after upgrading. The generated `Info.plist` should contain:

```text
CFBundleIdentifier = com.kaitencode.desktop
CFBundlePackageType = APPL
CFBundleExecutable = kaitencode
```

The app also keeps Tauri `setup()` lightweight during macOS launch. Startup recovery that can touch SQLite, tmux, shell commands, or pipeline resume runs from background tasks after Tauri has returned from `didFinishLaunching`.

Local builds use ad-hoc signing by default via `bundle.macOS.signingIdentity = "-"`. Public release builds must provide Developer ID signing and notarization secrets in the release workflow; the workflow fails early if the Apple signing/notarization secrets are missing. For notarization, provide either `APPLE_API_KEY_PATH` when the `.p8` key file already exists on the runner, or `APPLE_API_KEY_P8` with the private key contents so the workflow can write a temporary key file before `tauri-action` runs.

In-app updates are also build-configured. A build needs all of the following before Settings > Updates can check for releases:

- `TAURI_UPDATER_PUBKEY`
- an updater endpoint in `tauri.conf.json`
- updater artifacts generated during `tauri build`

Local ad-hoc builds intentionally ship with updater artifacts disabled, so the app reports that updates are not configured for the build instead of attempting a network check.

The release workflow also runs the same preflight gates as CI before packaging, pins explicit macOS runner labels per architecture, and builds explicit bundle targets (`dmg,app` for macOS; `deb,appimage` for Linux) instead of relying on `targets = "all"`. Linux updater artifacts are for AppImage builds; `.deb` packages are manual install/upgrade artifacts.

Release workflow runs create draft releases for inspection. Publish the draft after verifying artifacts so the `/releases/latest/download/latest.json` updater endpoint points at the new version.

## Required Metadata

The macOS bundle also includes the usage description currently needed by native features in `src-tauri/Info.plist`:

```text
NSMicrophoneUsageDescription
```

This key must stay present because the app has voice-related functionality and macOS can terminate apps that access protected devices without usage strings. Do not add camera or other protected-device permissions until the app actually uses those APIs.

## Verification

Build and inspect the app bundle:

```sh
pnpm tauri build --bundles app
plutil -p target/release/bundle/macos/KaitenCode.app/Contents/Info.plist
```

Launch through LaunchServices, which matches Finder more closely than running the executable directly:

```sh
open -n target/release/bundle/macos/KaitenCode.app
```

The app should open without a new `~/Library/Logs/DiagnosticReports/kaitencode-*.ips` report. Terminal launches through `target/release/kaitencode` should continue to work.
