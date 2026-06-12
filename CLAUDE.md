# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npx expo start       # start dev server (scan QR with Expo Go on iOS)
npx expo start --ios     # open in iOS Simulator
npx expo start --android # open in Android emulator
```

There are no lint or test scripts configured.

### EAS builds

```bash
eas build --profile development   # internal dev build with dev client
eas build --profile preview       # internal preview build
eas build --profile production    # production build (auto-increments version)
```

## Architecture

The entire app lives in a single file: [App.js](App.js). There are no subdirectories, screens folder, navigation library, or component files — this is intentional for easy testing in Expo Go.

### Component tree

```
App (root state owner)
├── TrackerScreen       — STATS tab: ECTS input form + FlatList of courses
│   ├── HudBar          — animated health-bar style progress bar
│   └── CourseRow       — memoized row for each completed course
├── MapScreen           — MAP tab: full-screen MapView with waypoints
│   └── PinMarker       — memoized rotated-square radar blip marker
└── MissionPassedOverlay — absolute-positioned animation overlay
```

### State management

All state is owned by `App` and passed down as props. No context, no external store.

- `courses` — array of `{ id, name, ects }` — drives the STATS tab
- `pins` — array of `{ id, name, category, latitude, longitude }` — drives the MAP tab
- `mission` — `{ title, subtitle } | null` — controls the "MISSION PASSED!" overlay
- `hydrated` — boolean gate that prevents AsyncStorage writes before initial load

### Persistence

`AsyncStorage.multiGet` loads both keys on mount. Two separate `useEffect` hooks write back changes, guarded by `hydrated` to avoid overwriting data during the initial render.

Storage keys: `@gta_foititis_courses_v1` and `@gta_foititis_pins_v1`.

### Map styling

- **iOS / Expo Go**: Apple Maps with `userInterfaceStyle="dark"` (ignores `customMapStyle`)
- **Android / iOS dev builds with Google Maps key**: `DARK_RADAR_MAP_STYLE` (custom JSON defined at the top of App.js) applies a gritty dark radar look

### Design system

All colors are in the `COLORS` object (San Andreas HUD palette). Fonts are system fonts selected via `Platform.select`: `AvenirNextCondensed-Heavy` on iOS, `sans-serif-condensed` on Android. No custom font assets are bundled.

The degree target (`TARGET_ECTS = 240`) is a top-level constant sized for NKUA DIT requirements.
