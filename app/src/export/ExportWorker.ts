// Web Worker: renders video frames using OffscreenCanvas and posts PNG-encoded
// base64 strings back to the main thread one frame at a time (ack-based backpressure).
//
// PNG encoding compresses the mostly-transparent overlay from ~8 MB raw RGBA to
// ~50-200 KB per frame, cutting Tauri IPC serialisation cost by ~100×.
//
// Protocol (main → worker):
//   { type: 'start', frames, route, layout, width, height }
//   { type: 'ack' }          — sent after main thread has handled a frame
//   { type: 'abort' }        — cancel in-flight export
//
// Protocol (worker → main):
//   { type: 'frame', frameIndex: number, data: string }  (base64 PNG)
//   { type: 'done' }
//   { type: 'error', message: string }

import type { RouteData, Theme, WidgetRenderContext } from '@velooverlay/widget-sdk';
import { WIDGET_REGISTRY } from './widgetRegistry';
import type { TelemetryFrameDto, WidgetInstance, RouteDataDto } from '../types';

// ── Message types ─────────────────────────────────────────────────────────────

interface LayoutSnapshot {
  theme: { fontFamily: string; primaryColor: string; backgroundOpacity: number };
  widgets: WidgetInstance[];
}

export interface StartMessage {
  type: 'start';
  frames: TelemetryFrameDto[];
  route: RouteDataDto;
  layout: LayoutSnapshot;
  width: number;
  height: number;
}

interface AckMessage  { type: 'ack' }
interface AbortMessage { type: 'abort' }

type InMessage = StartMessage | AckMessage | AbortMessage;

export interface FrameMessage  { type: 'frame'; frameIndex: number; data: string }
export interface DoneMessage   { type: 'done' }
export interface ErrorMessage  { type: 'error'; message: string }

type OutMessage = FrameMessage | DoneMessage | ErrorMessage;

// ── Backpressure state ────────────────────────────────────────────────────────

let aborted = false;
let ackResolve: (() => void) | null = null;

// ── Entry point ───────────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<InMessage>) => {
  const msg = e.data;
  if (msg.type === 'start') {
    aborted = false;
    runExport(msg).catch((err: unknown) => {
      self.postMessage({ type: 'error', message: String(err) } as OutMessage);
    });
  } else if (msg.type === 'ack') {
    ackResolve?.();
    ackResolve = null;
  } else if (msg.type === 'abort') {
    aborted = true;
    ackResolve?.();
    ackResolve = null;
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function toRouteData(dto: RouteDataDto | null): RouteData {
  if (!dto || dto.points.length === 0) {
    return { points: [], bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 } };
  }
  return {
    points: dto.points.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      altitudeM: p.altitudeM,
      distanceM: p.distanceM,
    })),
    bounds: dto.bounds,
  };
}

function toSdkFrame(dto: TelemetryFrameDto): import('@velooverlay/widget-sdk').TelemetryFrame {
  return {
    frameIndex: dto.frameIndex,
    videoTimeMs: dto.videoTimeMs,
    speedMs: dto.speedMs,
    heartRate: dto.heartRate,
    cadence: dto.cadence,
    power: dto.power,
    lat: dto.lat,
    lon: dto.lon,
    altitudeM: dto.altitudeM,
    distanceM: dto.distanceM,
    signalStatus: dto.signalStatus,
  };
}

function buildVideoRoute(frames: TelemetryFrameDto[]): RouteData {
  const pts = frames
    .filter((f) => f.lat !== null && f.lon !== null)
    .map((f) => ({
      lat: f.lat!,
      lon: f.lon!,
      altitudeM: f.altitudeM,
      distanceM: f.distanceM,
    }));
  if (pts.length === 0) {
    return { points: [], bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 } };
  }
  return {
    points: pts,
    bounds: {
      minLat: Math.min(...pts.map((p) => p.lat)),
      maxLat: Math.max(...pts.map((p) => p.lat)),
      minLon: Math.min(...pts.map((p) => p.lon)),
      maxLon: Math.max(...pts.map((p) => p.lon)),
    },
  };
}

