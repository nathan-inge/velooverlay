import { useEffect } from 'react';
import './index.css';
import { useStore } from './store/useStore';
import { useDragDrop } from './hooks/useDragDrop';
import Toolbar from './components/Toolbar';
import WidgetPanel from './components/WidgetPanel';
import Stage from './components/Stage/index';

export default function App() {
  const init = useStore((s) => s.init);
  const { isDragOver } = useDragDrop();

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="app">
      <Toolbar />
      <div className="app-body">
        <WidgetPanel />
        <Stage />
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
