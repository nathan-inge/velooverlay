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

    const raw = frame.signalStatus === 'lost' ? null : frame.altitudeM;
    const value = raw !== null
      ? (config.unit === 'ft' ? raw * 3.28084 : raw)
      : null;

    // Label
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.font = `${height * 0.18}px ${theme.fontFamily}`;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillText('ELEVATION', width / 2, height * 0.08);

    // Value
    c.fillStyle = value !== null ? theme.primaryColor : 'rgba(255,255,255,0.3)';
    c.font = `bold ${height * 0.42}px ${theme.fontFamily}`;
    c.textBaseline = 'middle';
    c.fillText(value !== null ? String(Math.round(value)) : '--', width / 2, height * 0.55);

    // Unit
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.font = `${height * 0.16}px ${theme.fontFamily}`;
    c.textBaseline = 'bottom';
    c.fillText(config.unit, width / 2, height * 0.97);
  },
};
