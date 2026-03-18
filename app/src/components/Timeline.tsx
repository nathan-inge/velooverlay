import { useCallback } from 'react';
import { useStore } from '../store/useStore';
import SyncTimeline from './SyncTimeline';

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
    isProcessing,
    isSyncing,
    syncMessage,
    videoPath,
    telemetryPath,
    sessionDurationMs,
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

  return (
    <div className="timeline">
      {/* ── Row 1: Playback controls ───────────────────────── */}
      <div className="timeline-row">
        <button
          className="play-btn"
          onClick={onPlayPause}
          disabled={!videoPath}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

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

        <span className="timeline-time">
          {formatTime(videoTimeMs)}&thinsp;/&thinsp;{formatTime(videoDurationMs)}
        </span>

        <div className="timeline-sep" />

        <button
          className="btn small"
          onClick={() => void computeAutoSync()}
          disabled={!canAutoSync}
          title="Use embedded timestamps to automatically align telemetry with video"
        >
          {isSyncing ? 'Syncing…' : '⚡ Auto Sync'}
        </button>

        {syncMessage && (
          <span
            className="sync-message"
            style={{ color: syncMessage.startsWith('Auto-synced') ? 'var(--success)' : 'var(--danger)' }}
          >
            {syncMessage}
          </span>
        )}
        {isProcessing && <span className="sync-message" style={{ color: 'var(--accent)' }}>Processing…</span>}
      </div>

      {/* ── Row 2: Visual sync timeline ───────────────────── */}
      <SyncTimeline
        videoTimeMs={videoTimeMs}
        videoDurationMs={videoDurationMs}
        sessionDurationMs={sessionDurationMs}
      />
    </div>
  );
}
