// Types that mirror the Rust DTOs and the shared layout.json format.

export interface VideoMetadataDto {
  durationMs: number;
  frameRate: number;
  hasTimestamp: boolean;
}

export interface TelemetryFrameDto {
  frameIndex: number;
  videoTimeMs: number;
  speedMs: number | null;
  heartRate: number | null;
  cadence: number | null;
  power: number | null;
  lat: number | null;
  lon: number | null;
  altitudeM: number | null;
  distanceM: number | null;
  signalStatus: 'ok' | 'interpolated' | 'lost';
}

export interface RoutePointDto {
  lat: number;
  lon: number;
  altitudeM: number | null;
  distanceM: number | null;
}

export interface RouteBoundsDto {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface RouteDataDto {
  points: RoutePointDto[];
  bounds: RouteBoundsDto;
}

export interface ProcessResult {
  frames: TelemetryFrameDto[];
  route: RouteDataDto;
  sessionDurationMs: number;
}

// layout.json format — shared with the CLI.
export interface Theme {
  fontFamily: string;
  primaryColor: string;
  backgroundOpacity: number;
}

export interface WidgetPosition {
  x: number;
  y: number;
}

export interface WidgetSize {
  width: number;
  height: number;
}

export interface WidgetInstance {
  id: string;
  type: string;
  version: string;
  position: WidgetPosition;
  size: WidgetSize;
  config: Record<string, unknown>;
}

export interface Layout {
  schema_version: string;
  theme: Theme;
  widgets: WidgetInstance[];
}

// Catalogue entry shown in the Widget Panel sidebar.
export interface WidgetCatalogEntry {
  type: string;
  name: string;
  defaultSize: { width: number; height: number };
  defaultConfig: Record<string, unknown>;
}
