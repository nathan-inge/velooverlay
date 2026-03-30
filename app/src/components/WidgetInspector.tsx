import { useStore } from '../store/useStore';
import type { WidgetInstance } from '../types';

interface Props {
  instance: WidgetInstance;
}

export default function WidgetInspector({ instance }: Props) {
  const updateWidgetConfig = useStore((s) => s.updateWidgetConfig);
  const patch = (p: Record<string, unknown>) => updateWidgetConfig(instance.id, p);

  const cfg = instance.config as Record<string, unknown>;

  function renderFields() {
    switch (instance.type) {
      case 'builtin:speedometer':
        return (
          <div className="inspector-field">
            <div className="inspector-field-label">Unit</div>
            <div className="seg-ctrl">
              <button
                className={`btn small${cfg.unit === 'kph' ? ' primary' : ''}`}
                onClick={() => patch({ unit: 'kph' })}
              >
                KPH
              </button>
              <button
                className={`btn small${cfg.unit === 'mph' ? ' primary' : ''}`}
                onClick={() => patch({ unit: 'mph' })}
              >
                MPH
              </button>
            </div>
          </div>
        );

      case 'builtin:snake-map':
        return (
          <>
            <div className="inspector-field">
              <div className="inspector-field-label">Padding</div>
              <input
                type="number"
                className="inspector-input"
                min={0}
                max={50}
                value={cfg.padding as number ?? 10}
                onChange={(e) => patch({ padding: Number(e.target.value) })}
              />
            </div>
            <div className="inspector-field">
              <div className="inspector-field-label">Full Track</div>
              <input
                type="checkbox"
                checked={cfg.fullTrack as boolean ?? true}
                onChange={(e) => patch({ fullTrack: e.target.checked })}
              />
            </div>
          </>
        );

      case 'builtin:elevation-profile':
        return (
          <>
            <div className="inspector-field">
              <div className="inspector-field-label">Padding</div>
              <input
                type="number"
                className="inspector-input"
                min={0}
                max={50}
                value={cfg.padding as number ?? 12}
                onChange={(e) => patch({ padding: Number(e.target.value) })}
              />
            </div>
            <div className="inspector-field">
              <div className="inspector-field-label">Full Track</div>
              <input
                type="checkbox"
                checked={cfg.fullTrack as boolean ?? true}
                onChange={(e) => patch({ fullTrack: e.target.checked })}
              />
            </div>
          </>
        );

      case 'builtin:gradient':
        return (
          <div className="inspector-field">
            <div className="inspector-field-label">Smoothing</div>
            <div className="seg-ctrl">
              {([100, 200, 400] as const).map((m) => (
                <button
                  key={m}
                  className={`btn small${cfg.windowM === m ? ' primary' : ''}`}
                  onClick={() => patch({ windowM: m })}
                >
                  {m}m
                </button>
              ))}
            </div>
          </div>
        );

      case 'builtin:elevation':
        return (
          <div className="inspector-field">
            <div className="inspector-field-label">Unit</div>
            <div className="seg-ctrl">
              <button
                className={`btn small${cfg.unit === 'm' ? ' primary' : ''}`}
                onClick={() => patch({ unit: 'm' })}
              >
                m
              </button>
              <button
                className={`btn small${cfg.unit === 'ft' ? ' primary' : ''}`}
                onClick={() => patch({ unit: 'ft' })}
              >
                ft
              </button>
            </div>
          </div>
        );

      case 'builtin:analog-speedometer':
        return (
          <>
            <div className="inspector-field">
              <div className="inspector-field-label">Unit</div>
              <div className="seg-ctrl">
                <button
                  className={`btn small${cfg.unit === 'kph' ? ' primary' : ''}`}
                  onClick={() => patch({ unit: 'kph' })}
                >
                  KPH
                </button>
                <button
                  className={`btn small${cfg.unit === 'mph' ? ' primary' : ''}`}
                  onClick={() => patch({ unit: 'mph' })}
                >
                  MPH
                </button>
              </div>
            </div>
            <div className="inspector-field">
              <div className="inspector-field-label">Max Speed</div>
              <input
                type="number"
                className="inspector-input"
                min={10}
                max={500}
                step={cfg.unit === 'mph' ? 5 : 10}
                value={(cfg.maxSpeed as number) ?? 60}
                onChange={(e) => patch({ maxSpeed: Number(e.target.value) })}
              />
            </div>
            <div className="inspector-field">
              <div className="inspector-field-label">Arc (°)</div>
              <input
                type="number"
                className="inspector-input"
                min={60}
                max={350}
                step={5}
                value={(cfg.arcDegrees as number) ?? 220}
                onChange={(e) => patch({ arcDegrees: Number(e.target.value) })}
              />
            </div>
            <div className="inspector-field">
              <div className="inspector-field-label">Radius (%)</div>
              <input
                type="number"
                className="inspector-input"
                min={20}
                max={100}
                step={5}
                value={(cfg.radiusScale as number) ?? 92}
                onChange={(e) => patch({ radiusScale: Number(e.target.value) })}
              />
            </div>
            <div className="inspector-field">
              <div className="inspector-field-label">Show Both Units</div>
              <input
                type="checkbox"
                checked={(cfg.showBoth as boolean) ?? false}
                onChange={(e) => patch({ showBoth: e.target.checked })}
              />
            </div>
          </>
        );

      case 'builtin:power-meter': {
        type PowerZone = { upToWatts: number; color: string };
        const rawZones = cfg.zones as PowerZone[] | undefined;
        const zones: PowerZone[] = Array.isArray(rawZones) ? rawZones : [];
        const maxPower = (cfg.maxPower as number) ?? 600;

        const patchZone = (i: number, update: Partial<PowerZone>) => {
          const next = zones.map((z, j) => (j === i ? { ...z, ...update } : z));
          patch({ zones: next });
        };

        const removeZone = (i: number) => {
          patch({ zones: zones.filter((_, j) => j !== i) });
        };

        const addZone = () => {
          const lastWatts = zones.length > 0 ? zones[zones.length - 1].upToWatts : 0;
          patch({ zones: [...zones, { upToWatts: lastWatts + 50, color: '#ffffff' }] });
        };

        return (
          <>
            <div className="inspector-field">
              <div className="inspector-field-label">Max Power (W)</div>
              <input
                type="number"
                className="inspector-input"
                min={100}
                max={2000}
                step={50}
                value={maxPower}
                onChange={(e) => patch({ maxPower: Number(e.target.value) })}
              />
            </div>
            <div className="inspector-field" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="inspector-field-label">Power Zones</div>
              {zones.map((zone, i) => (
                <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: '#666', minWidth: 18 }}>Z{i + 1}</span>
                  <input
                    type="number"
                    className="inspector-input"
                    style={{ flex: 1, minWidth: 0 }}
                    min={1}
                    max={2000}
                    step={10}
                    value={zone.upToWatts}
                    onChange={(e) => patchZone(i, { upToWatts: Number(e.target.value) })}
                  />
                  <span style={{ fontSize: 10, color: '#666' }}>W</span>
                  <input
                    type="color"
                    value={zone.color}
                    style={{ width: 26, height: 22, border: 'none', cursor: 'pointer', padding: 0, background: 'none' }}
                    onChange={(e) => patchZone(i, { color: e.target.value })}
                  />
                  {zones.length > 1 && (
                    <button className="btn small danger" onClick={() => removeZone(i)}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <button className="btn small" style={{ marginTop: 2 }} onClick={addZone}>
                + Add Zone
              </button>
            </div>
          </>
        );
      }

      default:
        return <div className="inspector-empty">No settings for this widget.</div>;
    }
  }

  return <div className="inspector-fields">{renderFields()}</div>;
}
