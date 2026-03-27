import { useRef, useState, useEffect, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useStore } from '../../store/useStore';
import WidgetCanvas from './WidgetCanvas';
import Timeline from '../Timeline';

const STAGE_W = 1920;
const STAGE_H = 1080;
// Width of the 9:16 center strip in 1920×1080 widget space (matches render.rs overlay crop)
const CROP_W = Math.floor(STAGE_H * 9 / 16); // 607
const CROP_OFFSET_X = Math.floor((STAGE_W - CROP_W) / 2); // 656 — left edge of the strip

export default function Stage() {
  const { videoPath, layout, selectedWidgetId, selectWidget, isProcessing, videoMetadata, exportError } =
    useStore();
  const cropVertical    = useStore((s) => s.cropVertical);
  const verticalZoom    = useStore((s) => s.verticalZoom);
  const verticalOffsetX = useStore((s) => s.verticalOffsetX);
  const verticalOffsetY = useStore((s) => s.verticalOffsetY);

  const videoRef = useRef<HTMLVideoElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const [videoTimeMs, setVideoTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // When crop mode is active the stage shrinks to the 9:16 strip so that the
  // viewport scale recalculates to fill available space with the portrait view.
  const stageW = cropVertical ? CROP_W : STAGE_W;

  // ── Scale stage to fit the available viewport ─────────────────
  useEffect(() => {
    if (!viewportRef.current) return;
    const measure = () => {
      const { width, height } = viewportRef.current!.getBoundingClientRect();
      const pad = 24;
      const s = Math.min((width - pad * 2) / stageW, (height - pad * 2) / STAGE_H, 1);
      setScale(Math.max(s, 0.1));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(viewportRef.current);
    return () => ro.disconnect();
  }, [stageW]); // re-run whenever crop mode changes

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

  // ── Crop-mode video positioning ───────────────────────────────
  // Replicate the FFmpeg scale→crop framing in CSS so the preview exactly
  // matches the export output.  The container in crop mode is CROP_W × STAGE_H.
  const srcW = videoMetadata?.width  ?? 1920;
  const srcH = videoMetadata?.height ?? 1080;

  let cropVideoStyle: React.CSSProperties = {};
  if (cropVertical) {
    const displayScale = verticalZoom * STAGE_H / srcH;
    const videoW = srcW * displayScale;
    const videoH = STAGE_H * verticalZoom;
    cropVideoStyle = {
      position: 'absolute',
      width:     videoW,
      height:    videoH,
      // Center within the CROP_W-wide container + pan offset
      left: CROP_W / 2 - videoW / 2 + verticalOffsetX * displayScale,
      top:  (STAGE_H - videoH) / 2   + verticalOffsetY * displayScale,
      objectFit: 'fill',
    };
  }

  // The wrapper div is exactly this size in screen-space so the layout
  // footprint matches the visible area (CSS transform doesn't affect layout).
  const displayW = Math.round(stageW * scale);
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
           * Inner stage-container is positioned absolutely inside it at logical
           * stageW × STAGE_H, then CSS-scaled from the top-left corner.
           */
          <div
            className="stage-frame"
            style={{ width: displayW, height: displayH }}
          >
            <div
              className="stage-container"
              style={{
                width:     stageW,
                height:    STAGE_H,
                transform: `scale(${scale})`,
              }}
              onClick={handleStageClick}
            >
              <video
                ref={videoRef}
                className="stage-video"
                style={cropVideoStyle}
                src={convertFileSrc(videoPath)}
                controls={false}
                onTimeUpdate={handleTimeUpdate}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                onClick={togglePlay}
              />

              {/*
               * Widget overlay.
               * In crop mode the overlay is shifted left by CROP_OFFSET_X so
               * that widget positions stored in 1920×1080 space appear at the
               * correct location within the 9:16 strip.  Widgets outside the
               * strip are clipped by the container's overflow:hidden.
               */}
              <div
                className="stage-overlay"
                style={cropVertical ? {
                  position: 'absolute',
                  left:   -CROP_OFFSET_X,
                  top:    0,
                  right:  'auto',
                  bottom: 'auto',
                  width:  STAGE_W,
                  height: STAGE_H,
                } : {}}
              >
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
