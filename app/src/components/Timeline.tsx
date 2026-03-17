import { useCallback } from 'react';
import { useStore } from '../store/useStore';
import SyncTimeline from './SyncTimeline';

function formatMs(ms: number): string {
  const sign = ms < 0 ? '-' : '+';
  const abs = Math.abs(ms);
  return `${sign}${(abs / 1000).toFixed(2)}s`;
}

function formatTime(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoTimeMs: number;
  videoDurationMs: number;
  isPlaying: boolean;
  onPlayPause: () => void;
}

export default function Timeline({ videoRef, videoTimeMs, videoDurationMs, isPlaying, onPlayPause }: Props) {
  const {
    offsetMs,
    isProcessing,
    isSyncing,
    syncMessage,
    videoPath,
    telemetryPath,
    sessionDurationMs,
    setOffsetMs,
    computeAutoSync,
  } = useStore();

  const canAutoSync = !!videoPath && !!telemetryPath && !isSyncing && !isProcessing;

  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const ms = Number(e.target.value);
      const v = videoRef.current;
      if (v) v.currentTime = ms / 1000;
    },
    [videoRef],
  );

  const MIN_OFFSET = -60_000;
  const MAX_OFFSET = 60_000;

  return (
    <div className="timeline">
      {/* ── Row 1: Playback controls ───────────────────────── */}
      <div className="timeline-row">
        {/* Play / Pause */}
        <button
          className="play-btn"
          onClick={onPlayPause}
          disabled={!videoPath}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        {/* Video scrubber */}
        <input
          type="range"
          className="timeline-slider scrubber"
          min={0}
          max={videoDurationMs || 1}
          step={100}
          value={videoTimeMs}
          onChange={handleSeek}
          disabled={!videoPath}
        />

        {/* Time display */}
        <span className="timeline-time">
          {formatTime(videoTimeMs)}&thinsp;/&thinsp;{formatTime(videoDurationMs)}
        </span>

        <div className="timeline-sep" />

        {/* Auto-sync */}
        <button
          className="btn small"
          onClick={() => void computeAutoSync()}
          disabled={!canAutoSync}
          title="Use embedded timestamps to automatically align telemetry with video"
        >
          {isSyncing ? 'Syncing…' : '⚡ Auto Sync'}
        </button>
      </div>

      {/* ── Row 2: Visual sync timeline ───────────────────── */}
      <SyncTimeline
        videoTimeMs={videoTimeMs}
        videoDurationMs={videoDurationMs}
        sessionDurationMs={sessionDurationMs}
      />

      {/* ── Row 3: Manual fine-offset slider ──────────────── */}
      <div className="timeline-row">
        <span className="timeline-label">Sync offset</span>

        <input
          type="range"
          className="timeline-slider"
          min={MIN_OFFSET}
          max={MAX_OFFSET}
          step={100}
          value={offsetMs}
          onChange={(e) => setOffsetMs(Number(e.target.value))}
          disabled={isProcessing}
        />

        <span className="timeline-value">{formatMs(offsetMs)}</span>

        <button
          className="btn small"
          onClick={() => setOffsetMs(0)}
          disabled={offsetMs === 0 || isProcessing}
        >
          Reset
        </button>

        {/* Sync status message */}
        {syncMessage && (
          <span
            className="sync-message"
            style={{ color: syncMessage.startsWith('Auto-synced') ? 'var(--success)' : 'var(--danger)' }}
          >
            {syncMessage}
          </span>
        )}

        {/* Processing indicator */}
        {isProcessing && <span className="sync-message" style={{ color: 'var(--accent)' }}>Processing…</span>}
      </div>
    </div>
  );
}
