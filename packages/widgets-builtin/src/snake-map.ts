import { WidgetDefinition, WidgetRenderContext } from '@velooverlay/widget-sdk';

export interface SnakeMapConfig extends Record<string, unknown> {
  padding: number; // pixels of padding inside the widget
  /**
   * When true, the ghost route and bounding box are derived from the full
   * activity (ctx.route), even if the video only covers a portion of the ride.
   * When false (default), only the video-aligned route data is used.
   *
   * In the GUI, ctx.route always contains the full activity, so this option
   * is effectively always true. It is meaningful primarily for the CLI renderer,
   * which must be explicitly provided with the full-activity GPS track.
   */
  fullTrack: boolean;
}

export const SnakeMapWidget: WidgetDefinition<SnakeMapConfig> = {
  id: 'builtin:snake-map',
  name: 'Snake Map',
  version: '1.0.0',
  defaultSize: { width: 300, height: 300 },

  getDefaultConfig: () => ({ padding: 12, fullTrack: false }),

  render(ctx: WidgetRenderContext, config: SnakeMapConfig): void {
    const { canvas, frame, route, videoRoute, theme, width, height } = ctx;
    const c = canvas.getContext('2d')!;
    const pad = config.padding;

    // Background
    c.fillStyle = `rgba(0, 0, 0, ${theme.backgroundOpacity})`;
    c.fillRect(0, 0, width, height);

    // When fullTrack is false, constrain the map to the video-aligned extent.
    const activeRoute = config.fullTrack ? route : (videoRoute ?? route);

    if (activeRoute.points.length < 2) return;

    const { minLat, maxLat, minLon, maxLon } = activeRoute.bounds;
    const drawW = width - pad * 2;
    const drawH = height - pad * 2;

    // Maintain aspect ratio: find the scale that fits both dimensions.
    const scaleX = drawW / (maxLon - minLon);
    const scaleY = drawH / (maxLat - minLat);
    const scale = Math.min(scaleX, scaleY);

    // Centre the route within the padded area.
    const offsetX = pad + (drawW - (maxLon - minLon) * scale) / 2;
    const offsetY = pad + (drawH - (maxLat - minLat) * scale) / 2;

    const project = (lat: number, lon: number): [number, number] => [
      offsetX + (lon - minLon) * scale,
      height - offsetY - (lat - minLat) * scale, // invert Y axis
    ];

    // Find the current frame's closest route index.
    const currentIdx = findCurrentRouteIndex(activeRoute.points, frame.lat, frame.lon);

    const traceFull = () => {
      c.beginPath();
      activeRoute.points.forEach(({ lat, lon }, i) => {
        const [x, y] = project(lat, lon);
        i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      });
    };

    const traceRidden = () => {
      c.beginPath();
      activeRoute.points.slice(0, currentIdx + 1).forEach(({ lat, lon }, i) => {
        const [x, y] = project(lat, lon);
        i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      });
    };

    // 1. Ghost line — full route: dark halo then faint color on top.
    c.lineJoin = 'round';
    c.lineCap = 'round';
    traceFull();
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.lineWidth = 4;
    c.stroke();
    traceFull();
    c.strokeStyle = `${theme.primaryColor}50`;
    c.lineWidth = 2;
    c.stroke();

    // 2. Ridden portion — dark halo then solid color on top.
    if (currentIdx > 0) {
      traceRidden();
      c.strokeStyle = 'rgba(0,0,0,0.7)';
      c.lineWidth = 4.5;
      c.stroke();
      traceRidden();
      c.strokeStyle = theme.primaryColor;
      c.lineWidth = 2.5;
      c.stroke();
    }

    // 3. Head marker — dark halo ring then white fill.
    if (frame.lat !== null && frame.lon !== null) {
      const [hx, hy] = project(frame.lat, frame.lon);
      c.beginPath();
      c.arc(hx, hy, 6, 0, Math.PI * 2);
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fill();
      c.beginPath();
      c.arc(hx, hy, 5, 0, Math.PI * 2);
      c.fillStyle = '#FFFFFF';
      c.fill();
      c.strokeStyle = theme.primaryColor;
      c.lineWidth = 2;
      c.stroke();
    }
  },
};

/** Find the route point index closest to the current GPS position. */
function findCurrentRouteIndex(
  points: Array<{ lat: number; lon: number }>,
  currentLat: number | null,
  currentLon: number | null,
): number {
  if (currentLat === null || currentLon === null) return 0;

  let closest = 0;
  let minDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dlat = points[i].lat - currentLat;
    const dlon = points[i].lon - currentLon;
    const dist = dlat * dlat + dlon * dlon; // squared distance, no sqrt needed for comparison
    if (dist < minDist) {
      minDist = dist;
      closest = i;
    }
  }
  return closest;
}
