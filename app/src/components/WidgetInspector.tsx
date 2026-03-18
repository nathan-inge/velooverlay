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

      default:
        return <div className="inspector-empty">No settings for this widget.</div>;
    }
  }

  return <div className="inspector-fields">{renderFields()}</div>;
}
