import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useStore } from '../store/useStore';

const VIDEO_EXTS = new Set(['mp4', 'mov']);
const TELEMETRY_EXTS = new Set(['fit', 'gpx', 'tcx']);
const LAYOUT_EXTS = new Set(['json']);

/**
 * Listens for Tauri drag-drop events on the entire window.
 * Routes dropped files to the store based on their extension.
 * Returns `isDragOver` so the caller can show a visual indicator.
 */
export function useDragDrop(): { isDragOver: boolean } {
  const [isDragOver, setIsDragOver] = useState(false);
  const setVideoFromPath = useStore((s) => s.setVideoFromPath);
  const setTelemetryFromPath = useStore((s) => s.setTelemetryFromPath);
  const loadLayoutFromPath = useStore((s) => s.loadLayoutFromPath);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      unlisten = await getCurrentWindow().onDragDropEvent(async (event) => {
        const { type } = event.payload;
        if (type === 'enter' || type === 'over') {
          setIsDragOver(true);
        } else if (type === 'leave') {
          setIsDragOver(false);
        } else if (type === 'drop') {
          setIsDragOver(false);
          for (const path of event.payload.paths) {
            const ext = path.split('.').pop()?.toLowerCase() ?? '';
            if (VIDEO_EXTS.has(ext)) {
              await setVideoFromPath(path);
            } else if (TELEMETRY_EXTS.has(ext)) {
              await setTelemetryFromPath(path);
            } else if (LAYOUT_EXTS.has(ext)) {
              await loadLayoutFromPath(path);
            }
          }
        }
      });
    };

    void setup();

    return () => {
      unlisten?.();
    };
  }, [setVideoFromPath, setTelemetryFromPath, loadLayoutFromPath]);

  return { isDragOver };
}
