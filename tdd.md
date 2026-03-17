# Technical Design Document: VeloOverlay

**Status:** Draft
**Date:** March 17, 2026
**Companion:** prd.txt

---

## 1. Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Core library | Rust | Performance, single binary, pluggable trait system, Tauri compatibility |
| CLI binary | Rust (uses core) | Fast startup, no runtime dependency |
| Desktop GUI backend | Tauri v2 (Rust) | Cross-platform, native webview, no Electron, small binary |
| Desktop GUI frontend | React + TypeScript | Large ecosystem, familiar to web contributors |
| Widget SDK | TypeScript (npm package) | Broad contributor base, runs in web rendering context |
| Widget rendering (GUI) | HTML5 Canvas 2D | Sufficient for Phase 1, low barrier for widget contributors |
| Widget rendering (CLI) | tiny-skia (Rust 2D raster) | No browser dependency for headless render |
| Video encoding | FFmpeg (external) | Industry standard, user-installed |
| Monorepo tooling | Cargo workspace + npm workspaces | Native tooling for each ecosystem |

---

## 2. Repository Structure

Two repositories:

| Repo | Purpose |
|---|---|
| `velooverlay` | Main monorepo — all core code, CLI, GUI, widget SDK, built-in widgets |
| `velooverlay-marketplace` | Community widget registry (`registry.json` + submission process) |

The widget SDK is developed inside the monorepo but **published as a standalone npm package** (`@velooverlay/widget-sdk`) so community widget authors can depend on it without cloning the full repo.

### Main Monorepo Layout

```
velooverlay/
├── Cargo.toml                  # Cargo workspace root
├── package.json                # npm workspace root
│
├── crates/
│   ├── velo-core/              # Core Rust library (no binary)
│   └── velo-cli/               # CLI binary (depends on velo-core)
│
├── app/                        # Tauri desktop application
│   ├── src-tauri/              # Tauri Rust backend (depends on velo-core)
│   └── src/                    # React/TypeScript frontend
│
└── packages/
    ├── widget-sdk/             # TypeScript: widget interface definitions (published to npm)
    └── widgets-builtin/        # TypeScript: built-in widget implementations
```

### Marketplace Repo Layout

```
velooverlay-marketplace/
├── registry.json               # Community widget index
├── CONTRIBUTING.md             # How to submit a widget
└── schema/
    └── widget-entry.schema.json  # Validates registry entries
```

---

## 3. Core Data Model (`velo-core`)

All parsers (FIT, GPX, TCX) normalize into a single internal representation. Widgets and the rendering pipeline only ever consume this model — they never touch raw file formats.

### 3.1 Normalized Telemetry Model

```rust
/// A single data sample from a telemetry source.
/// All fields are Optional — real data has gaps.
pub struct TelemetryPoint {
    pub timestamp_ms: u64,       // Milliseconds from session start (always present)
    pub lat: Option<f64>,        // Decimal degrees
    pub lon: Option<f64>,        // Decimal degrees
    pub altitude_m: Option<f32>,
    pub speed_ms: Option<f32>,   // Metres per second (convert in widget layer)
    pub heart_rate: Option<u8>,  // BPM
    pub cadence: Option<u8>,     // RPM
    pub power: Option<u16>,      // Watts
    pub distance_m: Option<f32>, // Cumulative metres
}

/// The full parsed session.
pub struct TelemetrySession {
    pub source_file: PathBuf,
    pub recorded_start_time: Option<DateTime<Utc>>, // From file header, if present
    pub points: Vec<TelemetryPoint>,                // Raw samples (typically 1Hz)
}
```

### 3.2 Synchronized & Interpolated Frame Stream

After sync and interpolation, the pipeline produces a `FrameStream` — one `TelemetryFrame` per video frame.

```rust
/// One frame's worth of data, aligned to a specific video timestamp.
pub struct TelemetryFrame {
    pub frame_index: u64,
    pub video_time_ms: u64,
    pub data: TelemetryPoint,
    pub signal_status: SignalStatus,
}

pub enum SignalStatus {
    Ok,
    Interpolated,   // Value was computed, not directly measured
    Lost,           // No source data — widget should show "Signal Lost"
}
```

