# GTA: San Andreas Foititis 🎓🟢

A personal university utility dashboard for the **NKUA Department of Informatics
& Telecommunications (DIT)**, styled after the **Grand Theft Auto: San Andreas**
HUD. Built with **React Native (Expo)** — all app code lives in a single
[`App.js`](./App.js) for easy testing in Expo Go.

## Features

### 📊 STATS tab — ECTS tracker
- Degree target locked to **240 ECTS** (NKUA DIT).
- San Andreas Health/Armor-style **animated HUD progress bar**.
- Log passed courses (name + ECTS) → triggers a classic
  **"MISSION PASSED! · RESPECT +"** overlay animation (`Animated` API).
- Shows remaining ECTS and an estimate of remaining courses
  (assuming an average of 6–8 ECTS per course).
- Long-pressable ✕ to remove a course ("WASTED" confirmation).
- Hitting 240 ECTS shows **GAME COMPLETE — DEGREE 100%**.

### 🗺️ MAP tab — Los Athens radar
- Native map (`react-native-maps`) centered on **Athens, Greece**.
- Gritty dark radar styling:
  - iOS / Apple Maps: `userInterfaceStyle="dark"`.
  - Google provider (Android or iOS dev builds with a Google Maps key):
    a full custom dark `customMapStyle` JSON.
- **Long-press anywhere** to drop a waypoint → modal to name it and pick a
  category. Rotated-square markers mimic SA radar blips, colored by category:
  - 🟠 Cheap Coffee
  - 🔵 Study Spots
  - 🔴 High-Protein Cheap Eats
  - 🟢 Skate / Cruising Routes
- Tap a blip's callout to remove the waypoint.

### 💾 Persistence
Courses and waypoints are saved on-device with
`@react-native-async-storage/async-storage` — data survives app restarts.

## Running it

```bash
npm install
npx expo start
```

Then scan the QR code with the **Expo Go** app on your iPhone.

> Note: in Expo Go on iOS the map uses Apple Maps (dark mode). The custom
> GTA-radar JSON style applies when running with the Google Maps provider
> (Android, or an iOS development build configured with a Google Maps API key).
