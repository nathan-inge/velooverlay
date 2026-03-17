import { makeMetricTileWidget } from './metric-tile';

export const CadenceWidget = makeMetricTileWidget({
  id: 'builtin:cadence',
  name: 'Cadence',
  label: 'CADENCE',
  unit: 'RPM',
  getValue: ({ frame }) => frame.cadence,
});
