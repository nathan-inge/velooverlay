import { useStore } from '../store/useStore';
import logo from '../assets/logo.png';

export default function Toolbar() {
  const {
    videoPath,
    telemetryPath,
    ffmpegAvailable,
    isProcessing,
    isExporting,
    frames,
    importVideo,
    importTelemetry,
    exportVideo,
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

      <button
        className="btn primary"
        onClick={() => void exportVideo()}
        disabled={!canExport || !ffmpegAvailable}
      >
        {isExporting ? 'Exporting…' : '⬇ Export MP4'}
      </button>
    </div>
  );
}
