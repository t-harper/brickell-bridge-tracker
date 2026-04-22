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

`ios/project.yml` defines `API_BASE_URL`, injected into `Info.plist` and consumed by
`Shared/APIClient.swift`.

- Simulator → host: keep the default `http://localhost:3001` and run `npm run dev`.
- Real device on the same Wi-Fi: set `API_BASE_URL` to `http://<mac-lan-ip>:5173`
  (Vite also proxies `/api` correctly).
- Prod: set to your API Gateway invoke URL (e.g. `https://abc123.execute-api.us-east-1.amazonaws.com`).

Edit in `project.yml` and re-run `xcodegen generate`, or override per-target in Xcode build settings.

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
   apns_bundle_id = "com.example.bridgetracker"
   apns_p8_file   = "/absolute/path/to/AuthKey_FGHIJ67890.p8"
   ```

4. `terraform apply` — creates a Secrets Manager entry holding the .p8 and wires it
   into both Lambdas. The poller will start sending Live Activity pushes automatically
   the next time the bridge status changes.

The backend only pushes on **status-change events** (not every poll) to stay well under
APNs Live Activity budget limits.

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
