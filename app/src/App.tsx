import { useEffect } from 'react';
import './index.css';
import { useStore } from './store/useStore';
import { useDragDrop } from './hooks/useDragDrop';
import Toolbar from './components/Toolbar';
import WidgetPanel from './components/WidgetPanel';
import Stage from './components/Stage/index';
import WidgetInspector from './components/WidgetInspector';
import FramingEditor from './components/FramingEditor';

const FONT_OPTIONS = [
  { label: 'Helvetica', value: 'Helvetica, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'System UI', value: 'system-ui, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Impact', value: 'Impact, sans-serif' },
];

export default function App() {
  const init = useStore((s) => s.init);
  const layout = useStore((s) => s.layout);
  const selectedWidgetId = useStore((s) => s.selectedWidgetId);
  const updateTheme = useStore((s) => s.updateTheme);
  const cropVertical = useStore((s) => s.cropVertical);
  const { isDragOver } = useDragDrop();

  const selectedWidget = layout.widgets.find((w) => w.id === selectedWidgetId) ?? null;
  const theme = layout.theme;

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="app">
      <Toolbar />
      <div className="app-body">
        <WidgetPanel />
        <Stage />
        <div className="inspector-panel">
          {/* Framing — shown when 9:16 crop is enabled */}
          {cropVertical && (
            <div className="sidebar-section">
              <div className="sidebar-section-title">Framing</div>
              <FramingEditor />
            </div>
          )}

          {/* Theme — always visible at top */}
          <div className="sidebar-section">
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
                    <option key={f.value} value={f.value}>{f.label}</option>
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

          {/* Widget properties — shown when a widget is selected */}
          {selectedWidget && (
            <div className="sidebar-section" style={{ borderBottom: 'none' }}>
              <div className="sidebar-section-title">Properties</div>
              <WidgetInspector instance={selectedWidget} />
            </div>
          )}
        </div>
      </div>

      {/* Full-window drop overlay */}
      {isDragOver && (
        <div className="drop-overlay">
          <div className="drop-overlay-inner">
            <div className="drop-icon">⬇</div>
            <strong>Drop to import</strong>
            <span>Video (.mp4 / .mov) or Telemetry (.fit / .gpx / .tcx)</span>
          </div>
        </div>
      )}
    </div>
  );
}