---

## 4. Pluggable Pipeline Interfaces

All pipeline stages are Rust traits. Phase 0 ships one concrete implementation each. Future implementations (smarter sync, spline interpolation) are drop-in additions.

### 4.1 Parser

```rust
pub trait TelemetryParser: Send + Sync {
    fn parse(&self, path: &Path) -> Result<TelemetrySession, ParseError>;
    fn supported_extensions(&self) -> &[&str];
}

// Concrete implementations:
// FitParser    → .fit
// GpxParser    → .gpx
// TcxParser    → .tcx
```

A `ParserRegistry` selects the correct parser by file extension.

### 4.2 Sync Engine

```rust
pub struct VideoMetadata {
    pub path: PathBuf,
    pub duration_ms: u64,
    pub recorded_start_time: Option<DateTime<Utc>>,
    pub frame_rate: f32,
}

pub struct SyncResult {
    pub offset_ms: i64,   // Positive = telemetry starts after video; negative = before
    pub confidence: f32,  // 0.0–1.0; ManualSync always returns 1.0
}

pub trait SyncStrategy: Send + Sync {
    fn compute_offset(
        &self,
        video: &VideoMetadata,
        telemetry: &TelemetrySession,
    ) -> Result<SyncResult, SyncError>;
}

// Phase 0 implementation:
// ManualSyncStrategy { offset_ms: i64 }

// Future implementations:
// TimestampSyncStrategy     — aligns embedded timestamps
// SpeedCurveSyncStrategy    — correlates video motion with GPS speed
// AudioBeepSyncStrategy     — detects Garmin start-beep in audio track
```

### 4.3 Interpolation

```rust
pub trait InterpolationStrategy: Send + Sync {
    fn interpolate(
        &self,
        session: &TelemetrySession,
        sync: &SyncResult,
        video: &VideoMetadata,
    ) -> Result<Vec<TelemetryFrame>, InterpolationError>;
}

// Phase 0 implementation:
// LinearInterpolation

// Future implementations:
// CubicSplineInterpolation
// KalmanFilterInterpolation
```

### 4.4 Pipeline Orchestrator

A `Pipeline` struct composes the three stages and is the primary entry point for both the CLI and the Tauri backend:

```rust
pub struct Pipeline {
    parser: Box<dyn TelemetryParser>,
    sync: Box<dyn SyncStrategy>,
    interpolation: Box<dyn InterpolationStrategy>,
}

impl Pipeline {
    pub fn process(
        &self,
        telemetry_path: &Path,
        video_path: &Path,
    ) -> Result<Vec<TelemetryFrame>, PipelineError>;
}
```

---

## 5. CLI Tool (`velo-cli`)

### 5.1 Commands

```
# Export interpolated telemetry to JSON or CSV
velooverlay process \
  --telemetry ride.fit \
  --video ride.mp4 \
  --offset-ms 5200 \
  --fps 30 \
  --format json \          # json | csv
  --output telemetry.json

# Render video with widget overlay
velooverlay render \
  --video ride.mp4 \
  --telemetry telemetry.json \  # or .fit directly (runs process internally)
  --layout layout.json \
  --output output.mp4 \
  --resolution 1080p            # 1080p | 720p (Phase 0 fixed options)
```

### 5.2 Layout Config Format

`layout.json` is the serialized widget layout. It is shared between the CLI and the GUI (the GUI exports this format when saving a project).

```json
{
  "schema_version": "1",
  "theme": {
    "font_family": "Helvetica",
    "primary_color": "#00FF00",
    "background_opacity": 0.8
  },
  "widgets": [
    {
      "id": "speedometer-1",
      "type": "builtin:speedometer",
      "version": "1.0.0",
      "position": { "x": 50, "y": 50 },
      "size": { "width": 150, "height": 80 },
      "config": { "unit": "kph" }
    },
    {
      "id": "snake-map-1",
      "type": "builtin:snake-map",
      "version": "1.0.0",
      "position": { "x": 900, "y": 50 },
      "size": { "width": 300, "height": 300 },
      "config": {}
    }
  ]
}
```

### 5.3 CLI Render Pipeline

