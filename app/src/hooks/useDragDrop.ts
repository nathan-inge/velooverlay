import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useStore } from '../store/useStore';

const VIDEO_EXTS = new Set(['mp4', 'mov']);
const TELEMETRY_EXTS = new Set(['fit', 'gpx', 'tcx']);

interface FileDropPayload {
  paths: string[];
}

/**
 * Listens for Tauri file-drop events on the entire window.
 * Routes dropped files to the store based on their extension.
 * Returns `isDragOver` so the caller can show a visual indicator.
 */
export function useDragDrop(): { isDragOver: boolean } {
  const [isDragOver, setIsDragOver] = useState(false);
  const setVideoFromPath = useStore((s) => s.setVideoFromPath);
  const setTelemetryFromPath = useStore((s) => s.setTelemetryFromPath);

  useEffect(() => {
    // Tauri v2 file-drop events.
    // Each `listen` call returns a Promise<UnlistenFn>; we collect them and
    // call them all in the cleanup function.
    const unsubscribes: Array<() => void> = [];

    const setup = async () => {
      const unDrop = await listen<FileDropPayload>('tauri://file-drop', async (event) => {
        setIsDragOver(false);
        const { paths } = event.payload;
        for (const path of paths) {
          const ext = path.split('.').pop()?.toLowerCase() ?? '';
          if (VIDEO_EXTS.has(ext)) {
            await setVideoFromPath(path);
          } else if (TELEMETRY_EXTS.has(ext)) {
            await setTelemetryFromPath(path);
          }
        }
      });

      const unHover = await listen('tauri://file-drop-hover', () => setIsDragOver(true));
      const unCancel = await listen('tauri://file-drop-cancelled', () => setIsDragOver(false));

      unsubscribes.push(unDrop, unHover, unCancel);
    };

    void setup();

    return () => {
      unsubscribes.forEach((fn) => fn());
    };
  }, [setVideoFromPath, setTelemetryFromPath]);

  return { isDragOver };
}
