import type { WidgetDefinition, WidgetRenderContext } from '@velooverlay/widget-sdk';

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface PowerZone extends Record<string, unknown> {
  /** Upper bound of this zone in Watts. The last zone extends to maxPower. */
  upToWatts: number;
  /** CSS hex color, e.g. '#40c97a'. */
  color: string;
}

export interface PowerMeterConfig extends Record<string, unknown> {
  /** Maximum power shown on the bar scale (Watts). */
  maxPower: number;
  /** Ordered list of power zones (low → high). */
  zones: PowerZone[];
}

// Default cycling power zones (rough FTP% reference, 600 W scale)
const DEFAULT_ZONES: PowerZone[] = [
  { upToWatts: 150, color: '#888899' }, // Z1 – Active Recovery
  { upToWatts: 220, color: '#4a9eff' }, // Z2 – Endurance
  { upToWatts: 290, color: '#40c97a' }, // Z3 – Tempo
  { upToWatts: 360, color: '#ffd93d' }, // Z4 – Threshold
  { upToWatts: 440, color: '#ff9944' }, // Z5 – VO2 Max
  { upToWatts: 600, color: '#ff4444' }, // Z6 – Anaerobic
];

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export const PowerMeterBarWidget: WidgetDefinition<PowerMeterConfig> = {
  id: 'builtin:power-meter',
  name: 'Power Meter',
  version: '1.0.0',
  defaultSize: { width: 380, height: 80 },

  getDefaultConfig: () => ({
    maxPower: 600,
    zones: DEFAULT_ZONES,
  }),

  render(ctx: WidgetRenderContext, config: PowerMeterConfig): void {
    const { canvas, frame, theme, width, height } = ctx;
    const c = canvas.getContext('2d')!;

    const rawZones = config.zones;
    const zones: PowerZone[] = (Array.isArray(rawZones) && rawZones.length > 0)
      ? [...rawZones as PowerZone[]].sort((a, b) => a.upToWatts - b.upToWatts)
      : DEFAULT_ZONES;
    const maxPower: number =
      typeof config.maxPower === 'number' && config.maxPower > 0 ? config.maxPower : 600;

    // ── Background ────────────────────────────────────────────
    c.fillStyle = `rgba(0,0,0,${theme.backgroundOpacity})`;
    c.fillRect(0, 0, width, height);

    const padX = 10;
    const padTop = 7;
    const padBot = 7;
    const topH = Math.round(height * 0.42);
    const barY = padTop + topH + 3;
    const barH = height - barY - padBot;
    const barX = padX;
    const barW = width - padX * 2;

    const power =
      frame.signalStatus === 'lost' || frame.power === null
        ? null
        : Math.max(0, frame.power);
    const powerFrac = power !== null ? Math.min(power / maxPower, 1.0) : 0;

    // ── Header row ────────────────────────────────────────────
    const midY = padTop + topH / 2;
    c.shadowColor = 'rgba(0,0,0,0.8)';
    c.shadowBlur = 4;
    c.textBaseline = 'middle';
    c.font = `bold ${Math.round(height * 0.3)}px ${theme.fontFamily}`;
    c.textAlign = 'right';
    c.fillStyle = power !== null ? '#ffffff' : 'rgba(255,255,255,0.3)';
    c.fillText(power !== null ? `${Math.round(power)} W` : '— W', width - padX, midY);
    c.shadowBlur = 0;

    // ── Zone bar ──────────────────────────────────────────────
    const r = Math.min(3, barH / 2);

    c.save();
    roundedRectPath(c, barX, barY, barW, barH, r);
    c.clip();

    // 1. Empty track — just barely visible so the bar extent is clear
    c.fillStyle = 'rgba(255,255,255,0.07)';
    c.fillRect(barX, barY, barW, barH);

    // 2. Filled portion — solid color of the current zone
    if (power !== null && powerFrac > 0) {
      const fillColor = getZoneColor(power, zones, maxPower);
      c.fillStyle = fillColor;
      c.fillRect(barX, barY, powerFrac * barW, barH);

      // Fade the left edge dark so the bar reads as "building up" toward the right
      const fade = c.createLinearGradient(barX, 0, barX + powerFrac * barW, 0);
      fade.addColorStop(0, 'rgba(0,0,0,0.45)');
      fade.addColorStop(0.35, 'rgba(0,0,0,0)');
      c.fillStyle = fade;
      c.fillRect(barX, barY, powerFrac * barW, barH);
    }

    // 3. Sheen — top highlight + bottom shadow for depth
    const sheen = c.createLinearGradient(0, barY, 0, barY + barH);
    sheen.addColorStop(0, 'rgba(255,255,255,0.14)');
    sheen.addColorStop(0.45, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.12)');
    c.fillStyle = sheen;
    c.fillRect(barX, barY, barW, barH);

    // 4. Marker line at current power position
    if (power !== null && powerFrac > 0.005 && powerFrac < 0.998) {
      const markerX = barX + powerFrac * barW;
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.fillRect(markerX - 1.5, barY, 3, barH);
    }

    c.restore();

    // Outer border
    roundedRectPath(c, barX, barY, barW, barH, r);
    c.strokeStyle = 'rgba(255,255,255,0.12)';
    c.lineWidth = 1;
    c.stroke();
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the smoothly-interpolated zone color for a given power value.
 *
 * Within each zone the color is pure. In a window of ±BLEND_W watts around
 * every zone boundary the color blends linearly into the adjacent zone, so
 * there are no harsh color jumps as power crosses a boundary.
 */
function getZoneColor(power: number, zones: PowerZone[], maxPower: number): string {
  if (zones.length === 0) return '#888888';
  if (zones.length === 1) return zones[0].color;

  const clamped = Math.min(power, maxPower);
  // Blend window: 30 W on each side of every boundary (60 W total transition).
  const BLEND_W = 30;

  for (let i = 0; i < zones.length; i++) {
    const zStart = i === 0 ? 0 : zones[i - 1].upToWatts;
    const zEnd = i === zones.length - 1 ? maxPower : zones[i].upToWatts;

    if (clamped < zEnd || i === zones.length - 1) {
      // Approaching upper boundary — blend into next zone
      if (i < zones.length - 1 && clamped > zEnd - BLEND_W) {
        const t = (clamped - (zEnd - BLEND_W)) / (BLEND_W * 2);
        return lerpColor(zones[i].color, zones[i + 1].color, Math.max(0, Math.min(1, t)));
      }
      // Just past lower boundary — blend from previous zone
      if (i > 0 && clamped < zStart + BLEND_W) {
        const t = (zStart + BLEND_W - clamped) / (BLEND_W * 2);
        return lerpColor(zones[i].color, zones[i - 1].color, Math.max(0, Math.min(1, t)));
      }
      return zones[i].color;
    }
  }

  return zones[zones.length - 1].color;
}

/** Linearly interpolate between two '#rrggbb' hex colors. */
function lerpColor(colorA: string, colorB: string, t: number): string {
  const ar = parseInt(colorA.slice(1, 3), 16);
  const ag = parseInt(colorA.slice(3, 5), 16);
  const ab = parseInt(colorA.slice(5, 7), 16);
  const br = parseInt(colorB.slice(1, 3), 16);
  const bg = parseInt(colorB.slice(3, 5), 16);
  const bb = parseInt(colorB.slice(5, 7), 16);
  if (isNaN(ar) || isNaN(br)) return colorA;
  return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`;
}

function roundedRectPath(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r);
  c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h);
  c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r);
  c.arcTo(x, y, x + r, y, r);
  c.closePath();
}
