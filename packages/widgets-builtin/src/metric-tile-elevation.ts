import { WidgetDefinition, WidgetRenderContext } from '@velooverlay/widget-sdk';

export interface ElevationConfig extends Record<string, unknown> {
  unit: 'm' | 'ft';
}

export const ElevationWidget: WidgetDefinition<ElevationConfig> = {
  id: 'builtin:elevation',
  name: 'Elevation',
  version: '1.0.0',
  defaultSize: { width: 120, height: 70 },

  getDefaultConfig: () => ({ unit: 'm' }),

  render(ctx: WidgetRenderContext, config: ElevationConfig): void {
    const { canvas, frame, theme, width, height } = ctx;
    const c = canvas.getContext('2d')!;

    c.fillStyle = `rgba(0, 0, 0, ${theme.backgroundOpacity})`;
    c.fillRect(0, 0, width, height);

    c.shadowColor = 'rgba(0,0,0,0.9)';
    c.shadowBlur = 6;

    const raw = frame.signalStatus === 'lost' ? null : frame.altitudeM;
    const value = raw !== null
      ? (config.unit === 'ft' ? raw * 3.28084 : raw)
      : null;

    const valueStr = value !== null ? String(Math.round(value)) : '--';
    const unitStr = config.unit;
    const gap = height * 0.06;

    const valueFontSize = height * 0.55;
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
    c.fillStyle = value !== null ? theme.primaryColor : 'rgba(255,255,255,0.3)';
    c.fillText(valueStr, startX, midY);

    c.font = `${unitFontSize}px ${theme.fontFamily}`;
    c.fillStyle = theme.primaryColor;
    c.fillText(unitStr, startX + valueWidth + gap, midY);
  },
};
