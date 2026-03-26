import { WidgetDefinition, WidgetRenderContext } from '@velooverlay/widget-sdk';

export interface ElevationProfileConfig extends Record<string, unknown> {
  padding: number;
  /**
   * When true, the profile and bounding box are derived from the full activity
   * (ctx.route), even if the video only covers a portion of the ride.
   * When false (default), only the video-aligned route data is used.
   *
   * In the GUI, ctx.route always contains the full activity, so this option
   * is effectively always true. It is meaningful primarily for the CLI renderer.
   */
  fullTrack: boolean;
}

export const ElevationProfileWidget: WidgetDefinition<ElevationProfileConfig> = {
  id: 'builtin:elevation-profile',
  name: 'Elevation Profile',
  version: '1.0.0',
  defaultSize: { width: 400, height: 150 },

  getDefaultConfig: () => ({ padding: 12, fullTrack: false }),

  render(ctx: WidgetRenderContext, config: ElevationProfileConfig): void {
    const { canvas, frame, route, videoRoute, theme, width, height } = ctx;
    const c = canvas.getContext('2d')!;
    const pad = config.padding;

    // Background
    c.fillStyle = `rgba(0, 0, 0, ${theme.backgroundOpacity})`;
    c.fillRect(0, 0, width, height);

    const activeRoute = config.fullTrack ? route : (videoRoute ?? route);

    // Only use points that have altitude data
    const pts = activeRoute.points.filter(
      (p): p is { lat: number; lon: number; altitudeM: number; distanceM: number | null } => p.altitudeM !== null,
    );
    if (pts.length < 2) return;

    const altMin = pts.reduce((mn, p) => Math.min(mn, p.altitudeM), Infinity);
    const altMax = pts.reduce((mx, p) => Math.max(mx, p.altitudeM), -Infinity);
    const altSpan = altMax - altMin;
    if (altSpan < 0.1) return; // essentially flat — nothing meaningful to show

    const drawW = width - pad * 2;
    const drawH = height - pad * 2;
    const baselineY = height - pad;

    const projectX = (idx: number) => pad + (idx / (pts.length - 1)) * drawW;
    const projectY = (alt: number) => height - pad - ((alt - altMin) / altSpan) * drawH;

    // Find current position index by closest GPS match
    const currentIdx = findCurrentIndex(pts, frame.lat, frame.lon);

    // 1. Ghost: full elevation profile — filled area at low opacity
    drawFilledProfile(
      c,
      pts,
      0,
      pts.length - 1,
      projectX,
      projectY,
      baselineY,
      `${theme.primaryColor}28`, // ~16% opacity fill
      `${theme.primaryColor}50`, // ~31% opacity stroke
      1.5,
    );

    // 2. Progress: filled area from start to current position
    if (currentIdx > 0) {
      drawFilledProfile(
        c,
        pts,
        0,
        currentIdx,
        projectX,
        projectY,
        baselineY,
        `${theme.primaryColor}55`, // ~33% opacity fill
        theme.primaryColor,
        2,
      );
    }

    // 3. Current position: vertical marker line + dot on the profile
    const markerX = projectX(currentIdx);
    c.beginPath();
    c.moveTo(markerX, pad);
    c.lineTo(markerX, baselineY);
    c.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    c.lineWidth = 1.5;
    c.stroke();

    const markerY = projectY(pts[currentIdx].altitudeM);
    c.beginPath();
    c.arc(markerX, markerY, 4, 0, Math.PI * 2);
    c.fillStyle = '#FFFFFF';
    c.fill();
    c.strokeStyle = theme.primaryColor;
    c.lineWidth = 2;
    c.stroke();
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function drawFilledProfile(
  c: CanvasRenderingContext2D,
  pts: Array<{ altitudeM: number }>,
  fromIdx: number,
  toIdx: number,
  projectX: (i: number) => number,
  projectY: (alt: number) => number,
  baselineY: number,
  fillColor: string,
  strokeColor: string,
  strokeWidth: number,
): void {
  if (toIdx <= fromIdx) return;

  // Filled polygon: baseline → profile → back to baseline
  c.beginPath();
  c.moveTo(projectX(fromIdx), baselineY);
  for (let i = fromIdx; i <= toIdx; i++) {
    c.lineTo(projectX(i), projectY(pts[i].altitudeM));
  }
  c.lineTo(projectX(toIdx), baselineY);
  c.closePath();
  c.fillStyle = fillColor;
  c.fill();

  // Stroke just the top edge of the profile
  c.beginPath();
  for (let i = fromIdx; i <= toIdx; i++) {
    const x = projectX(i);
    const y = projectY(pts[i].altitudeM);
    i === fromIdx ? c.moveTo(x, y) : c.lineTo(x, y);
  }
  c.strokeStyle = strokeColor;
  c.lineWidth = strokeWidth;
  c.stroke();
}

/** Return the index in pts closest to the current GPS position. */
function findCurrentIndex(
  pts: Array<{ lat: number; lon: number }>,
  currentLat: number | null,
  currentLon: number | null,
): number {
  if (currentLat === null || currentLon === null) return 0;

  let closest = 0;
  let minDist = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const dlat = pts[i].lat - currentLat;
    const dlon = pts[i].lon - currentLon;
    const dist = dlat * dlat + dlon * dlon;
    if (dist < minDist) {
      minDist = dist;
      closest = i;
    }
  }
  return closest;
}
