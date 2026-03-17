import { makeMetricTileWidget } from './metric-tile';

export const HeartRateWidget = makeMetricTileWidget({
  id: 'builtin:heart-rate',
  name: 'Heart Rate',
  label: 'HEART RATE',
  unit: 'BPM',
  getValue: ({ frame }) => frame.heartRate,
});
