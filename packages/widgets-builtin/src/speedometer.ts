import { WidgetDefinition, WidgetRenderContext } from '@velooverlay/widget-sdk';

export interface SpeedometerConfig extends Record<string, unknown> {
  unit: 'mph' | 'kph';
}

export const SpeedometerWidget: WidgetDefinition<SpeedometerConfig> = {
  id: 'builtin:speedometer',
  name: 'Speedometer',
  version: '1.0.0',
  defaultSize: { width: 160, height: 80 },

  getDefaultConfig: () => ({ unit: 'kph' }),

  render(ctx: WidgetRenderContext, config: SpeedometerConfig): void {
    const { canvas, frame, theme, width, height } = ctx;
    const c = canvas.getContext('2d')!;

    // Background
    c.fillStyle = `rgba(0, 0, 0, ${theme.backgroundOpacity})`;
    c.fillRect(0, 0, width, height);

    if (frame.signalStatus === 'lost' || frame.speedMs === null) {
      drawSignalLost(c, theme, width, height);
      return;
    }

    const speed = config.unit === 'kph'
      ? frame.speedMs * 3.6
      : frame.speedMs * 2.237;

    // TODO: Replace with proper gauge rendering.
    c.fillStyle = theme.primaryColor;
    c.font = `bold ${height * 0.5}px ${theme.fontFamily}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(`${speed.toFixed(1)}`, width / 2, height * 0.45);

    c.font = `${height * 0.2}px ${theme.fontFamily}`;
    c.fillText(config.unit.toUpperCase(), width / 2, height * 0.78);
  },
};

function drawSignalLost(
  c: CanvasRenderingContext2D,
  theme: Theme,
  width: number,
  height: number,
): void {
  c.fillStyle = 'rgba(255,255,255,0.4)';
  c.font = `${height * 0.2}px ${theme.fontFamily}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('NO SIGNAL', width / 2, height / 2);
}

// Local alias to avoid circular import noise
type Theme = WidgetRenderContext['theme'];
