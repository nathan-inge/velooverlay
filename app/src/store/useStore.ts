import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type {
  Layout,
  ProcessResult,
  RouteDataDto,
  TelemetryFrameDto,
  VideoMetadataDto,
  WidgetInstance,
} from '../types';
import type { StartMessage } from '../export/ExportWorker';
import { WIDGET_REGISTRY } from '../export/widgetRegistry';

const DEFAULT_LAYOUT: Layout = {
  schema_version: '1',
  theme: {
    fontFamily: 'Helvetica, sans-serif',
    primaryColor: '#00d1ff',
    backgroundOpacity: 0.85,
  },
  widgets: [],
};

const VIDEO_FILTERS = [{ name: 'Video', extensions: ['mp4', 'mov'] }];
const TELEMETRY_FILTERS = [{ name: 'Telemetry', extensions: ['fit', 'gpx', 'tcx'] }];
const VIDEO_OUTPUT_FILTERS = [{ name: 'Video', extensions: ['mp4'] }];
const LAYOUT_FILTERS = [{ name: 'Layout', extensions: ['json'] }];

export type ExportResolution = 'source' | '1080p' | '1440p' | '4k';
export type ExportEncoder   = 'balanced' | 'fast' | 'hardware';
export type ExportBitrate   = 'auto' | 'match' | '4M' | '8M' | '16M' | '25M' | '50M';

function resolveOutputSize(
  resolution: ExportResolution,
  meta: import('../types').VideoMetadataDto | null,
  cropVertical: boolean,
): { width: number; height: number } {
  if (cropVertical) {
    if (resolution === 'source' && meta) {
      const w = Math.floor(meta.height * 9 / 16);
      return { width: w % 2 === 0 ? w : w - 1, height: meta.height };
    }
    if (resolution === '4k')    return { width: 2160, height: 3840 };
    if (resolution === '1440p') return { width: 1440, height: 2560 };
    return { width: 1080, height: 1920 };
  }
  if (resolution === 'source' && meta) return { width: meta.width, height: meta.height };
  if (resolution === '4k')    return { width: 3840, height: 2160 };
  if (resolution === '1440p') return { width: 2560, height: 1440 };
  return { width: 1920, height: 1080 };
}

