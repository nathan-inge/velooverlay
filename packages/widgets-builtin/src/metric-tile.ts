import { WidgetDefinition, WidgetRenderContext } from '@velooverlay/widget-sdk';

/** Reusable factory for simple single-value metric display tiles. */
export function makeMetricTileWidget(opts: {
  id: string;
  name: string;
  label: string;
  unit: string;
  getValue: (ctx: WidgetRenderContext) => number | null;
}): WidgetDefinition {
  return {
    id: opts.id,
    name: opts.name,
    version: '1.0.0',
    defaultSize: { width: 120, height: 70 },

    getDefaultConfig: () => ({}),

    render(ctx: WidgetRenderContext): void {
      const { canvas, frame, theme, width, height } = ctx;
      const c = canvas.getContext('2d')!;

      c.fillStyle = `rgba(0, 0, 0, ${theme.backgroundOpacity})`;
      c.fillRect(0, 0, width, height);

      const value = frame.signalStatus === 'lost' ? null : opts.getValue(ctx);

      c.shadowColor = 'rgba(0,0,0,0.9)';
      c.shadowBlur = 6;

      // Label (top)
      c.fillStyle = 'rgba(255,255,255,0.6)';
      c.font = `${height * 0.18}px ${theme.fontFamily}`;
      c.textAlign = 'center';
      c.textBaseline = 'top';
      c.fillText(opts.label, width / 2, height * 0.08);

      // Value (centre)
      c.fillStyle = value !== null ? theme.primaryColor : 'rgba(255,255,255,0.3)';
      c.font = `bold ${height * 0.42}px ${theme.fontFamily}`;
      c.textBaseline = 'middle';
      c.fillText(value !== null ? String(Math.round(value)) : '--', width / 2, height * 0.55);

      // Unit (bottom)
      c.fillStyle = theme.primaryColor;
      c.font = `${height * 0.16}px ${theme.fontFamily}`;
      c.textBaseline = 'bottom';
      c.fillText(opts.unit, width / 2, height * 0.97);
    },
  };
}
