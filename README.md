# VeloOverlay

Open source software for synchronizing cycling telemetry (GPS, HR, Power, Cadence) with POV video and rendering customizable widget overlays.

**License:** MIT | **Status:** Phase 0 — CLI in development

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

## Repository Structure

```
velooverlay/
├── crates/
│   ├── velo-core/        # Rust library: telemetry parsing, sync, interpolation
│   └── velo-cli/         # CLI binary: `velooverlay` command
├── app/
│   ├── src-tauri/        # Tauri Rust backend
│   └── src/              # React/TypeScript frontend
└── packages/
    ├── widget-sdk/        # TypeScript widget interface (published to npm)
    └── widgets-builtin/   # Built-in widgets (Speedometer, Snake Map, HR, Cadence, Power)
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

## CLI Usage (Phase 0)

Build and run the CLI:

```bash
cargo build --package velooverlay

# Or run directly without a separate build step:
cargo run --package velooverlay -- --help
```

### Commands

**process** — Parse telemetry, sync to video, interpolate, export as JSON or CSV:

```bash
cargo run --package velooverlay -- process \
  --telemetry ride.fit \
  --video ride.mp4 \
  --offset-ms 5200 \
  --fps 30 \
  --format json \
  --output telemetry.json
```

**render** — Burn widget overlay onto video (requires FFmpeg):

```bash
cargo run --package velooverlay -- render \
  --video ride.mp4 \
  --telemetry ride.fit \
  --layout layout.json \
  --offset-ms 5200 \
  --output output.mp4
```

---

## Desktop App (Phase 1)

```bash
# Run in development mode (hot-reload)
cargo tauri dev

# Build a release binary
cargo tauri build
```

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

Submit to the [VeloOverlay Marketplace](https://github.com/velooverlay/velooverlay-marketplace).

---

## Contributing

Pull requests welcome. Please open an issue first for significant changes.