The CLI render path does not use a browser or WebGL. It uses `tiny-skia` (a pure-Rust 2D raster library) to draw widget frames, then pipes them to FFmpeg.

```
FIT file ──► Parser ──► TelemetrySession
                              │
                         Sync Engine (ManualSyncStrategy)
                              │
                    Interpolation (LinearInterpolation)
                              │
                         FrameStream (Vec<TelemetryFrame>)
                              │
                    ┌─────────▼──────────┐
                    │  CLI Widget Renderer│  (tiny-skia)
                    │  Reads layout.json │
                    └─────────┬──────────┘
                              │  PNG frames (piped)
                              ▼
                    FFmpeg subprocess
                    (composites onto video)
                              │
                              ▼
                         output.mp4
```

### 5.4 FFmpeg Integration

FFmpeg is invoked as a subprocess via `std::process::Command`. The CLI:
1. Checks for `ffmpeg` on `$PATH` at startup; exits with a clear error and installation instructions if not found.
2. Renders widget frames to an in-memory PNG buffer per frame.
3. Opens FFmpeg with two inputs: the source video and a pipe receiving the PNG overlay stream.
4. FFmpeg composites using the `overlay` filter and encodes the output.

---

## 6. Widget SDK (`packages/widget-sdk`)

### 6.1 TypeScript Interface

```typescript
// The data available to a widget for the current frame
export interface TelemetryFrame {
  frameIndex: number;
  videoTimeMs: number;
  speedMs: number | null;
  heartRate: number | null;
  cadence: number | null;
  power: number | null;
  lat: number | null;
  lon: number | null;
  altitudeM: number | null;
  distanceM: number | null;
  signalStatus: 'ok' | 'interpolated' | 'lost';
}

export interface Theme {
  fontFamily: string;
  primaryColor: string;         // hex
  backgroundOpacity: number;    // 0–1
}

export interface WidgetRenderContext {
  frame: TelemetryFrame;
  theme: Theme;
  width: number;
  height: number;
  // Rendering surface — see §6 open question
}

export interface WidgetConfig {
  [key: string]: unknown;
}

// The interface every widget must implement
export interface WidgetDefinition<TConfig extends WidgetConfig = WidgetConfig> {
  readonly id: string;           // e.g., "builtin:speedometer" or "com.author:mywidget"
  readonly name: string;
  readonly version: string;      // semver
  readonly defaultSize: { width: number; height: number };

  render(ctx: WidgetRenderContext, config: TConfig): void;
  getDefaultConfig(): TConfig;
  getConfigSchema?(): JSONSchema;  // For GUI config inspector
}
```

### 6.2 SDK Versioning Policy

The widget SDK interface is treated as a **public API** from v1.0 onwards. Breaking changes require a major version bump and a migration guide. The `id` field uses reverse-domain namespacing (`builtin:*` is reserved for first-party widgets).

### 6.3 Marketplace (Phase 1)

Phase 1 marketplace is a curated `registry.json` hosted in the VeloOverlay GitHub repository:

```json
{
  "widgets": [
    {
      "id": "com.johndoe:gradient-map",
      "name": "Gradient Map",
      "author": "johndoe",
      "npm_package": "@johndoe/velo-widget-gradient-map",
      "version": "1.2.0",
      "description": "Elevation gradient color map widget"
    }
  ]
}
```

Future: a hosted registry with search, ratings, and automatic updates.

---

## 7. GUI Rendering Engine — OPEN QUESTION

**This is the key decision for Phase 1. Two options:**

### Option A: PixiJS (WebGL)
- GPU-accelerated, handles complex widget animations smoothly
- Larger dependency, more complex API
- Better for Phase 3 (4K real-time preview, complex effects)
- Community widget authors need to know PixiJS API

### Option B: HTML5 Canvas 2D
- Simpler API — any web developer can write a widget
- CPU-rendered, but sufficient for the Phase 1 widget set
- Lower barrier for community widget contributions
- May struggle at 4K/60fps in Phase 3 (mitigated by proxy editing)

**Recommendation:** Canvas 2D for Phase 1, with a plan to abstract the rendering surface so PixiJS can be swapped in for Phase 3 without breaking the widget SDK. The `WidgetRenderContext` would expose a `canvas: HTMLCanvasElement` that initially targets a 2D context.