// The GUI stage is always 1920×1080 logical pixels. Widget positions and sizes
// are expressed in that coordinate space.
//
// The overlay is always rendered at stage resolution (1920×1080) regardless of
// the output resolution. Encoding a 4K OffscreenCanvas to PNG takes ~50ms/frame
// (WebKit PNG encoder); at 1080p it takes ~10ms. FFmpeg upscales the overlay to
// the output resolution in the filter_complex before compositing, so widget
// quality at 4K output is nearly identical to rendering natively at 4K.
const STAGE_W = 1920;
const STAGE_H = 1080;

// ── Export loop ───────────────────────────────────────────────────────────────

async function runExport(msg: StartMessage) {
  const { frames, route, layout } = msg;
  const total = frames.length;

  const sdkRoute = toRouteData(route);
  const sdkVideoRoute = buildVideoRoute(frames);
  const sdkTheme: Theme = {
    fontFamily: layout.theme.fontFamily,
    primaryColor: layout.theme.primaryColor,
    backgroundOpacity: layout.theme.backgroundOpacity,
  };

  // Composite canvas is always at stage resolution.
  const compositeCanvas = new OffscreenCanvas(STAGE_W, STAGE_H);
  const compositeCtx = compositeCanvas.getContext('2d')!;

  // Per-widget canvases — reused across frames, recreated on size change.
  const widgetCanvases = new Map<string, OffscreenCanvas>();

  for (let i = 0; i < total; i++) {
    if (aborted) break;

    compositeCtx.clearRect(0, 0, STAGE_W, STAGE_H);
    const sdkFrame = toSdkFrame(frames[i]);

    for (const instance of layout.widgets) {
      const widget = WIDGET_REGISTRY[instance.type];
      if (!widget) continue;

      const ww = instance.size.width;
      const wh = instance.size.height;
      const wx = instance.position.x;
      const wy = instance.position.y;

      // Get or create per-widget OffscreenCanvas at stage-coordinate size.
      let wCanvas = widgetCanvases.get(instance.id);
      if (!wCanvas || wCanvas.width !== ww || wCanvas.height !== wh) {
        wCanvas = new OffscreenCanvas(ww, wh);
        widgetCanvases.set(instance.id, wCanvas);
      }

      wCanvas.getContext('2d')!.clearRect(0, 0, ww, wh);

      const renderCtx: WidgetRenderContext = {
        frame: sdkFrame,
        route: sdkRoute,
        videoRoute: sdkVideoRoute,
        // OffscreenCanvas has the same Canvas 2D API as HTMLCanvasElement at runtime.
        // The SDK type keeps HTMLCanvasElement to avoid TypeScript's union overload
        // resolution issues, so we assert here.
        canvas: wCanvas as unknown as HTMLCanvasElement,
        theme: sdkTheme,
        width: ww,
        height: wh,
      };

      try {
        widget.render(renderCtx, instance.config as Record<string, unknown>);
      } catch (err) {
        console.error(`Widget render error [${instance.type}]:`, err);
      }

      compositeCtx.drawImage(wCanvas, wx, wy);
    }

    // Encode frame as PNG — the mostly-transparent overlay compresses from
    // ~8 MB raw RGBA to ~50-200 KB, reducing Tauri IPC cost by ~100×.
    const blob = await compositeCanvas.convertToBlob({ type: 'image/png' });
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    // btoa requires a binary string; process in chunks to avoid call-stack overflow.
    const chunkSize = 0x8000;
    let binary = '';
    for (let j = 0; j < bytes.length; j += chunkSize) {
      binary += String.fromCharCode(...(bytes.subarray(j, j + chunkSize) as unknown as number[]));
    }
    const b64 = btoa(binary);

    // Post frame and wait for ack before rendering the next frame (backpressure)
    await new Promise<void>((resolve) => {
      ackResolve = resolve;
      self.postMessage({ type: 'frame', frameIndex: i, data: b64 } as OutMessage);
    });
  }

  if (!aborted) {
    self.postMessage({ type: 'done' } as OutMessage);
  }
}
