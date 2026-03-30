import type { WidgetDefinition, WidgetRenderContext } from '@velooverlay/widget-sdk';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AnalogSpeedometerConfig extends Record<string, unknown> {
  unit: 'kph' | 'mph';
  /** Show the secondary unit as a smaller readout below the primary. */
  showBoth: boolean;
  /** Maximum speed on the dial scale (in the primary unit). */
  maxSpeed: number;
  /**
   * How many degrees of the circle the arc covers (60–350).
   * The arc is always symmetric about 12 o'clock.
   * Default: 220.
   */
  arcDegrees: number;
  /**
   * Dial radius as a percentage of half the smaller widget dimension (20–100).
   * 100 = the circle just touches the widget edge. Default: 92.
   */
  radiusScale: number;
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export const AnalogSpeedometerWidget: WidgetDefinition<AnalogSpeedometerConfig> = {
  id: 'builtin:analog-speedometer',
  name: 'Analog Speedometer',
  version: '1.0.0',
  defaultSize: { width: 220, height: 185 },

  getDefaultConfig: () => ({
    unit: 'kph',
    showBoth: false,
    maxSpeed: 60,
    arcDegrees: 220,
    radiusScale: 92,
  }),

  render(ctx: WidgetRenderContext, config: AnalogSpeedometerConfig): void {
    const { canvas, frame, theme, width, height } = ctx;
    const c = canvas.getContext('2d')!;

    const unit: 'kph' | 'mph' = config.unit === 'mph' ? 'mph' : 'kph';
    const showBoth = config.showBoth === true;
    const maxSpeed = typeof config.maxSpeed === 'number' && config.maxSpeed > 0
      ? config.maxSpeed : 60;

    const arcDeg = typeof config.arcDegrees === 'number' && config.arcDegrees > 0
      ? Math.max(60, Math.min(350, config.arcDegrees))
      : 220;
    const radScale = typeof config.radiusScale === 'number' && config.radiusScale > 0
      ? Math.max(20, Math.min(100, config.radiusScale)) / 100
      : 0.92;

    const CX = width / 2;
    const CY = height / 2;
    const R = Math.min(width, height) * 0.5 * radScale;

    // Arc is always symmetric about 12 o'clock (270° in canvas = pointing up).
    const START_ANGLE = ((270 - arcDeg / 2) / 180) * Math.PI;
    const TOTAL_SWEEP = (arcDeg / 180) * Math.PI;

    const hasSignal = frame.signalStatus !== 'lost' && frame.speedMs !== null;
    const speed = hasSignal
      ? frame.speedMs! * (unit === 'kph' ? 3.6 : 2.23694)
      : null;
    const speedFrac = speed !== null ? Math.min(speed / maxSpeed, 1.0) : 0;

    // ── Background circle ────────────────────────────────────
    // Only draw when backgroundOpacity > 0 — the radial gradient has non-zero
    // alpha stops that would leave a visible ring even at full transparency.
    if (theme.backgroundOpacity > 0) {
      c.beginPath();
      c.arc(CX, CY, R, 0, Math.PI * 2);
      c.fillStyle = `rgba(0,0,0,${theme.backgroundOpacity})`;
      c.fill();

      // Depth gradient — all stops scaled by backgroundOpacity so it fades cleanly.
      const innerGrad = c.createRadialGradient(CX, CY - R * 0.15, 0, CX, CY, R);
      innerGrad.addColorStop(0, `rgba(255,255,255,${0.04 * theme.backgroundOpacity})`);
      innerGrad.addColorStop(0.6, 'rgba(0,0,0,0)');
      innerGrad.addColorStop(1, `rgba(0,0,0,${0.22 * theme.backgroundOpacity})`);
      c.beginPath();
      c.arc(CX, CY, R, 0, Math.PI * 2);
      c.fillStyle = innerGrad;
      c.fill();
    }

    // ── Arc track ────────────────────────────────────────────
    const ARC_R = R * 0.76;
    const ARC_W = R * 0.13; // wide arc — outer edge at ~R*0.83

    // Background (full range, dim)
    c.beginPath();
    c.arc(CX, CY, ARC_R, START_ANGLE, START_ANGLE + TOTAL_SWEEP);
    c.strokeStyle = 'rgba(255,255,255,0.1)';
    c.lineWidth = ARC_W;
    c.lineCap = 'round';
    c.stroke();

    // Active portion (0 → current speed)
    if (hasSignal && speedFrac > 0) {
      c.beginPath();
      c.arc(CX, CY, ARC_R, START_ANGLE, START_ANGLE + speedFrac * TOTAL_SWEEP);
      c.strokeStyle = theme.primaryColor;
      c.lineWidth = ARC_W;
      c.lineCap = 'round';
      c.stroke();
    }

    // ── Tick marks and labels ────────────────────────────────
    // Ticks sit in the outer rim between the arc's outer edge (~R*0.83) and the bezel.
    const { major: majorInterval, minor: minorInterval } = tickIntervals(maxSpeed);
    const TICK_OUTER = R * 0.97;
    const MAJOR_INNER = R * 0.86;
    const MINOR_INNER = R * 0.91;
    const LABEL_R = R * 0.62;

    // Minor ticks
    for (let v = minorInterval; v < maxSpeed; v += minorInterval) {
      if (Math.round(v) % majorInterval === 0) continue; // majors drawn separately
      const angle = START_ANGLE + (v / maxSpeed) * TOTAL_SWEEP;
      c.beginPath();
      c.moveTo(CX + Math.cos(angle) * MINOR_INNER, CY + Math.sin(angle) * MINOR_INNER);
      c.lineTo(CX + Math.cos(angle) * TICK_OUTER, CY + Math.sin(angle) * TICK_OUTER);
      c.strokeStyle = 'rgba(255,255,255,0.28)';
      c.lineWidth = 1;
      c.lineCap = 'butt';
      c.stroke();
    }

    // Major ticks + labels
    c.font = `${Math.round(R * 0.13)}px ${theme.fontFamily}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let v = 0; v <= maxSpeed + 0.01; v += majorInterval) {
      const clamped = Math.min(v, maxSpeed);
      const angle = START_ANGLE + (clamped / maxSpeed) * TOTAL_SWEEP;
      c.beginPath();
      c.moveTo(CX + Math.cos(angle) * MAJOR_INNER, CY + Math.sin(angle) * MAJOR_INNER);
      c.lineTo(CX + Math.cos(angle) * TICK_OUTER, CY + Math.sin(angle) * TICK_OUTER);
      c.strokeStyle = 'rgba(255,255,255,0.65)';
      c.lineWidth = 1.5;
      c.lineCap = 'butt';
      c.stroke();

      c.fillStyle = 'rgba(255,255,255,0.65)';
      c.fillText(
        Math.round(clamped).toString(),
        CX + Math.cos(angle) * LABEL_R,
        CY + Math.sin(angle) * LABEL_R,
      );
    }

    // ── Needle ───────────────────────────────────────────────
    const needleAngle = hasSignal
      ? START_ANGLE + speedFrac * TOTAL_SWEEP
      : START_ANGLE; // rests at zero when no signal

    const needleLen = R * 0.70;
    const tailLen = R * 0.14;
    const baseHW = R * 0.030; // half-width at the hub
    const perp = needleAngle + Math.PI / 2;

    const tipX = CX + Math.cos(needleAngle) * needleLen;
    const tipY = CY + Math.sin(needleAngle) * needleLen;
    const tailX = CX - Math.cos(needleAngle) * tailLen;
    const tailY = CY - Math.sin(needleAngle) * tailLen;

    c.shadowColor = 'rgba(0,0,0,0.55)';
    c.shadowBlur = 6;

    // Main needle body — tapered triangle from hub to tip
    c.beginPath();
    c.moveTo(CX + Math.cos(perp) * baseHW, CY + Math.sin(perp) * baseHW);
    c.lineTo(tipX, tipY);
    c.lineTo(CX - Math.cos(perp) * baseHW, CY - Math.sin(perp) * baseHW);
    c.closePath();
    c.fillStyle = '#ffffff';
    c.fill();

    // Counterbalance tail — smaller triangle in the opposite direction
    c.beginPath();
    c.moveTo(CX + Math.cos(perp) * baseHW * 0.65, CY + Math.sin(perp) * baseHW * 0.65);
    c.lineTo(tailX, tailY);
    c.lineTo(CX - Math.cos(perp) * baseHW * 0.65, CY - Math.sin(perp) * baseHW * 0.65);
    c.closePath();
    c.fillStyle = 'rgba(255,255,255,0.45)';
    c.fill();

    c.shadowBlur = 0;

    // ── Center hub ───────────────────────────────────────────
    // Outer ring (theme color)
    c.beginPath();
    c.arc(CX, CY, R * 0.07, 0, Math.PI * 2);
    c.fillStyle = hasSignal ? theme.primaryColor : 'rgba(255,255,255,0.25)';
    c.fill();
    // Inner cap (dark)
    c.beginPath();
    c.arc(CX, CY, R * 0.042, 0, Math.PI * 2);
    c.fillStyle = '#111111';
    c.fill();

    // ── Digital readout ──────────────────────────────────────
    // Position in the lower-center area, inside the arc
    const readoutY = CY + R * 0.28;

    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = 'rgba(0,0,0,0.8)';
    c.shadowBlur = 5;

    // Speed number
    c.font = `bold ${Math.round(R * 0.32)}px ${theme.fontFamily}`;
    c.fillStyle = hasSignal ? '#ffffff' : 'rgba(255,255,255,0.3)';
    c.fillText(speed !== null ? Math.round(speed).toString() : '—', CX, readoutY);

    // Primary unit label
    c.font = `${Math.round(R * 0.13)}px ${theme.fontFamily}`;
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillText(unit.toUpperCase(), CX, readoutY + R * 0.22);

    // Secondary unit (showBoth)
    if (showBoth && speed !== null && frame.speedMs !== null) {
      const secSpeed = unit === 'kph'
        ? frame.speedMs * 2.23694
        : frame.speedMs * 3.6;
      const secUnit = unit === 'kph' ? 'mph' : 'kph';

      // Thin separator between primary and secondary
      const sepY = readoutY + R * 0.35;
      c.beginPath();
      c.moveTo(CX - R * 0.22, sepY);
      c.lineTo(CX + R * 0.22, sepY);
      c.strokeStyle = 'rgba(255,255,255,0.2)';
      c.lineWidth = 1;
      c.stroke();

      // Secondary value — larger and brighter than before
      c.font = `bold ${Math.round(R * 0.19)}px ${theme.fontFamily}`;
      c.fillStyle = 'rgba(255,255,255,0.75)';
      c.fillText(Math.round(secSpeed).toString(), CX, readoutY + R * 0.50);

      c.font = `${Math.round(R * 0.13)}px ${theme.fontFamily}`;
      c.fillStyle = 'rgba(255,255,255,0.45)';
      c.fillText(secUnit.toUpperCase(), CX, readoutY + R * 0.67);
    }

    c.shadowBlur = 0;

    // ── Outer bezel ──────────────────────────────────────────
    c.beginPath();
    c.arc(CX, CY, R, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(255,255,255,0.13)';
    c.lineWidth = 1.5;
    c.stroke();
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tickIntervals(maxSpeed: number): { major: number; minor: number } {
  if (maxSpeed <= 20)  return { major: 5,  minor: 1  };
  if (maxSpeed <= 60)  return { major: 10, minor: 5  };
  if (maxSpeed <= 120) return { major: 20, minor: 10 };
  if (maxSpeed <= 200) return { major: 40, minor: 20 };
  return { major: 50, minor: 25 };
}
