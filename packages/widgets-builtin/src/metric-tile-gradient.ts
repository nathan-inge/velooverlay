import { WidgetDefinition, WidgetRenderContext } from '@velooverlay/widget-sdk';

export interface GradientConfig extends Record<string, unknown> {
  /**
   * Minimum horizontal distance (metres) to average gradient over.
   * The window expands beyond this if fewer than MIN_POINTS samples are
   * available, so the regression stays stable at high speed.
   */
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
        : computeGradient(route.points, frame, config.windowM);

    const valueStr = pct !== null ? formatPct(pct) : '--';
    const unitStr = '%';
    const gap = height * 0.04;

    const valueFontSize = height * 0.50;
    const unitFontSize = height * 0.28;

    c.textBaseline = 'middle';
    c.textAlign = 'left';

    c.font = `bold ${valueFontSize}px ${theme.fontFamily}`;
    const valueWidth = c.measureText(valueStr).width;

    c.font = `${unitFontSize}px ${theme.fontFamily}`;
    const unitWidth = c.measureText(unitStr).width;

    const startX = (width - valueWidth - gap - unitWidth) / 2;
    const midY = height / 2;

    c.font = `bold ${valueFontSize}px ${theme.fontFamily}`;
    c.fillStyle = pct !== null ? theme.primaryColor : 'rgba(255,255,255,0.3)';
    c.fillText(valueStr, startX, midY);

    c.font = `${unitFontSize}px ${theme.fontFamily}`;
    c.fillStyle = theme.primaryColor;
    c.fillText(unitStr, startX + valueWidth + gap, midY);
  },
};

function formatPct(pct: number): string {
  const abs = Math.abs(pct);
  if (abs < 0.1) return '0.0';
  return (pct > 0 ? '+' : '') + pct.toFixed(1);
}

/**
 * Compute gradient (%) using least-squares linear regression.
 *
 * The window is anchored to `frame.distanceM` (continuously interpolated by
 * the pipeline) rather than to the nearest raw GPS sample. This means the
 * window tip slides forward smoothly at every video frame instead of jumping
 * discretely when the closest GPS point changes — eliminating the main source
 * of sign oscillation.
 *
 * `frame.altitudeM` (also interpolated) is used as the current-position
 * endpoint, so a single noisy GPS altitude sample can never flip the sign by
 * itself. Historical route-point altitudes are box-filtered before regression
 * for additional noise rejection.
 *
 * Falls back to GPS proximity matching for files that lack distanceM.
 */
function computeGradient(
  points: Array<{ lat: number; lon: number; altitudeM: number | null; distanceM: number | null }>,
  frame: { lat: number | null; lon: number | null; altitudeM: number | null; distanceM: number | null },
  windowM: number,
): number | null {
  if (frame.distanceM !== null && frame.altitudeM !== null) {
    return computeByDistance(points, frame.distanceM, frame.altitudeM, windowM);
  }
  if (frame.lat !== null && frame.lon !== null) {
    return computeByGps(points, frame.lat, frame.lon, windowM);
  }
  return null;
}

/**
 * Distance-based gradient: anchor the window to the frame's cumulative
 * distance so it advances continuously rather than in GPS-sample jumps.
 */
function computeByDistance(
  points: Array<{ altitudeM: number | null; distanceM: number | null }>,
  currentDistM: number,
  currentAltM: number,
  windowM: number,
): number | null {
  const MIN_POINTS = 20;

  // Collect route points strictly before the current position that have both fields.
  const before = points
    .filter((p): p is { altitudeM: number; distanceM: number } =>
      p.distanceM !== null && p.altitudeM !== null && p.distanceM < currentDistM,
    )
    .sort((a, b) => a.distanceM - b.distanceM);

  if (before.length === 0) return null;

  // Walk back from the most-recent point until both the distance threshold
  // AND the minimum point count are satisfied.
  let startIdx = before.length - 1;
  while (startIdx > 0) {
    const covered = currentDistM - before[startIdx].distanceM;
    const count = before.length - startIdx + 1; // +1 for current frame
    if (covered >= windowM && count >= MIN_POINTS) break;
    startIdx--;
  }

  const window = before.slice(startIdx);
  const span = currentDistM - window[0].distanceM;
  if (window.length < 4 || span < 10) return null;

  // xs: distance from window start. Current frame is the final point.
  const startDist = window[0].distanceM;
  const xs = [...window.map((p) => p.distanceM - startDist), currentDistM - startDist];
  const rawYs = [...window.map((p) => p.altitudeM), currentAltM];
  const ys = boxFilter(rawYs, 5);

  return lsSlope(xs, ys) * 100;
}

/**
 * GPS-proximity fallback for files without distanceM.
 * Matches the nearest route point, then walks backwards collecting samples.
 */
function computeByGps(
  points: Array<{ lat: number; lon: number; altitudeM: number | null; distanceM: number | null }>,
  currentLat: number,
  currentLon: number,
  windowM: number,
): number | null {
  const valid = points.filter(
    (p): p is { lat: number; lon: number; altitudeM: number; distanceM: number | null } =>
      p.altitudeM !== null,
  );
  if (valid.length < 2) return null;

  const cosLat = Math.cos((currentLat * Math.PI) / 180);
  let closestIdx = 0;
  let minSq = Infinity;
  for (let i = 0; i < valid.length; i++) {
    const dlat = (valid[i].lat - currentLat) * 111320;
    const dlon = (valid[i].lon - currentLon) * 111320 * cosLat;
    const sq = dlat * dlat + dlon * dlon;
    if (sq < minSq) { minSq = sq; closestIdx = i; }
  }

  const MIN_POINTS = 20;
  const indices: number[] = [closestIdx];
  let cumDist = 0;
  for (let i = closestIdx - 1; i >= 0; i--) {
    cumDist += approxDistM(valid[i], valid[i + 1]);
    indices.unshift(i);
    if (cumDist >= windowM && indices.length >= MIN_POINTS) break;
  }
  if (indices.length < 4 || cumDist < 10) return null;

  const rawAlt = indices.map((idx) => valid[idx].altitudeM);
  const ys = boxFilter(rawAlt, 5);
  let d = 0;
  const xs: number[] = [0];
  for (let i = 1; i < indices.length; i++) {
    d += approxDistM(valid[indices[i - 1]], valid[indices[i]]);
    xs.push(d);
  }

  return lsSlope(xs, ys) * 100;
}

/** Least-squares slope: (n·Σxy − Σx·Σy) / (n·Σx² − (Σx)²) */
function lsSlope(xs: number[], ys: number[]): number {
  const n = xs.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX  += xs[i];
    sumY  += ys[i];
    sumXY += xs[i] * ys[i];
    sumX2 += xs[i] * xs[i];
  }
  const denom = n * sumX2 - sumX * sumX;
  return Math.abs(denom) < 1e-9 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

/** Simple box (moving-average) filter over an array of numbers. */
function boxFilter(arr: number[], k: number): number[] {
  const half = Math.floor(k / 2);
  return arr.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(arr.length - 1, i + half);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += arr[j];
    return sum / (hi - lo + 1);
  });
}

/** Flat-earth distance approximation — fallback when distanceM is absent. */
function approxDistM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dlat = (b.lat - a.lat) * 111320;
  const dlon = (b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dlat * dlat + dlon * dlon);
}
