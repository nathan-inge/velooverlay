import { useEffect, useRef, useCallback } from 'react';
import type { RouteData, WidgetRenderContext, Theme } from '@velooverlay/widget-sdk';
import type { TelemetryFrameDto, WidgetInstance, RouteDataDto } from '../../types';
import { findFrameAtTime } from '../../hooks/useTelemetryAtTime';
import { useStore } from '../../store/useStore';
import { WIDGET_REGISTRY } from '../../export/widgetRegistry';

const SNAP = 10;
function snap(v: number) {
  return Math.round(v / SNAP) * SNAP;
}

function toRouteData(dto: RouteDataDto | null): RouteData {
  if (!dto || dto.points.length === 0) {
    return { points: [], bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 } };
  }
  return {
    points: dto.points.map((p) => ({ lat: p.lat, lon: p.lon, altitudeM: p.altitudeM, distanceM: p.distanceM })),
    bounds: dto.bounds,
  };
}

function framesToVideoRoute(frames: TelemetryFrameDto[]): RouteData {
  const pts = frames
    .filter((f) => f.lat !== null && f.lon !== null)
    .map((f) => ({ lat: f.lat!, lon: f.lon!, altitudeM: f.altitudeM, distanceM: f.distanceM }));
  if (pts.length === 0) {
    return { points: [], bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 } };
  }
  const lats = pts.map((p) => p.lat);
  const lons = pts.map((p) => p.lon);
  return {
    points: pts,
    bounds: {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons),
    },
  };
}

function toSdkFrame(dto: TelemetryFrameDto | null): import('@velooverlay/widget-sdk').TelemetryFrame {
  if (!dto) {
    return {
      frameIndex: 0, videoTimeMs: 0,
      speedMs: null, heartRate: null, cadence: null, power: null,
      lat: null, lon: null, altitudeM: null, distanceM: null,
      signalStatus: 'lost',
    };
  }
  return {
    frameIndex: dto.frameIndex,
    videoTimeMs: dto.videoTimeMs,
    speedMs: dto.speedMs,
    heartRate: dto.heartRate,
    cadence: dto.cadence,
    power: dto.power,
    lat: dto.lat,
    lon: dto.lon,
    altitudeM: dto.altitudeM,
    distanceM: dto.distanceM,
    signalStatus: dto.signalStatus,
  };
}

interface Props {
  instance: WidgetInstance;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isSelected: boolean;
  /** The CSS scale factor applied to the stage — used to correct mouse coordinates. */
  scale: number;
}

export default function WidgetCanvas({ instance, videoRef, isSelected, scale }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

  const { frames, route, layout, updateWidgetPosition, updateWidgetSize, selectWidget } = useStore();

  const widget = WIDGET_REGISTRY[instance.type];
  const sdkRoute = toRouteData(route);
  const sdkVideoRoute = framesToVideoRoute(frames);
  const sdkTheme: Theme = {
    fontFamily: layout.theme.fontFamily,
    primaryColor: layout.theme.primaryColor,
    backgroundOpacity: layout.theme.backgroundOpacity,
  };

  // ── Render loop ─────────────────────────────────────────────────
  useEffect(() => {
    if (!widget) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const loop = () => {
      const video = videoRef.current;
      const videoTimeMs = video ? video.currentTime * 1000 : 0;
      const frameDto = findFrameAtTime(frames, videoTimeMs);
      const sdkFrame = toSdkFrame(frameDto);

      const ctx2d = canvas.getContext('2d');
      ctx2d?.clearRect(0, 0, canvas.width, canvas.height);

      const renderCtx: WidgetRenderContext = {
        frame: sdkFrame,
        route: sdkRoute,
        videoRoute: sdkVideoRoute,
        canvas,
        theme: sdkTheme,
        width: instance.size.width,
        height: instance.size.height,
      };

      try {
        widget.render(renderCtx, instance.config);
      } catch (err) {
        const c = canvas.getContext('2d');
        if (c) {
          c.fillStyle = 'rgba(255,0,0,0.4)';
          c.fillRect(0, 0, canvas.width, canvas.height);
        }
        console.error('Widget render error:', err);
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget, frames, route, layout.theme, instance.config, instance.size]);

  // ── Drag (move) ──────────────────────────────────────────────────
  // Mouse coordinates are in screen pixels; divide by `scale` to convert
  // to logical 1920×1080 stage coordinates.
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).classList.contains('widget-resize-handle')) return;
      e.stopPropagation();
      selectWidget(instance.id);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: instance.position.x,
        origY: instance.position.y,
      };

      const onMove = (me: MouseEvent) => {
        if (!dragRef.current) return;
        const dx = (me.clientX - dragRef.current.startX) / scale;
        const dy = (me.clientY - dragRef.current.startY) / scale;
        const x = snap(Math.max(0, dragRef.current.origX + dx));
        const y = snap(Math.max(0, dragRef.current.origY + dy));
        updateWidgetPosition(instance.id, x, y);
      };

      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [instance.id, instance.position.x, instance.position.y, scale, selectWidget, updateWidgetPosition],
  );

  // ── Resize (SE corner handle) ────────────────────────────────────
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origW: instance.size.width,
        origH: instance.size.height,
      };

      const onMove = (me: MouseEvent) => {
        if (!resizeRef.current) return;
        const dw = (me.clientX - resizeRef.current.startX) / scale;
        const dh = (me.clientY - resizeRef.current.startY) / scale;
        const w = snap(Math.max(60, resizeRef.current.origW + dw));
        const h = snap(Math.max(40, resizeRef.current.origH + dh));
        updateWidgetSize(instance.id, w, h);
      };

      const onUp = () => {
        resizeRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [instance.id, instance.size.width, instance.size.height, scale, updateWidgetSize],
  );

  if (!widget) {
    return (
      <div
        style={{
          position: 'absolute',
          left: instance.position.x,
          top: instance.position.y,
          width: instance.size.width,
          height: instance.size.height,
          background: 'rgba(255,0,0,0.3)',
          border: '1px dashed red',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          color: 'red',
        }}
      >
        Unknown: {instance.type}
      </div>
    );
  }

  return (
    <div
      className={`widget-wrapper${isSelected ? ' selected' : ''}`}
      style={{
        left: instance.position.x,
        top: instance.position.y,
        width: instance.size.width,
        height: instance.size.height,
      }}
      onMouseDown={handleMouseDown}
    >
      <canvas
        ref={canvasRef}
        width={instance.size.width}
        height={instance.size.height}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
      {isSelected && (
        <div className="widget-resize-handle se" onMouseDown={handleResizeMouseDown} />
      )}
    </div>
  );
}
