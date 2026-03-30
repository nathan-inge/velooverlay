import { useStore } from '../store/useStore';
import type { WidgetCatalogEntry } from '../types';

// The built-in widget catalogue — one entry per widget type.
const CATALOG: WidgetCatalogEntry[] = [
  {
    type: 'builtin:speedometer',
    name: 'Speedometer',
    defaultSize: { width: 160, height: 90 },
    defaultConfig: { unit: 'kph' },
  },
  {
    type: 'builtin:snake-map',
    name: 'Snake Map',
    defaultSize: { width: 260, height: 260 },
    defaultConfig: { padding: 10, fullTrack: true },
  },
  {
    type: 'builtin:elevation-profile',
    name: 'Elevation Profile',
    defaultSize: { width: 400, height: 150 },
    defaultConfig: { padding: 12, fullTrack: true },
  },
  {
    type: 'builtin:heart-rate',
    name: 'Heart Rate',
    defaultSize: { width: 140, height: 80 },
    defaultConfig: {},
  },
  {
    type: 'builtin:cadence',
    name: 'Cadence',
    defaultSize: { width: 140, height: 80 },
    defaultConfig: {},
  },
  {
    type: 'builtin:power',
    name: 'Power',
    defaultSize: { width: 140, height: 80 },
    defaultConfig: {},
  },
  {
    type: 'builtin:elevation',
    name: 'Elevation',
    defaultSize: { width: 140, height: 80 },
    defaultConfig: { unit: 'm' },
  },
  {
    type: 'builtin:gradient',
    name: 'Gradient',
    defaultSize: { width: 140, height: 80 },
    defaultConfig: { windowM: 100 },
  },
  {
    type: 'builtin:analog-speedometer',
    name: 'Analog Speedometer',
    defaultSize: { width: 220, height: 185 },
    defaultConfig: { unit: 'kph', showBoth: false, maxSpeed: 60, arcDegrees: 220, radiusScale: 92 },
  },
  {
    type: 'builtin:power-meter',
    name: 'Power Meter',
    defaultSize: { width: 380, height: 80 },
    defaultConfig: {
      maxPower: 600,
      zones: [
        { upToWatts: 150, color: '#888899' },
        { upToWatts: 220, color: '#4a9eff' },
        { upToWatts: 290, color: '#40c97a' },
        { upToWatts: 360, color: '#ffd93d' },
        { upToWatts: 440, color: '#ff9944' },
        { upToWatts: 600, color: '#ff4444' },
      ],
    },
  },
];

export default function WidgetPanel() {
  const { layout, selectedWidgetId, addWidget, removeWidget, selectWidget } = useStore();

  return (
    <div className="sidebar">
      {/* Widget catalogue — add buttons */}
      <div className="sidebar-section" style={{ flexShrink: 0 }}>
        <div className="sidebar-section-title">Add Widget</div>
        {CATALOG.map((entry) => (
          <div key={entry.type} className="widget-catalog-item">
            <span className="widget-catalog-name">{entry.name}</span>
            <button
              className="btn small"
              onClick={() => addWidget(entry.type, entry.defaultSize, entry.defaultConfig)}
            >
              +
            </button>
          </div>
        ))}
      </div>

      {/* Active widget instances */}
      {layout.widgets.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-section-title">Layout ({layout.widgets.length})</div>
          <div className="widget-instances">
            {layout.widgets.map((w) => {
              const cat = CATALOG.find((c) => c.type === w.type);
              return (
                <div
                  key={w.id}
                  className={`widget-instance-row${selectedWidgetId === w.id ? ' selected' : ''}`}
                  onClick={() => selectWidget(w.id)}
                >
                  <div>
                    <div className="widget-instance-name">{cat?.name ?? w.type}</div>
                    <div className="widget-instance-type">
                      {w.size.width}×{w.size.height}
                    </div>
                  </div>
                  <button
                    className="btn small danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeWidget(w.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