**Question for owner: Do you expect Phase 1 widgets to need GPU-accelerated effects (e.g., blur, glow, particle trails), or is clean 2D graphics sufficient?**

---

## 8. Tauri Desktop App Architecture

```
app/
├── src-tauri/
│   └── src/
│       ├── main.rs           # Tauri app entry point
│       └── commands.rs       # Tauri commands (IPC bridge)
│           # process_telemetry() → calls velo-core Pipeline
│           # get_video_metadata() → extracts duration, fps, timestamp
│           # check_ffmpeg() → validates FFmpeg on PATH
└── src/
    ├── App.tsx
    ├── components/
    │   ├── Stage/            # The editor canvas
    │   ├── Timeline/         # Sync slider + scrubber
    │   ├── WidgetInspector/  # Per-widget config panel
    │   └── Toolbar/
    ├── widgets/              # Built-in widget rendering (uses widget-sdk)
    └── store/                # React state (Zustand or Redux — TBD)
```

### 8.1 IPC Model

Tauri commands bridge the Rust core and the TypeScript frontend:

```rust
// src-tauri/src/commands.rs

#[tauri::command]
async fn process_telemetry(
    telemetry_path: String,
    video_path: String,
    offset_ms: i64,
    fps: f32,
) -> Result<Vec<TelemetryFrameDto>, String> { ... }

#[tauri::command]
async fn get_video_metadata(video_path: String) -> Result<VideoMetadataDto, String> { ... }

#[tauri::command]
fn check_ffmpeg() -> bool { ... }
```

Data transfer objects (DTOs) are simple structs that serialize to JSON for the TypeScript layer.

---

## 9. Snake Map Algorithm

Implemented as a built-in widget in both the CLI renderer (Rust/tiny-skia) and the GUI (TypeScript/Canvas).

```
1. On load: compute bounding box
   min_lat, max_lat = min/max of all TelemetryPoint.lat
   min_lon, max_lon = min/max of all TelemetryPoint.lon

2. Coordinate mapping (with padding):
   scale_x = widget_width  / (max_lon - min_lon)
   scale_y = widget_height / (max_lat - min_lat)
   scale   = min(scale_x, scale_y)   // maintain aspect ratio
   pixel_x(lon) = (lon - min_lon) * scale + offset_x
   pixel_y(lat) = widget_height - (lat - min_lat) * scale + offset_y  // invert Y

3. Per frame render:
   a. Draw full route as ghost line (primary_color @ 25% opacity)
   b. Draw ridden portion [0..current_index] as solid line (primary_color @ 100%)
   c. Draw head marker at current position (filled circle, accent color)
```

---

## 10. Testing Strategy

### Phase 0 (Core + CLI)
- **Unit tests** (Rust): parser output validation against known FIT/GPX files, interpolation correctness (frame count, value bounds), sync offset math.
- **Integration tests** (Rust): full `Pipeline::process()` call against real test files; snapshot test the JSON output.
- **CLI smoke test**: shell script that runs `velooverlay process` and `velooverlay render` against fixture files and validates exit codes and output file existence.

### Phase 1 (GUI)
- **Tauri command tests**: test IPC command handlers against mock pipeline.
- **Widget rendering tests**: snapshot tests for each built-in widget at known telemetry values.

### Test Fixtures
Real FIT and video files are checked in under `tests/fixtures/` (short clips only — keep the repo lightweight). A synthetic data generator will be added for edge cases (data gaps, zero-duration sessions, extreme coordinates).

---

## 11. Open Questions Summary

| # | Question | Impacts |
|---|---|---|
| 1 | Zustand vs Redux for frontend state? | Minor — decide at Phase 1 start |
| 2 | Widget marketplace hosting: GitHub-only forever, or plan for a hosted registry? | Phase 1 scope |

---

## 12. Out of Scope for This Document

- CI/CD pipeline setup
- Code signing and notarization for macOS distribution
- Windows build configuration
- Phase 2+ features (real-time preview, elevation profile, presets)
- Phase 3 features (GPU encoding, audio sync, map tiles)
