import { useRef, useState, useEffect } from 'react';
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

  // Zoom/pan view state — null means auto-fit (full range, current behavior)
  const [viewStartMs, setViewStartMs] = useState<number | null>(null);
  const [viewDurationMs, setViewDurationMs] = useState<number | null>(null);

  const barRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);

  // Refs kept current on every render — used by the stable wheel handler closure
  const viewStartRef = useRef<number | null>(null);
  const viewDurRef = useRef<number | null>(null);
  const fullDurationRef = useRef<number>(0);
  const fullStartRef = useRef<number>(0);

  // Drag state
  const clipDragRef = useRef<{ startX: number; startOffset: number } | null>(null);
  const ovDragRef = useRef(false);

  // Wheel zoom handler — must be non-passive, added once with stable closure via refs
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const fStart = fullStartRef.current;
      const fDur = fullDurationRef.current;
      if (!fDur) return;

      const rect = el.getBoundingClientRect();
      const cursorFrac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

      const curViewStart = viewStartRef.current ?? fStart;
      const curViewDur = viewDurRef.current ?? fDur;

      const ZOOM_SPEED = 0.15;
      const factor = e.deltaY > 0 ? (1 - ZOOM_SPEED) : (1 + ZOOM_SPEED);

      let newDur = curViewDur * factor;
      newDur = Math.max(2000, Math.min(fDur, newDur));

      // Anchor zoom to cursor position
      const anchorMs = curViewStart + cursorFrac * curViewDur;
      let newStart = anchorMs - cursorFrac * newDur;
      newStart = Math.max(fStart, Math.min(fStart + fDur - newDur, newStart));

      if (newDur >= fDur - 100) {
        setViewStartMs(null);
        setViewDurationMs(null);
      } else {
        setViewStartMs(newStart);
        setViewDurationMs(newDur);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // All hooks must be above this early return
  if (!sessionDurationMs || !videoDurationMs) return null;

  // Full auto-fit range.
  // The video clip sits at telemetry position -offsetMs because:
  //   telem_time = video_time - offset_ms  →  at video_time=0, telem=(-offsetMs)
  const fullStart = Math.min(0, -offsetMs);
  const fullEnd = Math.max(sessionDurationMs, -offsetMs + videoDurationMs);
  const fullDuration = fullEnd - fullStart;

  // Keep refs current for wheel handler
  viewStartRef.current = viewStartMs;
  viewDurRef.current = viewDurationMs;
  fullDurationRef.current = fullDuration;
  fullStartRef.current = fullStart;

  const isZoomed = viewStartMs !== null && viewDurationMs !== null;
  const viewStart = viewStartMs ?? fullStart;
  const viewDur = viewDurationMs ?? fullDuration;

  // Convert ms → % within zoomed view
  const pct = (ms: number) => ((ms - viewStart) / viewDur) * 100;

  // Main timeline positions
  const telLeft = pct(0);
  const telWidth = (sessionDurationMs / viewDur) * 100;
  const clipLeft = pct(-offsetMs);
  const clipWidth = (videoDurationMs / viewDur) * 100;
  const playheadPct = videoDurationMs > 0 ? (videoTimeMs / videoDurationMs) * 100 : 0;

  // Overview positions (always full range)
  const ovPct = (ms: number) => ((ms - fullStart) / fullDuration) * 100;
  const ovTelLeft = ovPct(0);
  const ovTelWidth = (sessionDurationMs / fullDuration) * 100;
  const ovClipLeft = ovPct(-offsetMs);
  const ovClipWidth = (videoDurationMs / fullDuration) * 100;
  const ovViewLeft = ovPct(viewStart);
  const ovViewWidth = (viewDur / fullDuration) * 100;

  // --- Event handlers ---

  const handleClipMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    const bar = barRef.current;
    if (!bar) return;
    clipDragRef.current = { startX: e.clientX, startOffset: offsetMs };
    const barWidth = bar.getBoundingClientRect().width;

    const onMove = (me: MouseEvent) => {
      if (!clipDragRef.current) return;
      const dx = me.clientX - clipDragRef.current.startX;
      const msPerPx = viewDur / barWidth;
      // Clip displays at -offsetMs, so dragging right (positive dx) should decrease offsetMs
      setOffsetMs(Math.round(clipDragRef.current.startOffset - dx * msPerPx));
    };
    const onUp = () => {
      clipDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleBgMouseDown = (e: React.MouseEvent) => {
    if (!isZoomed) return;
    const bar = barRef.current;
    if (!bar) return;
    const startX = e.clientX;
    const startViewStart = viewStart;
    const barWidth = bar.getBoundingClientRect().width;

    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - startX;
      const msPerPx = viewDur / barWidth;
      let newStart = startViewStart - dx * msPerPx;
      newStart = Math.max(fullStart, Math.min(fullStart + fullDuration - viewDur, newStart));
      setViewStartMs(newStart);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleDoubleClick = () => {
    setViewStartMs(null);
    setViewDurationMs(null);
  };

  const handleOverviewMouseDown = (e: React.MouseEvent) => {
    if (!isZoomed) return;
    const ov = overviewRef.current;
    if (!ov) return;
    ovDragRef.current = true;

    const jumpToX = (clientX: number) => {
      const rect = ov.getBoundingClientRect();
      const fStart = fullStartRef.current;
      const fDur = fullDurationRef.current;
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const clickMs = fStart + frac * fDur;
      const curDur = viewDurRef.current ?? fDur;
      let newStart = clickMs - curDur / 2;
      newStart = Math.max(fStart, Math.min(fStart + fDur - curDur, newStart));
      setViewStartMs(newStart);
    };

    jumpToX(e.clientX);

    const onMove = (me: MouseEvent) => {
      if (!ovDragRef.current) return;
      jumpToX(me.clientX);
    };
    const onUp = () => {
      ovDragRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="sync-tl-wrapper">
      <div className="sync-tl-labels">
        <span>video</span>
        <span>telemetry</span>
      </div>
      <div className="sync-tl-tracks">
        {/* Main zoomed timeline */}
        <div
          className="sync-tl"
          ref={barRef}
          onMouseDown={handleBgMouseDown}
          onDoubleClick={handleDoubleClick}
          style={{ cursor: isZoomed ? 'grab' : 'default' }}
        >
          {/* Video clip (top row) — draggable */}
          <div
            className="sync-tl-clip"
            style={{ left: `${clipLeft}%`, width: `${clipWidth}%` }}
            onMouseDown={handleClipMouseDown}
            title="Drag to shift video position relative to telemetry"
          >
            <div
              className="sync-tl-playhead"
              style={{ left: `${playheadPct}%` }}
            />
          </div>

          {/* Telemetry track (bottom row) */}
          <div
            className="sync-tl-track"
            style={{ left: `${telLeft}%`, width: `${telWidth}%` }}
          />

          {/* Tick labels */}
          <div className="sync-tl-ticks">
            <span style={{ left: `${pct(0)}%` }}>{formatTime(0)}</span>
            <span style={{ left: `${pct(sessionDurationMs)}%` }}>
              {formatTime(sessionDurationMs)}
            </span>
          </div>

          {/* Offset readout with coarse +/- nudge buttons */}
          <div
            className="sync-tl-offset-controls"
            onMouseDown={e => e.stopPropagation()}
          >
            <button
              className="sync-tl-nudge"
              onClick={() => setOffsetMs(offsetMs - 1000)}
              title="Decrease offset by 1 s"
            >−</button>
            <span>
              offset&thinsp;{offsetMs >= 0 ? '+' : ''}{(offsetMs / 1000).toFixed(2)}s
            </span>
            <button
              className="sync-tl-nudge"
              onClick={() => setOffsetMs(offsetMs + 1000)}
              title="Increase offset by 1 s"
            >+</button>
          </div>
        </div>

        {/* Overview strip — always shows full range */}
        <div
          className="sync-tl-overview"
          ref={overviewRef}
          onMouseDown={handleOverviewMouseDown}
        >
          <div
            className="sync-tl-ov-track"
            style={{ left: `${ovTelLeft}%`, width: `${ovTelWidth}%` }}
          />
          <div
            className="sync-tl-ov-clip"
            style={{ left: `${ovClipLeft}%`, width: `${ovClipWidth}%` }}
          />
          {isZoomed && (
            <div
              className="sync-tl-ov-viewport"
              style={{ left: `${ovViewLeft}%`, width: `${ovViewWidth}%` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