function generateId(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

let reprocessTimeout: ReturnType<typeof setTimeout> | null = null;

// Module-level refs — not in Zustand state because Workers are not serializable.
let activeExportWorker: Worker | null = null;
let activeExportSessionId: string | null = null;

interface AppState {
  videoPath: string | null;
  telemetryPath: string | null;
  videoMetadata: VideoMetadataDto | null;
  frames: TelemetryFrameDto[];
  route: RouteDataDto | null;
  sessionDurationMs: number;
  isProcessing: boolean;
  processingError: string | null;
  offsetMs: number;
  layout: Layout;
  selectedWidgetId: string | null;
  ffmpegAvailable: boolean;
  isExporting: boolean;
  exportError: string | null;
  exportProgress: { done: number; total: number } | null;
  exportResolution: ExportResolution;
  exportEncoder: ExportEncoder;
  exportBitrate: ExportBitrate;
  cropVertical: boolean;
  trimStart: number | null;
  trimEnd: number | null;
  verticalZoom: number;
  verticalOffsetX: number;
  verticalOffsetY: number;
  isSyncing: boolean;
  syncMessage: string | null;
  layoutMessage: string | null;

  // Actions
  init: () => Promise<void>;
  setExportResolution: (r: ExportResolution) => void;
  setExportEncoder: (e: ExportEncoder) => void;
  setExportBitrate: (b: ExportBitrate) => void;
  setCropVertical: (v: boolean) => void;
  setTrimStart: (s: number | null) => void;
  setTrimEnd: (e: number | null) => void;
  setVerticalZoom: (v: number) => void;
  setVerticalOffsetX: (v: number) => void;
  setVerticalOffsetY: (v: number) => void;
  // File import — dialog
  importVideo: () => Promise<void>;
  importTelemetry: () => Promise<void>;
  // File import — direct path (used by drag-and-drop)
  setVideoFromPath: (path: string) => Promise<void>;
  setTelemetryFromPath: (path: string) => Promise<void>;
  // Sync
  setOffsetMs: (ms: number) => void;
  applyOffset: () => void;
  maybeProcess: () => Promise<void>;
  computeAutoSync: () => Promise<void>;
  // Layout
  addWidget: (type: string, defaultSize: { width: number; height: number }, defaultConfig: Record<string, unknown>) => void;
  removeWidget: (id: string) => void;
  updateWidgetPosition: (id: string, x: number, y: number) => void;
  updateWidgetSize: (id: string, width: number, height: number) => void;
  selectWidget: (id: string | null) => void;
  updateWidgetConfig: (id: string, patch: Record<string, unknown>) => void;
  updateTheme: (patch: Partial<Layout['theme']>) => void;
  // Layout file I/O
  saveLayout: () => Promise<void>;
  loadLayout: () => Promise<void>;
  loadLayoutFromPath: (path: string) => Promise<void>;
  clearLayoutMessage: () => void;
  // Export
  exportVideo: () => Promise<void>;
  cancelExport: () => void;
}

function validateAndNormalizeLayout(
  raw: unknown,
  knownTypes: Set<string>,
): { layout: Layout; skippedTypes: string[] } {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Not a JSON object');
  }
  const obj = raw as Record<string, unknown>;

  const version = obj['schema_version'];
  if (version !== '1' && version !== '1.0.0') {
    throw new Error(`Unsupported schema_version: ${String(version)}`);
  }

  const theme = obj['theme'];
  if (typeof theme !== 'object' || theme === null) {
    throw new Error('Missing or invalid theme');
  }
  const t = theme as Record<string, unknown>;
  if (typeof t['fontFamily'] !== 'string' || typeof t['primaryColor'] !== 'string' || typeof t['backgroundOpacity'] !== 'number') {
    throw new Error('Invalid theme fields');
  }

  if (!Array.isArray(obj['widgets'])) {
    throw new Error('Missing widgets array');
  }

  const skippedTypes: string[] = [];
  const widgets: WidgetInstance[] = [];

  for (const w of obj['widgets'] as unknown[]) {
    if (typeof w !== 'object' || w === null) continue;
    const widget = w as Record<string, unknown>;
    if (
      typeof widget['id'] !== 'string' ||
      typeof widget['type'] !== 'string' ||
      typeof widget['version'] !== 'string' ||
      typeof widget['position'] !== 'object' ||
      typeof widget['size'] !== 'object' ||
      typeof widget['config'] !== 'object'
    ) {
      throw new Error('Widget entry missing required fields');
    }
    if (!knownTypes.has(widget['type'] as string)) {
      if (!skippedTypes.includes(widget['type'] as string)) {
        skippedTypes.push(widget['type'] as string);
      }
      continue;
    }
    widgets.push(widget as unknown as WidgetInstance);
  }

  const layout: Layout = {
    schema_version: '1',
    theme: t as unknown as Layout['theme'],
    widgets,
  };
  return { layout, skippedTypes };
}

