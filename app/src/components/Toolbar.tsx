import { useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import type { ExportResolution } from '../store/useStore';
import logo from '../assets/logo.png';

function formatEta(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

const RESOLUTION_OPTIONS: { value: ExportResolution; label: string }[] = [
  { value: 'source', label: 'Source' },
  { value: '1080p',  label: '1080p' },
  { value: '1440p',  label: '1440p' },
  { value: '4k',     label: '4K'    },
];

export default function Toolbar() {
  const {
    videoPath,
    telemetryPath,
    ffmpegAvailable,
    isProcessing,
    isExporting,
    exportProgress,
    exportResolution,
    frames,
    importVideo,
    importTelemetry,
    exportVideo,
    cancelExport,
    setExportResolution,
  } = useStore();

  const canExport = !!videoPath && !!telemetryPath && frames.length > 0 && !isExporting;

  // Track when the current export started so we can estimate time remaining.
  const exportStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (isExporting) exportStartRef.current = Date.now();
  }, [isExporting]);

  let progressPct = 0;
  let etaText = '';
  if (isExporting && exportProgress && exportProgress.total > 0) {
    progressPct = exportProgress.done / exportProgress.total;
    // Wait for a few frames before showing ETA so the initial estimate is stable.
    if (exportProgress.done > 3 && exportStartRef.current !== null) {
      const elapsed = Date.now() - exportStartRef.current;
      const msRemaining = (elapsed / exportProgress.done) * (exportProgress.total - exportProgress.done);
      etaText = formatEta(msRemaining);
    }
  }

  return (
    <div className="toolbar">
      <img src={logo} alt="VeloOverlay" className="toolbar-logo" />
      <div className="toolbar-sep" />

      <button className="btn" onClick={() => void importVideo()} disabled={isProcessing}>
        {videoPath ? '↺ Video' : '+ Video'}
      </button>
      <button className="btn" onClick={() => void importTelemetry()} disabled={isProcessing}>
        {telemetryPath ? '↺ Telemetry' : '+ Telemetry'}
      </button>

      <div className="toolbar-sep" />

      {videoPath && (
        <span style={{ fontSize: 11, color: '#888', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {videoPath.split(/[\\/]/).pop()}
        </span>
      )}
      {telemetryPath && (
        <span style={{ fontSize: 11, color: '#888', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {telemetryPath.split(/[\\/]/).pop()}
        </span>
      )}

      <div className="toolbar-spacer" />

      <div className="toolbar-status">
        <span className={`dot ${ffmpegAvailable ? 'ok' : 'err'}`} />
        <span>FFmpeg {ffmpegAvailable ? 'ready' : 'not found'}</span>
      </div>

      <div className="toolbar-sep" />

      {isExporting && exportProgress && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 120 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#aaa' }}>
            <span>{Math.round(progressPct * 100)}%</span>
            {etaText && <span>~{etaText}</span>}
          </div>
          <div style={{ height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              width: `${progressPct * 100}%`,
              height: '100%',
              background: '#00d1ff',
              borderRadius: 2,
              transition: 'width 0.15s ease',
            }} />
          </div>
        </div>
      )}

      <select
        className="btn"
        value={exportResolution}
        onChange={(e) => setExportResolution(e.target.value as ExportResolution)}
        disabled={isExporting}
        style={{ fontSize: 12, padding: '3px 6px' }}
      >
        {RESOLUTION_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {isExporting ? (
        <button className="btn" onClick={cancelExport}>
          ✕ Cancel
        </button>
      ) : (
        <button
          className="btn primary"
          onClick={() => void exportVideo()}
          disabled={!canExport || !ffmpegAvailable}
        >
          ⬇ Export MP4
        </button>
      )}
    </div>
  );
}
