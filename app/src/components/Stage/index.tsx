import { useRef, useState, useEffect, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useStore } from '../../store/useStore';
import WidgetCanvas from './WidgetCanvas';
import Timeline from '../Timeline';

const STAGE_W = 1920;
const STAGE_H = 1080;

export default function Stage() {
  const { videoPath, layout, selectedWidgetId, selectWidget, isProcessing, videoMetadata, exportError } =
    useStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const [videoTimeMs, setVideoTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // ── Scale stage to fit the available viewport ─────────────────
  // We measure the viewport and compute the largest scale that fits,
  // with 24px padding on each side.
  useEffect(() => {
    if (!viewportRef.current) return;
    const measure = () => {
      const { width, height } = viewportRef.current!.getBoundingClientRect();
      const pad = 24;
      const s = Math.min((width - pad * 2) / STAGE_W, (height - pad * 2) / STAGE_H, 1);
      setScale(Math.max(s, 0.1)); // never scale below 10%
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(viewportRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Video time + play state ────────────────────────────────────
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) setVideoTimeMs(videoRef.current.currentTime * 1000);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.paused ? void v.play() : v.pause();
  }, []);

  // Space bar toggles play/pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay]);

  const handleStageClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) selectWidget(null);
    },
    [selectWidget],
  );

  const durationMs = videoMetadata?.durationMs ?? 0;

  // The wrapper div is exactly this size in screen-space, so that the layout
  // footprint matches the visible area.  (CSS transform doesn't affect layout,
  // so without the wrapper the 1920 px container would overflow and shift left.)
  const displayW = Math.round(STAGE_W * scale);
  const displayH = Math.round(STAGE_H * scale);

  return (
    <div className="stage-area">
      <div className="stage-viewport" ref={viewportRef}>
        {!videoPath ? (
          <div className="empty-stage">
            <strong>No video loaded</strong>
            <span>Drag a video file anywhere onto this window.</span>
            <span>Or click "+ Video" in the toolbar.</span>
            <span style={{ marginTop: 8, fontSize: 11, color: '#555' }}>
              Supports .mp4 / .mov &nbsp;·&nbsp; Telemetry: .fit / .gpx / .tcx
            </span>
          </div>
        ) : (
          /*
           * Outer wrapper — constrains the layout footprint to the scaled size.
           * The inner stage-container is positioned absolutely inside it at
           * full 1920×1080, then CSS-scaled from the top-left corner.
           */
          <div
            className="stage-frame"
            style={{ width: displayW, height: displayH }}
          >
            <div
              className="stage-container"
              style={{
                width: STAGE_W,
                height: STAGE_H,
                transform: `scale(${scale})`,
              }}
              onClick={handleStageClick}
            >
              <video
                ref={videoRef}
                className="stage-video"
                src={convertFileSrc(videoPath)}
                controls={false}
                onTimeUpdate={handleTimeUpdate}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                onClick={togglePlay}
              />

              <div className="stage-overlay">
                {layout.widgets.map((w) => (
                  <WidgetCanvas
                    key={w.id}
                    instance={w}
                    videoRef={videoRef}
                    isSelected={selectedWidgetId === w.id}
                    scale={scale}
                  />
                ))}
              </div>

              {isProcessing && <div className="processing-bar" />}
            </div>
          </div>
        )}
      </div>

      {exportError && (
        <div className="error-banner" style={{ margin: '4px 16px' }}>
          Export failed: {exportError}
        </div>
      )}

      <Timeline
        videoRef={videoRef}
        videoTimeMs={videoTimeMs}
        videoDurationMs={durationMs}
        isPlaying={isPlaying}
        onPlayPause={togglePlay}
      />
    </div>
  );
}