export const useStore = create<AppState>((set, get) => ({
  videoPath: null,
  telemetryPath: null,
  videoMetadata: null,
  frames: [],
  route: null,
  sessionDurationMs: 0,
  isProcessing: false,
  processingError: null,
  offsetMs: 0,
  layout: DEFAULT_LAYOUT,
  selectedWidgetId: null,
  ffmpegAvailable: false,
  isExporting: false,
  exportError: null,
  exportProgress: null,
  exportResolution: 'source' as ExportResolution,
  exportEncoder: 'balanced' as ExportEncoder,
  exportBitrate: 'auto' as ExportBitrate,
  cropVertical: false,
  trimStart: null,
  trimEnd: null,
  verticalZoom: 1.0,
  verticalOffsetX: 0,
  verticalOffsetY: 0,
  isSyncing: false,
  syncMessage: null,
  layoutMessage: null,

  init: async () => {
    const ok = await invoke<boolean>('check_ffmpeg');
    set({ ffmpegAvailable: ok });
  },

  // ── File import via dialog ──────────────────────────────────────
  importVideo: async () => {
    const result = await open({ filters: VIDEO_FILTERS, multiple: false });
    if (!result || typeof result !== 'string') return;
    await get().setVideoFromPath(result as string);
  },

  importTelemetry: async () => {
    const result = await open({ filters: TELEMETRY_FILTERS, multiple: false });
    if (!result || typeof result !== 'string') return;
    await get().setTelemetryFromPath(result as string);
  },

  // ── File import via path (drag-and-drop) ───────────────────────
  setVideoFromPath: async (path) => {
    try {
      const meta = await invoke<VideoMetadataDto>('get_video_metadata', { videoPath: path });
      set({ videoPath: path, videoMetadata: meta, syncMessage: null });
      await get().maybeProcess();
    } catch (e) {
      set({ processingError: `Could not read video: ${String(e)}` });
    }
  },

  setTelemetryFromPath: async (path) => {
    set({ telemetryPath: path, syncMessage: null });
    await get().maybeProcess();
  },

  // ── Pipeline ────────────────────────────────────────────────────
  setOffsetMs: (ms) => {
    set({ offsetMs: ms, syncMessage: null });
    if (reprocessTimeout) clearTimeout(reprocessTimeout);
    reprocessTimeout = setTimeout(() => get().applyOffset(), 600);
  },

  applyOffset: () => {
    void get().maybeProcess();
  },

  maybeProcess: async () => {
    const { videoPath, telemetryPath, videoMetadata, offsetMs } = get();
    if (!videoPath || !telemetryPath || !videoMetadata) return;

    set({ isProcessing: true, processingError: null });
    try {
      const result = await invoke<ProcessResult>('process_telemetry', {
        telemetryPath,
        videoPath,
        offsetMs,
        fps: videoMetadata.frameRate,
      });
      set({ frames: result.frames, route: result.route, sessionDurationMs: result.sessionDurationMs, isProcessing: false });
    } catch (e) {
      set({ isProcessing: false, processingError: String(e) });
    }
  },

  computeAutoSync: async () => {
    const { videoPath, telemetryPath } = get();
    if (!videoPath || !telemetryPath) return;

    set({ isSyncing: true, syncMessage: null });
    try {
      const offsetMs = await invoke<number>('compute_auto_sync', { videoPath, telemetryPath });
      set({ offsetMs, isSyncing: false, syncMessage: `Auto-synced: offset ${offsetMs > 0 ? '+' : ''}${(offsetMs / 1000).toFixed(2)}s` });
      await get().maybeProcess();
    } catch (e) {
      set({
        isSyncing: false,
        syncMessage: `Auto-sync failed — no embedded timestamps found. Adjust offset manually.`,
      });
    }
  },

  // ── Layout ──────────────────────────────────────────────────────
  addWidget: (type, defaultSize, defaultConfig) => {
    const { layout, cropVertical } = get();
    const count = layout.widgets.length;
    // In crop mode the visible strip starts at x=656 in 1920×1080 space;
    // offset the default spawn position so widgets appear in the visible area.
    const CROP_OFFSET_X = Math.floor((1920 - Math.floor(1080 * 9 / 16)) / 2); // 656
    const baseX = cropVertical ? CROP_OFFSET_X + 20 : 20;
    const newWidget: WidgetInstance = {
      id: generateId(),
      type,
      version: '1.0.0',
      position: { x: baseX + count * 12, y: 20 + count * 12 },
      size: defaultSize,
      config: defaultConfig,
    };
    set({ layout: { ...layout, widgets: [...layout.widgets, newWidget] } });
  },

  removeWidget: (id) => {
    const { layout, selectedWidgetId } = get();
    set({
      layout: { ...layout, widgets: layout.widgets.filter((w) => w.id !== id) },
      selectedWidgetId: selectedWidgetId === id ? null : selectedWidgetId,
    });
  },

  updateWidgetPosition: (id, x, y) => {
    const { layout } = get();
    set({
      layout: {
        ...layout,
        widgets: layout.widgets.map((w) => (w.id === id ? { ...w, position: { x, y } } : w)),
      },
    });
  },

  updateWidgetSize: (id, width, height) => {
    const { layout } = get();
    set({
      layout: {
        ...layout,
        widgets: layout.widgets.map((w) => (w.id === id ? { ...w, size: { width, height } } : w)),
      },
    });
  },

  selectWidget: (id) => set({ selectedWidgetId: id }),

  updateWidgetConfig: (id, patch) => {
    const { layout } = get();
    set({
      layout: {
        ...layout,
        widgets: layout.widgets.map((w) =>
          w.id === id ? { ...w, config: { ...w.config, ...patch } } : w
        ),
      },
    });
  },

  updateTheme: (patch) => {
    const { layout } = get();
    set({ layout: { ...layout, theme: { ...layout.theme, ...patch } } });
  },

  // ── Layout file I/O ─────────────────────────────────────────────
  saveLayout: async () => {
    const { layout } = get();
    const path = await save({ filters: LAYOUT_FILTERS, defaultPath: 'layout.json' });
    if (!path) return;
    const content = JSON.stringify(
      { schema_version: layout.schema_version, theme: layout.theme, widgets: layout.widgets },
      null,
      2,
    );
    try {
      await invoke('save_layout_file', { path, content });
      set({ layoutMessage: 'Layout saved.' });
    } catch (e) {
      set({ layoutMessage: `Could not save layout: ${String(e)}` });
    }
  },

  loadLayout: async () => {
    const result = await open({ filters: LAYOUT_FILTERS, multiple: false });
    if (!result || typeof result !== 'string') return;
    await get().loadLayoutFromPath(result as string);
  },

  loadLayoutFromPath: async (path) => {
    let content: string;
    try {
      content = await invoke<string>('read_layout_file', { path });
    } catch (e) {
      set({ layoutMessage: `Could not read layout: ${String(e)}` });
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      set({ layoutMessage: 'Invalid layout: file is not valid JSON.' });
      return;
    }
    try {
      const { layout: newLayout, skippedTypes } = validateAndNormalizeLayout(
        raw,
        new Set(Object.keys(WIDGET_REGISTRY)),
      );
      const msg = skippedTypes.length > 0
        ? `Layout loaded. Skipped unknown type(s): ${skippedTypes.join(', ')}`
        : 'Layout loaded.';
      set({ layout: newLayout, selectedWidgetId: null, layoutMessage: msg });
    } catch (e) {
      set({ layoutMessage: `Invalid layout: ${String(e)}` });
    }
  },

  clearLayoutMessage: () => set({ layoutMessage: null }),

  setExportResolution: (r) => set({ exportResolution: r }),
  setExportEncoder: (e) => set({ exportEncoder: e }),
  setExportBitrate: (b) => set({ exportBitrate: b }),
  setCropVertical: (v) => set({ cropVertical: v }),
  setTrimStart: (s) => set({ trimStart: s }),
  setTrimEnd: (e) => set({ trimEnd: e }),
  setVerticalZoom: (v) => set({ verticalZoom: v }),
  setVerticalOffsetX: (v) => set({ verticalOffsetX: v }),
  setVerticalOffsetY: (v) => set({ verticalOffsetY: v }),

  // ── Export ──────────────────────────────────────────────────────
  exportVideo: async () => {
    const { videoPath, frames, route, layout, exportResolution, exportEncoder, exportBitrate, videoMetadata, cropVertical, trimStart, trimEnd, verticalZoom, verticalOffsetX, verticalOffsetY } = get();
    const { width, height } = resolveOutputSize(exportResolution, videoMetadata, cropVertical);
    if (!videoPath || frames.length === 0) return;

    const outputPath = await save({ filters: VIDEO_OUTPUT_FILTERS, defaultPath: 'output.mp4' });
    if (!outputPath) return;

    const fps = videoMetadata?.frameRate ?? 30;
    const startIdx = trimStart != null ? Math.round(trimStart * fps) : 0;
    const endIdx   = trimEnd   != null ? Math.round(trimEnd   * fps) : frames.length;
    const exportFrames = frames.slice(startIdx, Math.min(endIdx, frames.length));

    // Check OffscreenCanvas availability (requires macOS 13+ / WebKit 16.4+)
    if (typeof OffscreenCanvas === 'undefined') {
      set({ exportError: 'Export requires macOS 13 or newer (OffscreenCanvas is not available in this WebView).' });
      return;
    }

    let sessionId: string;
    try {
      sessionId = await invoke<string>('start_export_session', {
        videoPath, outputPath, width, height, encoder: exportEncoder,
        cropVertical,
        trimStart: trimStart ?? null,
        trimEnd: trimEnd ?? null,
        verticalZoom,
        verticalOffsetX,
        verticalOffsetY,
        exportBitrate,
      });
    } catch (e) {
      set({ exportError: String(e) });
      return;
    }

    activeExportSessionId = sessionId;
    const total = exportFrames.length;
    set({ isExporting: true, exportError: null, exportProgress: { done: 0, total } });

    const worker = new Worker(new URL('../export/ExportWorker.ts', import.meta.url), {
      type: 'module',
    });
    activeExportWorker = worker;

    await new Promise<void>((resolve) => {
      const cleanup = () => {
        worker.terminate();
        activeExportWorker = null;
        activeExportSessionId = null;
      };

      worker.onmessage = async (e: MessageEvent) => {
        const msg = e.data as { type: string; frameIndex?: number; data?: string; message?: string };

        if (msg.type === 'frame') {
          try {
            await invoke('write_frame', { sessionId, frameB64: msg.data! });
            set((state) => ({
              exportProgress: state.exportProgress
                ? { ...state.exportProgress, done: (msg.frameIndex ?? 0) + 1 }
                : null,
            }));
            worker.postMessage({ type: 'ack' });
          } catch (err) {
            worker.postMessage({ type: 'abort' });
            await invoke('abort_export', { sessionId }).catch(() => {});
            set({ isExporting: false, exportProgress: null, exportError: String(err) });
            cleanup();
            resolve();
          }
        } else if (msg.type === 'done') {
          try {
            await invoke('finish_export', { sessionId });
          } catch (err) {
            set({ isExporting: false, exportProgress: null, exportError: String(err) });
            cleanup();
            resolve();
            return;
          }
          set({ isExporting: false, exportProgress: null });
          cleanup();
          resolve();
        } else if (msg.type === 'error') {
          await invoke('abort_export', { sessionId }).catch(() => {});
          set({ isExporting: false, exportProgress: null, exportError: msg.message ?? 'Unknown worker error' });
          cleanup();
          resolve();
        }
      };

      worker.onerror = async (e) => {
        await invoke('abort_export', { sessionId }).catch(() => {});
        set({ isExporting: false, exportProgress: null, exportError: `Worker error: ${e.message}` });
        cleanup();
        resolve();
      };

      const startMsg: StartMessage = {
        type: 'start',
        frames: exportFrames,
        route: route ?? { points: [], bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 } },
        layout: {
          theme: layout.theme,
          widgets: layout.widgets,
        },
        width,
        height,
      };
      worker.postMessage(startMsg);
    });
  },

  cancelExport: () => {
    const sessionId = activeExportSessionId;
    if (activeExportWorker) {
      activeExportWorker.postMessage({ type: 'abort' });
      activeExportWorker.terminate();
      activeExportWorker = null;
    }
    if (sessionId) {
      void invoke('abort_export', { sessionId });
      activeExportSessionId = null;
    }
    set({ isExporting: false, exportProgress: null });
  },
}));
