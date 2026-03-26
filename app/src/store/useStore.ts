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

export type ExportResolution = 'source' | '1080p' | '1440p' | '4k';
export type ExportEncoder   = 'balanced' | 'fast' | 'hardware';

function resolveOutputSize(
  resolution: ExportResolution,
  meta: import('../types').VideoMetadataDto | null,
): { width: number; height: number } {
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
  isSyncing: boolean;
  syncMessage: string | null;

  // Actions
  init: () => Promise<void>;
  setExportResolution: (r: ExportResolution) => void;
  setExportEncoder: (e: ExportEncoder) => void;
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
  // Export
  exportVideo: () => Promise<void>;
  cancelExport: () => void;
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
  isSyncing: false,
  syncMessage: null,

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
    const { layout } = get();
    const count = layout.widgets.length;
    const newWidget: WidgetInstance = {
      id: generateId(),
      type,
      version: '1.0.0',
      position: { x: 20 + count * 12, y: 20 + count * 12 },
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

  setExportResolution: (r) => set({ exportResolution: r }),
  setExportEncoder: (e) => set({ exportEncoder: e }),

  // ── Export ──────────────────────────────────────────────────────
  exportVideo: async () => {
    const { videoPath, frames, route, layout, exportResolution, exportEncoder, videoMetadata } = get();
    const { width, height } = resolveOutputSize(exportResolution, videoMetadata);
    if (!videoPath || frames.length === 0) return;

    const outputPath = await save({ filters: VIDEO_OUTPUT_FILTERS, defaultPath: 'output.mp4' });
    if (!outputPath) return;

    // Check OffscreenCanvas availability (requires macOS 13+ / WebKit 16.4+)
    if (typeof OffscreenCanvas === 'undefined') {
      set({ exportError: 'Export requires macOS 13 or newer (OffscreenCanvas is not available in this WebView).' });
      return;
    }

    let sessionId: string;
    try {
      sessionId = await invoke<string>('start_export_session', { videoPath, outputPath, width, height, encoder: exportEncoder });
    } catch (e) {
      set({ exportError: String(e) });
      return;
    }

    activeExportSessionId = sessionId;
    const total = frames.length;
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
        frames,
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
