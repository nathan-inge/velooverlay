import { useRef } from 'react';
import { useStore } from '../store/useStore';

function formatTime(ms: number): string {
  const totalSecs = Math.floor(Math.abs(ms) / 1000);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  const sign = ms < 0 ? '-' : '';
  return `${sign}${m}:${s.toString().padStart(2, '0')}`;
}

interface Props {
  videoTimeMs: number;
  videoDurationMs: number;
  sessionDurationMs: number;
}

export default function SyncTimeline({ videoTimeMs, videoDurationMs, sessionDurationMs }: Props) {
  const { offsetMs, setOffsetMs } = useStore();
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startOffset: number } | null>(null);

  if (!sessionDurationMs || !videoDurationMs) return null;

  // Compute display range so both the telemetry session and the video clip are always visible.
  const displayStart = Math.min(0, offsetMs);
  const displayEnd = Math.max(sessionDurationMs, offsetMs + videoDurationMs);
  const displayDuration = displayEnd - displayStart;

  // Convert a millisecond value to a percentage of the display range.
  const pct = (ms: number) => ((ms - displayStart) / displayDuration) * 100;

  const telemetryLeft = pct(0);
  const telemetryWidth = (sessionDurationMs / displayDuration) * 100;
  const clipLeft = pct(offsetMs);
  const clipWidth = (videoDurationMs / displayDuration) * 100;
  // Playhead: position within the clip block, as percentage of clip width.
  const playheadPctInClip = videoDurationMs > 0 ? (videoTimeMs / videoDurationMs) * 100 : 0;

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    const bar = barRef.current;
    if (!bar) return;
    dragRef.current = { startX: e.clientX, startOffset: offsetMs };

    const barWidth = bar.getBoundingClientRect().width;

    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = me.clientX - dragRef.current.startX;
      const msPerPx = displayDuration / barWidth;
      const newOffset = Math.round(dragRef.current.startOffset + dx * msPerPx);
      setOffsetMs(newOffset);
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="sync-tl-wrapper">
      <span className="sync-tl-label">Timeline</span>
      <div className="sync-tl" ref={barRef}>
        {/* Telemetry activity bar */}
        <div
          className="sync-tl-track"
          style={{ left: `${telemetryLeft}%`, width: `${telemetryWidth}%` }}
        />

        {/* Draggable video clip block */}
        <div
          className="sync-tl-clip"
          style={{ left: `${clipLeft}%`, width: `${clipWidth}%` }}
          onMouseDown={handleMouseDown}
          title="Drag to shift video position relative to telemetry"
        >
          {/* Playhead */}
          <div
            className="sync-tl-playhead"
            style={{ left: `${playheadPctInClip}%` }}
          />
          <span className="sync-tl-clip-label">video</span>
        </div>

        {/* Tick labels */}
        <div className="sync-tl-ticks">
          <span style={{ left: `${telemetryLeft}%` }}>{formatTime(0)}</span>
          <span style={{ left: `${telemetryLeft + telemetryWidth}%` }}>
            {formatTime(sessionDurationMs)}
          </span>
        </div>
      </div>
    </div>
  );
}
