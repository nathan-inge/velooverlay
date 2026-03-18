import { WidgetDefinition, WidgetRenderContext } from '@velooverlay/widget-sdk';

export interface GradientConfig extends Record<string, unknown> {
  /** Horizontal distance (metres) to average gradient over. */
  windowM: number;
}

export const GradientWidget: WidgetDefinition<GradientConfig> = {
  id: 'builtin:gradient',
  name: 'Gradient',
  version: '1.0.0',
  defaultSize: { width: 120, height: 70 },

  getDefaultConfig: () => ({ windowM: 100 }),

  render(ctx: WidgetRenderContext, config: GradientConfig): void {
    const { canvas, frame, route, theme, width, height } = ctx;
    const c = canvas.getContext('2d')!;

    c.fillStyle = `rgba(0, 0, 0, ${theme.backgroundOpacity})`;
    c.fillRect(0, 0, width, height);

    c.shadowColor = 'rgba(0,0,0,0.9)';
    c.shadowBlur = 6;

    const pct =
      frame.signalStatus === 'lost'
        ? null
        : computeGradient(route.points, frame.lat, frame.lon, config.windowM);

    // Label
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.font = `${height * 0.18}px ${theme.fontFamily}`;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillText('GRADIENT', width / 2, height * 0.08);

    // Value — slightly smaller font than other tiles to fit sign + decimal
    const valueStr = pct !== null ? formatPct(pct) : '--';
    c.fillStyle = pct !== null ? theme.primaryColor : 'rgba(255,255,255,0.3)';
    c.font = `bold ${height * 0.38}px ${theme.fontFamily}`;
    c.textBaseline = 'middle';
    c.fillText(valueStr, width / 2, height * 0.55);

    // Unit
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.font = `${height * 0.16}px ${theme.fontFamily}`;
    c.textBaseline = 'bottom';
    c.fillText('%', width / 2, height * 0.97);
  },
};

function formatPct(pct: number): string {
  const abs = Math.abs(pct);
  if (abs < 0.1) return '0.0';
  return (pct > 0 ? '+' : '') + pct.toFixed(1);
}

/**
 * Compute gradient (%) using least-squares linear regression over all route
 * points within `windowM` horizontal metres behind the current position.
 * Regression uses every point's altitude rather than just the endpoints, so
 * individual noisy GPS altitude samples don't flip the sign.
 */
function computeGradient(
  points: Array<{ lat: number; lon: number; altitudeM: number | null }>,
  currentLat: number | null,
  currentLon: number | null,
  windowM: number,
): number | null {
  if (currentLat === null || currentLon === null) return null;

  // Only work with points that have altitude data.
  const valid = points.filter(
    (p): p is { lat: number; lon: number; altitudeM: number } => p.altitudeM !== null,
  );
  if (valid.length < 2) return null;

  // Find the index closest to the current GPS position.
  const cosLat = Math.cos((currentLat * Math.PI) / 180);
  let closestIdx = 0;
  let minSq = Infinity;
  for (let i = 0; i < valid.length; i++) {
    const dlat = (valid[i].lat - currentLat) * 111320;
    const dlon = (valid[i].lon - currentLon) * 111320 * cosLat;
    const sq = dlat * dlat + dlon * dlon;
    if (sq < minSq) {
      minSq = sq;
      closestIdx = i;
    }
  }

  // Collect points within the window, building cumulative distance from the
  // start of the window (x) paired with altitude (y).
  const xs: number[] = [];
  const ys: number[] = [];
  let cumDist = 0;

  xs.push(0);
  ys.push(valid[closestIdx].altitudeM);

  for (let i = closestIdx - 1; i >= 0; i--) {
    cumDist += approxDistM(valid[i], valid[i + 1]);
    if (cumDist > windowM) break;
    // Prepend so xs stays ascending.
    xs.unshift(cumDist);
    ys.unshift(valid[i].altitudeM);
  }

  // Need at least 10 m span and 3 points for a meaningful regression.
  if (xs.length < 3 || cumDist < 10) return null;

  // Least-squares slope: slope = (n·Σxy - Σx·Σy) / (n·Σx² - (Σx)²)
  // x = cumulative distance from window start, y = altitude
  const n = xs.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX  += xs[i];
    sumY  += ys[i];
    sumXY += xs[i] * ys[i];
    sumX2 += xs[i] * xs[i];
  }
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-9) return null;

  const slope = (n * sumXY - sumX * sumY) / denom; // m altitude per m distance
  return slope * 100; // convert to %
}

/** Flat-earth approximation — accurate to <0.5 % for distances under 1 km. */
function approxDistM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dlat = (b.lat - a.lat) * 111320;
  const dlon = (b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dlat * dlat + dlon * dlon);
}
