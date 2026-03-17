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
];

export default function WidgetPanel() {
  const { layout, selectedWidgetId, addWidget, removeWidget, selectWidget } = useStore();

  return (
    <div className="sidebar">
      {/* Widget catalogue — add buttons */}
      <div className="sidebar-section">
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
        <div className="sidebar-section" style={{ flex: 1, overflow: 'hidden', borderBottom: 'none' }}>
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
