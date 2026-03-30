import type { WidgetDefinition } from '@velooverlay/widget-sdk';
import {
  SpeedometerWidget,
  SnakeMapWidget,
  ElevationProfileWidget,
  HeartRateWidget,
  CadenceWidget,
  PowerWidget,
  ElevationWidget,
  GradientWidget,
  PowerMeterBarWidget,
  AnalogSpeedometerWidget,
} from '@velooverlay/widgets-builtin';

export const WIDGET_REGISTRY: Record<string, WidgetDefinition> = {
  'builtin:speedometer': SpeedometerWidget,
  'builtin:snake-map': SnakeMapWidget,
  'builtin:elevation-profile': ElevationProfileWidget,
  'builtin:heart-rate': HeartRateWidget,
  'builtin:cadence': CadenceWidget,
  'builtin:power': PowerWidget,
  'builtin:elevation': ElevationWidget,
  'builtin:gradient': GradientWidget,
  'builtin:power-meter': PowerMeterBarWidget,
  'builtin:analog-speedometer': AnalogSpeedometerWidget,
};
