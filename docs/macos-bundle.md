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

## Required Metadata

The macOS bundle also includes usage descriptions in `src-tauri/Info.plist`:

```text
NSMicrophoneUsageDescription
NSCameraUsageDescription
```

These keys must stay present because the app has voice-related functionality and macOS can terminate apps that access protected devices without usage strings.

## Verification

Build and inspect the app bundle:

```sh
npm run tauri -- build --bundles app
plutil -p target/release/bundle/macos/KaitenCode.app/Contents/Info.plist
```

Launch through LaunchServices, which matches Finder more closely than running the executable directly:

```sh
open -n target/release/bundle/macos/KaitenCode.app
```

The app should open without a new `~/Library/Logs/DiagnosticReports/kaitencode-*.ips` report. Terminal launches through `target/release/kaitencode` should continue to work.
