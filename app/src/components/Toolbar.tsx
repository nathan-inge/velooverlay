import { useStore } from '../store/useStore';
import type { ExportResolution } from '../store/useStore';
import logo from '../assets/logo.png';

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
        <span style={{ fontSize: 11, color: '#aaa' }}>
          {exportProgress.done} / {exportProgress.total} frames
        </span>
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
