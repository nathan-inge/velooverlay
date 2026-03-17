/**
 * @velooverlay/widget-sdk
 *
 * Public interface for VeloOverlay widgets.
 * This file is the stable public API — breaking changes require a major version bump.
 *
 * Example usage:
 *   import { WidgetDefinition, WidgetRenderContext } from '@velooverlay/widget-sdk';
 *
 *   export const MyWidget: WidgetDefinition = { ... }
 */

// ---------------------------------------------------------------------------
// Telemetry data available per frame
// ---------------------------------------------------------------------------

/** The quality/origin of a frame's telemetry data. */
export type SignalStatus = 'ok' | 'interpolated' | 'lost';

/** A single frame of telemetry, aligned to a video timestamp. */
export interface TelemetryFrame {
  /** Zero-based video frame index. */
  frameIndex: number;

  /** Video timestamp in milliseconds from the start of the video. */
  videoTimeMs: number;

  /** Speed in metres per second. Convert to mph/kph in your widget. */
  speedMs: number | null;

  /** Heart rate in BPM. */
  heartRate: number | null;

  /** Cadence in RPM. */
  cadence: number | null;

  /** Power in Watts. */
  power: number | null;

  /** GPS latitude in decimal degrees. */
  lat: number | null;

  /** GPS longitude in decimal degrees. */
  lon: number | null;

  /** Altitude in metres. */
  altitudeM: number | null;

  /** Cumulative distance in metres. */
  distanceM: number | null;

  /** Data quality indicator. If 'lost', show a "signal lost" state. */
  signalStatus: SignalStatus;
}

/** The complete GPS route, available for widgets that show the full path (e.g. snake map). */
export interface RouteData {
  /** All GPS points for the session, in order. */
  points: Array<{ lat: number; lon: number; altitudeM: number | null }>;

  /** Bounding box for coordinate-to-pixel mapping. */
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export interface Theme {
  /** CSS font family string, e.g. "Helvetica, sans-serif". */
  fontFamily: string;

  /** Primary accent colour as a hex string, e.g. "#00FF00". */
  primaryColor: string;

  /** Default widget background opacity (0.0 = transparent, 1.0 = opaque). */
  backgroundOpacity: number;
}

// ---------------------------------------------------------------------------
// Rendering context
// ---------------------------------------------------------------------------

/**
 * Everything a widget needs to render a single frame.
 * Passed to `WidgetDefinition.render()` on every frame.
 */
export interface WidgetRenderContext {
  /** Current frame's telemetry data. */
  frame: TelemetryFrame;

  /** Full route for widgets that need the complete path. */
  route: RouteData;

  /** The canvas element your widget should draw onto. */
  canvas: HTMLCanvasElement;

  /** Applied theme (global defaults + per-widget overrides). */
  theme: Theme;

  /** Widget width in pixels. */
  width: number;

  /** Widget height in pixels. */
  height: number;
}

// ---------------------------------------------------------------------------
// Widget definition — the interface every widget must implement
// ---------------------------------------------------------------------------

/**
 * Implement this interface to create a widget.
 *
 * The `id` must be unique and use reverse-domain namespacing.
 * The `builtin:` prefix is reserved for first-party VeloOverlay widgets.
 *
 * Example:
 *   export const GradientMapWidget: WidgetDefinition<{ showElevation: boolean }> = {
 *     id: 'com.johndoe:gradient-map',
 *     name: 'Gradient Map',
 *     version: '1.0.0',
 *     defaultSize: { width: 300, height: 300 },
 *     render(ctx, config) { ... },
 *     getDefaultConfig: () => ({ showElevation: true }),
 *   };
 */
export interface WidgetDefinition<TConfig extends Record<string, unknown> = Record<string, unknown>> {
  /** Unique identifier using reverse-domain namespacing. */
  readonly id: string;

  /** Human-readable display name. */
  readonly name: string;

  /** Semver version string. */
  readonly version: string;

  /** Default size when first dropped onto the canvas. */
  readonly defaultSize: { width: number; height: number };

  /**
   * Called once per video frame. Draw your widget onto `ctx.canvas`.
   * Must be synchronous and complete quickly (< 1ms target).
   */
  render(ctx: WidgetRenderContext, config: TConfig): void;

  /** Returns the default configuration for this widget. */
  getDefaultConfig(): TConfig;

  /**
   * Optional: return a JSON Schema describing the config shape.
   * Used by the GUI's Widget Inspector to auto-generate config forms.
   */
  getConfigSchema?(): object;
}
