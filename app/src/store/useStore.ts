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

function generateId(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

let reprocessTimeout: ReturnType<typeof setTimeout> | null = null;

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
  isSyncing: boolean;
  syncMessage: string | null;

  // Actions
  init: () => Promise<void>;
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

  // ── Export ──────────────────────────────────────────────────────
  exportVideo: async () => {
    const { videoPath, telemetryPath, offsetMs, layout } = get();
    if (!videoPath || !telemetryPath) return;

    const outputPath = await save({ filters: VIDEO_OUTPUT_FILTERS, defaultPath: 'output.mp4' });
    if (!outputPath) return;

    // The Rust Layout struct (and CLI layout.json format) uses snake_case theme
    // keys. Convert before serializing so serde can parse the JSON correctly.
    const layoutForExport = {
      ...layout,
      theme: {
        font_family: layout.theme.fontFamily,
        primary_color: layout.theme.primaryColor,
        background_opacity: layout.theme.backgroundOpacity,
      },
    };

    set({ isExporting: true, exportError: null });
    try {
      await invoke('export_video', {
        videoPath,
        telemetryPath,
        offsetMs,
        layoutJson: JSON.stringify(layoutForExport),
        outputPath,
      });
      set({ isExporting: false });
    } catch (e) {
      set({ isExporting: false, exportError: String(e) });
    }
  },
}));
