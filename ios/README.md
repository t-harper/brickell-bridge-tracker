# BridgeTracker iOS

Native SwiftUI app for the Brickell Avenue Bridge tracker. Minimum iOS **17.0**.

## Features

- Live status card (UP/DOWN + metadata + map pin)
- **Live Activities** — lock-screen + Dynamic Island, updates push-driven when APNs is wired up
- **Home / Lock screen widgets** — small, medium, accessory (inline, circular, rectangular)
- **App Intents** — "Hey Siri, is the Brickell Bridge up?" plus Shortcuts and Spotlight
- **Push notifications** for open/close events
- **MapKit** location view (open in Apple Maps)
- Haptics on status change
- Native HIG layout: `NavigationStack`, `ContentUnavailableView`, SF Symbols, materials

## Build

1. Install [XcodeGen](https://github.com/yonaskolb/XcodeGen):

   ```sh
   brew install xcodegen
   ```

2. Generate the Xcode project:

   ```sh
   cd ios
   xcodegen generate
   open BridgeTracker.xcodeproj
   ```

3. In Xcode, select a signing team on both targets (main app + widget extension), then Run.

## Configure the API base URL

The URL lives in `Shared/BuildConfig.swift` as a Swift constant and is consumed by
`Shared/APIClient.swift`. CI overwrites this file on every archive build using the
`API_BASE_URL` workflow input (default `https://bridge.travis-harper.net`).

For local builds, edit `BuildConfig.swift` directly:

- Simulator → host: keep the default `http://localhost:3001` and run `npm run dev`.
- Real device on the same Wi-Fi: set it to `http://<mac-lan-ip>:5173`
  (Vite also proxies `/api` correctly).
- Prod: set to your public API URL.

## Wiring APNs (for Live Activity remote updates)

Without APNs configured, Live Activities still start and update while the app is in the
foreground. Remote push updates require:

1. Apple Developer account, enable **Push Notifications** and **Live Activities** on the
   app identifier.
2. Create an APNs auth key (.p8) in the Apple Developer portal. Note the **Key ID**
   and your **Team ID**.
3. In a copy of `infra/envs/prod.tfvars` (or local.tfvars), set:

   ```hcl
   apns_team_id   = "ABCDE12345"
   apns_key_id    = "FGHIJ67890"
   apns_bundle_id = "net.travis-harper.bridgetracker"
   apns_p8_file   = "/absolute/path/to/AuthKey_FGHIJ67890.p8"
   ```

4. `terraform apply` — creates a Secrets Manager entry holding the .p8 and wires it
   into both Lambdas. The poller will start sending Live Activity pushes automatically
   the next time the bridge status changes.

The backend only pushes on **status-change events** (not every poll) to stay well under
APNs Live Activity budget limits.

## TestFlight builds and access

The workflow runs Foundation regression checks for the mobile API client before
archiving. To run them locally on the Mac:

```sh
cd ios
xcrun swiftc -swift-version 5 -parse-as-library \
  Shared/APIClient.swift Shared/Models.swift Shared/BuildConfig.swift \
  Tests/APIClientTests.swift -o /tmp/bridge-api-tests
/tmp/bridge-api-tests
```

The `iOS to TestFlight` workflow uses the existing GitHub-hosted `macos-latest`
runner for this public repository. It does not require the local MacBook or a new
self-hosted registration. It supports a signed build without distribution:

```sh
gh workflow run ios-testflight.yml --ref <reviewed-branch> \
  -f api_base_url=https://bridge.travis-harper.net -f upload=false
```

This archives and exports with the existing manual signing certificate and both
provisioning profiles. The IPA is retained as a workflow artifact for seven days.
It cannot be installed directly: this is an App Store build, and TestFlight still
requires an upload. This mode makes no App Store Connect requests and sends no
tester notifications.

The app includes `PrivacyInfo.xcprivacy` for its own `UserDefaults` access (approved
reason `CA92.1`). Verify the manifest appears inside the exported app when reviewing
an archive. The app and widget keep their existing bundle IDs and entitlements.

After reviewing the build, explicitly request an upload:

```sh
gh workflow run ios-testflight.yml --ref <reviewed-branch> \
  -f api_base_url=https://bridge.travis-harper.net -f upload=true
```

An upload first checks access to the configured Apple app and verifies the bundle
ID. `FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED` stops the run before archive:
the Account Holder must review the notice in [Apple Developer](https://developer.apple.com/account/)
or [App Store Connect Business](https://appstoreconnect.apple.com/business).
Agreement acceptance may take time to appear in the API. This error alone does not
identify the agreement or establish that membership needs renewal. Do not rotate
credentials or recreate signing assets to work around it.

Qualifying pushes to `main` still upload automatically. A merge also triggers the
repository's production deployment workflow, so review that consequence separately.
The build number increases with each workflow run, including build-only runs.

After upload, check [the app's TestFlight builds](https://appstoreconnect.apple.com/apps/6772673772/testflight/ios):

1. Wait for processing and verify build status, compliance, and expiration. Builds
   have a 90-day testing lifetime; an expired build needs a new upload.
2. Verify the tester remains in the intended group and has app access. Existing
   internal groups need automatic distribution enabled or an explicit **Add Builds**.
3. External groups need **Add Builds** and any required beta review before testing.
   Starting testing or notifying testers can send notifications. Uploads may also
   notify existing internal groups with automatic distribution.
4. Verify the tester sees the replacement build in TestFlight and can install it.
   Successful upload alone does not prove distribution or installation.

See Apple's [internal tester guide](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/)
and [build status reference](https://developer.apple.com/help/app-store-connect/reference/app-uploads/app-build-statuses/).

## Project layout

```
ios/
├── project.yml                          # XcodeGen config
├── Shared/                              # compiled into both targets
│   ├── Models.swift                     # Codable mirrors of backend types
│   ├── BridgeActivityAttributes.swift   # Live Activity attributes + ContentState
│   ├── APIClient.swift                  # URLSession-based client
│   └── Formatting.swift                 # duration + relative-date helpers
├── BridgeTracker/                       # main app target
│   ├── BridgeTrackerApp.swift
│   ├── AppDelegate.swift                # APNs registration callback
│   ├── ContentView.swift                # status + stats + history
│   ├── BridgeMapView.swift              # MapKit annotation + "open in Maps"
│   ├── BridgeStore.swift                # observable state + polling + haptics
│   ├── LiveActivityController.swift     # start/stop + capture push token
│   ├── NotificationRegistrar.swift      # APNs auth + register with backend
│   ├── BridgeAppIntents.swift           # Siri/Shortcuts/Spotlight
│   └── Assets.xcassets/                 # accent color, app icon slot
└── BridgeWidgetExtension/               # widget + Live Activity extension
    ├── Info.plist
    ├── BridgeWidgetBundle.swift
    ├── BridgeLiveActivity.swift         # lock-screen + Dynamic Island UI
    └── BridgeStatusWidget.swift         # home + lock screen widgets
```

## Development loop

- **SwiftUI changes:** edit, run previews in Xcode, no regeneration needed.
- **New source files:** Xcode picks them up automatically from the folder (XcodeGen's
  `sources:` is directory-based). Only re-run `xcodegen generate` if you change
  `project.yml`.
- **New assets:** add to `Assets.xcassets`, they ship automatically.
