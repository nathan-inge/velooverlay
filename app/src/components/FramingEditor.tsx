import { useRef, useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { cropStripWidth, parseCropAspect } from '../cropAspect';

// Preview thumbnail size — short edge fixed at 80 px.
const PREVIEW_SHORT = 80;

export default function FramingEditor() {
  const cropAspect    = useStore((s) => s.cropAspect);
  const cropZoom      = useStore((s) => s.cropZoom);
  const cropOffsetX   = useStore((s) => s.cropOffsetX);
  const cropOffsetY   = useStore((s) => s.cropOffsetY);
  const setCropZoom    = useStore((s) => s.setCropZoom);
  const setCropOffsetX = useStore((s) => s.setCropOffsetX);
  const setCropOffsetY = useStore((s) => s.setCropOffsetY);
  const isExporting   = useStore((s) => s.isExporting);
  const meta          = useStore((s) => s.videoMetadata);

  const srcW = meta?.width  ?? 1920;
  const srcH = meta?.height ?? 1080;

  // Preview container dimensions — match the crop aspect ratio.
  const { arW, arH } = parseCropAspect(cropAspect);
  // Short edge = PREVIEW_SHORT; orient to the crop's portrait vs landscape.
  const isPortrait = arH > arW;
  const PREVIEW_W  = isPortrait ? PREVIEW_SHORT : Math.round(PREVIEW_SHORT * arW / arH);
  const PREVIEW_H  = isPortrait ? Math.round(PREVIEW_SHORT * arH / arW) : PREVIEW_SHORT;

  // Source rect size in preview pixels (represents the source video frame)
  const rectH = PREVIEW_H * cropZoom;
  const rectW = rectH * (srcW / srcH);

  // Pan in preview pixels
  const panXPrev = cropOffsetX * (PREVIEW_H / srcH);
  const panYPrev = cropOffsetY * (PREVIEW_H / srcH);

  // Top-left corner of the source rect inside the preview container
  const rectLeft = PREVIEW_W / 2 + panXPrev - rectW / 2;
  const rectTop  = PREVIEW_H / 2 + panYPrev - rectH / 2;

  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startOffX: number;
    startOffY: number;
  } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setCropOffsetX(dragRef.current.startOffX + dx * (srcH / PREVIEW_H));
      setCropOffsetY(dragRef.current.startOffY + dy * (srcH / PREVIEW_H));
    };
    const onUp = () => {
      dragRef.current = null;
      setIsDragging(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [srcH, PREVIEW_H, setCropOffsetX, setCropOffsetY]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isExporting) return;
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOffX: cropOffsetX,
      startOffY: cropOffsetY,
    };
    setIsDragging(true);
  };

  const reset = () => {
    setCropZoom(1.0);
    setCropOffsetX(0);
    setCropOffsetY(0);
  };

  // Strip width label for display
  const stripW = cropStripWidth(cropAspect);
  const label = cropAspect
    ? `${stripW} × 1080 px strip`
    : '';

  return (
    <div className="inspector-fields">
      {/* Visual preview */}
      <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 4 }}>
        <div
          style={{
            width: PREVIEW_W,
            height: PREVIEW_H,
            overflow: 'hidden',
            background: '#000',
            position: 'relative',
            cursor: isExporting ? 'default' : isDragging ? 'grabbing' : 'grab',
            border: '1px solid var(--border)',
            flexShrink: 0,
          }}
          onMouseDown={handleMouseDown}
        >
          <div
            style={{
              position: 'absolute',
              left: rectLeft,
              top: rectTop,
              width: rectW,
              height: rectH,
              border: '2px solid #3b82f6',
              boxSizing: 'border-box',
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>

      {label && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 4 }}>
          {label}
        </div>
      )}

      {/* Zoom slider */}
      <div className="inspector-field">
        <div className="inspector-field-label">Zoom</div>
        <div className="range-field">
          <input
            type="range"
            min={0.2}
            max={3.0}
            step={0.01}
            value={cropZoom}
            disabled={isExporting}
            onChange={(e) => setCropZoom(Number(e.target.value))}
          />
          <span className="range-readout">{cropZoom.toFixed(2)}×</span>
        </div>
      </div>

      {/* Reset */}
      <div className="inspector-field">
        <button
          className="inspector-input"
          style={{ cursor: isExporting ? 'default' : 'pointer' }}
          disabled={isExporting}
          onClick={reset}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
