import { useRef, useState, useEffect } from 'react';
import { useStore } from '../store/useStore';

const PREVIEW_W = 80;
const PREVIEW_H = 142;

export default function FramingEditor() {
  const verticalZoom    = useStore((s) => s.verticalZoom);
  const verticalOffsetX = useStore((s) => s.verticalOffsetX);
  const verticalOffsetY = useStore((s) => s.verticalOffsetY);
  const setVerticalZoom    = useStore((s) => s.setVerticalZoom);
  const setVerticalOffsetX = useStore((s) => s.setVerticalOffsetX);
  const setVerticalOffsetY = useStore((s) => s.setVerticalOffsetY);
  const isExporting = useStore((s) => s.isExporting);
  const meta = useStore((s) => s.videoMetadata);

  const srcW = meta?.width  ?? 1920;
  const srcH = meta?.height ?? 1080;

  // Dimensions of the source rect in preview pixels
  const rectH = PREVIEW_H * verticalZoom;
  const rectW = rectH * (srcW / srcH);

  // Pan in preview pixels
  const panXPrev = verticalOffsetX * (PREVIEW_H / srcH);
  const panYPrev = verticalOffsetY * (PREVIEW_H / srcH);

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
      setVerticalOffsetX(dragRef.current.startOffX + dx * (srcH / PREVIEW_H));
      setVerticalOffsetY(dragRef.current.startOffY + dy * (srcH / PREVIEW_H));
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
  }, [srcH, setVerticalOffsetX, setVerticalOffsetY]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isExporting) return;
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOffX: verticalOffsetX,
      startOffY: verticalOffsetY,
    };
    setIsDragging(true);
  };

  const reset = () => {
    setVerticalZoom(1.0);
    setVerticalOffsetX(0);
    setVerticalOffsetY(0);
  };

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

      {/* Zoom slider */}
      <div className="inspector-field">
        <div className="inspector-field-label">Zoom</div>
        <div className="range-field">
          <input
            type="range"
            min={0.2}
            max={3.0}
            step={0.01}
            value={verticalZoom}
            disabled={isExporting}
            onChange={(e) => setVerticalZoom(Number(e.target.value))}
          />
          <span className="range-readout">{verticalZoom.toFixed(2)}×</span>
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
