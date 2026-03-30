import { useRef, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import type { ExportResolution, ExportEncoder, ExportBitrate } from '../store/useStore';
import logo from '../assets/logo.png';

function parseTime(str: string): number | null {
  const trimmed = str.trim();
  if (!trimmed) return null;
  // Plain number
  if (/^\d+(\.\d+)?$/.test(trimmed)) return parseFloat(trimmed);
  // H:MM:SS or M:SS
  const parts = trimmed.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

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

const ENCODER_OPTIONS: { value: ExportEncoder; label: string }[] = [
  { value: 'balanced', label: 'Balanced' },
  { value: 'fast',     label: 'Fast'     },
  { value: 'hardware', label: 'Hardware' },
];

const BITRATE_OPTIONS: { value: ExportBitrate; label: string }[] = [
  { value: 'auto',  label: 'Auto'        },
  { value: 'match', label: 'Match source' },
  { value: '4M',    label: '4 Mbps'      },
  { value: '8M',    label: '8 Mbps'      },
  { value: '16M',   label: '16 Mbps'     },
  { value: '25M',   label: '25 Mbps'     },
  { value: '50M',   label: '50 Mbps'     },
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
    videoMetadata,
    importVideo,
    importTelemetry,
    exportVideo,
    cancelExport,
    setExportResolution,
    exportEncoder,
    setExportEncoder,
    exportBitrate,
    setExportBitrate,
    cropVertical,
    trimStart,
    trimEnd,
    setCropVertical,
    setTrimStart,
    setTrimEnd,
    saveLayout,
    loadLayout,
    layoutMessage,
    clearLayoutMessage,
  } = useStore();

  const canExport = !!videoPath && !!telemetryPath && frames.length > 0 && !isExporting;

  // Track when the current export started so we can estimate time remaining.
  const exportStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (isExporting) exportStartRef.current = Date.now();
  }, [isExporting]);

  const stableClearLayoutMessage = useCallback(clearLayoutMessage, [clearLayoutMessage]);
  useEffect(() => {
    if (!layoutMessage) return;
    const t = setTimeout(stableClearLayoutMessage, 4000);
    return () => clearTimeout(t);
  }, [layoutMessage, stableClearLayoutMessage]);

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

      <button className="btn" onClick={() => void saveLayout()} disabled={isExporting}>
        ⬇ Save Layout
      </button>
      <button className="btn" onClick={() => void loadLayout()} disabled={isExporting}>
        ⬆ Load Layout
      </button>
      {layoutMessage && (
        <span style={{ fontSize: 11, color: '#888' }}>{layoutMessage}</span>
      )}

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

      <select
        className="btn"
        value={exportEncoder}
        onChange={(e) => setExportEncoder(e.target.value as ExportEncoder)}
        disabled={isExporting}
        style={{ fontSize: 12, padding: '3px 6px' }}
      >
        {ENCODER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <select
        className="btn"
        value={exportBitrate}
        onChange={(e) => setExportBitrate(e.target.value as ExportBitrate)}
        disabled={isExporting}
        style={{ fontSize: 12, padding: '3px 6px' }}
      >
        {BITRATE_OPTIONS.map((o) => {
          const label = o.value === 'match' && videoMetadata?.bitRateBps
            ? `Match source (${Math.round(videoMetadata.bitRateBps / 1_000_000)} Mbps)`
            : o.label;
          return <option key={o.value} value={o.value}>{label}</option>;
        })}
      </select>

      <div className="toolbar-sep" />

      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#ccc', cursor: isExporting ? 'not-allowed' : 'pointer' }}>
        <input
          type="checkbox"
          checked={cropVertical}
          onChange={(e) => setCropVertical(e.target.checked)}
          disabled={isExporting}
        />
        9:16
      </label>

      <span style={{ fontSize: 12, color: '#888' }}>Trim:</span>
      <input
        type="text"
        className="btn"
        placeholder="0:00"
        defaultValue={trimStart != null ? formatTime(trimStart) : ''}
        key={`ts-${trimStart}`}
        onBlur={(e) => setTrimStart(parseTime(e.target.value))}
        disabled={isExporting}
        style={{ width: 48, fontSize: 12, padding: '3px 6px', textAlign: 'center' }}
      />
      <span style={{ fontSize: 11, color: '#666' }}>→</span>
      <input
        type="text"
        className="btn"
        placeholder={videoMetadata ? formatTime(videoMetadata.durationMs / 1000) : 'end'}
        defaultValue={trimEnd != null ? formatTime(trimEnd) : ''}
        key={`te-${trimEnd}`}
        onBlur={(e) => setTrimEnd(parseTime(e.target.value))}
        disabled={isExporting}
        style={{ width: 48, fontSize: 12, padding: '3px 6px', textAlign: 'center' }}
      />

      <div className="toolbar-sep" />

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
