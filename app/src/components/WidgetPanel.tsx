import { useStore } from '../store/useStore';
import type { WidgetCatalogEntry } from '../types';
import WidgetInspector from './WidgetInspector';

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
];

const FONT_OPTIONS = [
  { label: 'Helvetica', value: 'Helvetica, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'System UI', value: 'system-ui, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Impact', value: 'Impact, sans-serif' },
];

export default function WidgetPanel() {
  const { layout, selectedWidgetId, addWidget, removeWidget, selectWidget, updateTheme } = useStore();

  const selectedWidget = layout.widgets.find((w) => w.id === selectedWidgetId) ?? null;
  const theme = layout.theme;

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

      {/* Per-widget inspector */}
      {selectedWidget && <WidgetInspector instance={selectedWidget} />}

      {/* Theme section — always visible */}
      <div className="sidebar-section" style={{ flexShrink: 0, borderBottom: 'none' }}>
        <div className="sidebar-section-title">Theme</div>
        <div className="inspector-fields">
          <div className="inspector-field">
            <div className="inspector-field-label">Accent Color</div>
            <div className="color-field">
              <label className="color-swatch" style={{ background: theme.primaryColor }}>
                <input
                  type="color"
                  value={theme.primaryColor}
                  onChange={(e) => updateTheme({ primaryColor: e.target.value })}
                  style={{ opacity: 0, position: 'absolute', width: 0, height: 0 }}
                />
              </label>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{theme.primaryColor}</span>
            </div>
          </div>

          <div className="inspector-field">
            <div className="inspector-field-label">Font</div>
            <select
              className="inspector-input"
              value={theme.fontFamily}
              onChange={(e) => updateTheme({ fontFamily: e.target.value })}
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div className="inspector-field">
            <div className="inspector-field-label">Background Opacity</div>
            <div className="range-field">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={theme.backgroundOpacity}
                onChange={(e) => updateTheme({ backgroundOpacity: Number(e.target.value) })}
              />
              <span className="range-readout">{theme.backgroundOpacity.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
