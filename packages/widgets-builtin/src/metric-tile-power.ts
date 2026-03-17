import { makeMetricTileWidget } from './metric-tile';

export const PowerWidget = makeMetricTileWidget({
  id: 'builtin:power',
  name: 'Power',
  label: 'POWER',
  unit: 'W',
  getValue: ({ frame }) => frame.power,
});
