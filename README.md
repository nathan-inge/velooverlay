<p align="center">
  <img src="app/src/assets/logo.png" alt="VeloOverlay" width="520" />
</p>

Open source software for synchronizing cycling telemetry (GPS, HR, power, cadence, etc) with POV video and rendering customizable widget overlays.

<p align="center">
  <img src="examples/DemoCapture.png" alt="VeloOverlay desktop app screenshot" width="900" />
</p>

**License:** MIT

---

## Prerequisites

### Rust (required for CLI and desktop app)

```bash
# Install Rust via rustup (the official installer)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Verify installation
cargo --version
```

### Node.js (required for desktop app and widget SDK)

Install Node.js 20+ via [nodejs.org](https://nodejs.org) or:

```bash
brew install node
```

### FFmpeg (required for video rendering)

```bash
# macOS
brew install ffmpeg

# Windows — see https://ffmpeg.org/download.html
```

---

## Quick start

### Desktop app

```bash
# Install JS dependencies (monorepo workspaces)
npm install

# Run the Tauri desktop app in dev mode
cd app
cargo tauri dev
```

### CLI (`velooverlay process`)

```bash
# Build the CLI
cargo build -p velooverlay

# Show help
cargo run -p velooverlay -- --help
```

Install a local binary:

```bash
cargo install --path crates/velo-cli
velooverlay --help
```

## Repository Structure

```
velooverlay/
├── crates/
│   ├── velo-core/          # Rust library: telemetry parsing, sync, interpolation
│   └── velo-cli/           # CLI binary: `velooverlay process`
├── app/
│   ├── src-tauri/          # Tauri Rust backend (FFmpeg session management)
│   └── src/
│       ├── export/         # ExportWorker.ts (OffscreenCanvas rendering) + widget registry
│       ├── components/     # React UI components
│       └── store/          # Zustand state (useStore.ts)
└── packages/
    ├── widget-sdk/          # TypeScript widget interface (public API)
    └── widgets-builtin/     # Built-in widgets (Canvas 2D — used by preview and export)
```

---

## Development Setup

```bash
# Clone the repo
git clone https://github.com/velooverlay/velooverlay.git
cd velooverlay

# Install Node dependencies (all workspaces)
npm install

# Check the Rust workspace compiles
cargo check

# Build the widget SDK and built-in widgets
npm run build --workspace=packages/widget-sdk
npm run build --workspace=packages/widgets-builtin
```

---

## CLI Usage

Build and run the CLI:

```bash
cargo build --package velooverlay

# Or run directly without a separate build step:
cargo run --package velooverlay -- --help
```

### Commands

**process** — Parse telemetry, apply sync, interpolate to frame rate, export as JSON or CSV:

```bash
# Auto-sync using embedded timestamps (recommended)
cargo run --package velooverlay -- process \
  --telemetry ride.fit \
  --video ride.mp4 \
  --fps 30 \
  --format json \
  --output telemetry.json

# Manual offset — telemetry started 5.2 seconds before the video
cargo run --package velooverlay -- process \
  --telemetry ride.fit \
  --video ride.mp4 \
  --sync manual \
  --offset-ms -5200 \
  --fps 30 \
  --format csv \
  --output telemetry.csv

# No video — uses telemetry duration, outputs the full session
cargo run --package velooverlay -- process \
  --telemetry ride.fit \
  --fps 30 \
  --format json \
  --output telemetry.json
```

#### Sync modes (`--sync`)

| Mode | Flag | Behaviour |
|---|---|---|
| **Auto** (default) | `--sync auto` | Reads the `creation_time` tag from the video and the `start_time` from the telemetry file and computes the offset automatically. Requires both files to have embedded timestamps (GoPro, DJI, and Garmin devices all do). Falls back to `--offset-ms 0` with a warning if either timestamp is missing. |
| **Manual** | `--sync manual --offset-ms <MS>` | Uses a fixed millisecond offset. Positive = telemetry starts after the video; negative = telemetry starts before the video. |

> **`velooverlay render` is deprecated.** Video rendering is handled by the desktop app, which produces pixel-perfect output matching the GUI preview. Run `velooverlay render --help` for migration guidance.

---

## Desktop App

The desktop app is the primary way to create overlay videos. It handles sync, layout editing, preview, and export in one place.

```bash
# Run in development mode (hot-reload)
cd app
cargo tauri dev

# Build a release binary
cd app
cargo tauri build
```

### Workflow

1. **Import Video** — choose an MP4 or MOV from your camera.
2. **Import Telemetry** — choose a `.fit`, `.gpx`, or `.tcx` activity file.
3. **Sync** — the app auto-syncs using embedded timestamps if available. Use the offset slider for manual adjustment.
4. **Add widgets** — drag widgets from the sidebar onto the stage and resize/reposition them.
5. **Export MP4** — renders the overlay and re-encodes the video via FFmpeg. A progress counter shows frames rendered; click **Cancel** to abort at any time.

### Widgets

All built-in widgets work in both the live preview and the exported video:

| Widget | Type ID | Config options |
|---|---|---|
| Speedometer | `builtin:speedometer` | `unit`: `"kph"` or `"mph"` (default: `"kph"`) |
| Heart Rate | `builtin:heart-rate` | — |
| Cadence | `builtin:cadence` | — |
| Power | `builtin:power` | — |
| Elevation | `builtin:elevation` | `unit`: `"m"` or `"ft"` (default: `"m"`) |
| Gradient | `builtin:gradient` | `windowM`: smoothing window in metres (default: `200`) |
| Snake Map | `builtin:snake-map` | `fullTrack`: `true` shows the full activity route (default: `false`) |
| Elevation Profile | `builtin:elevation-profile` | `fullTrack`: `true` shows the full activity route (default: `false`) |

> **Note:** macOS 13 (Ventura) or newer is required for video export. The export pipeline uses `OffscreenCanvas`, which was added to WebKit in Safari 16.4.

---

## Building a Widget

Install the SDK:

```bash
npm install @velooverlay/widget-sdk
```

Implement the `WidgetDefinition` interface:

```typescript
import { WidgetDefinition, WidgetRenderContext } from '@velooverlay/widget-sdk';

export const MyWidget: WidgetDefinition = {
  id: 'com.yourname:my-widget',
  name: 'My Widget',
  version: '1.0.0',
  defaultSize: { width: 200, height: 100 },
  getDefaultConfig: () => ({}),
  render(ctx: WidgetRenderContext): void {
    const c = ctx.canvas.getContext('2d')!;
    c.fillStyle = ctx.theme.primaryColor;
    c.fillText(`${ctx.frame.speedMs?.toFixed(1) ?? '--'} m/s`, 10, 50);
  },
};
```

---

## Contributing

Pull requests welcome. Please open an issue first for significant changes.
