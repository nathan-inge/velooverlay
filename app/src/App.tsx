import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

export default function App() {
  const [ffmpegAvailable, setFfmpegAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    // Check for FFmpeg on startup via the Tauri IPC bridge.
    invoke<boolean>('check_ffmpeg').then(setFfmpegAvailable);
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui', padding: 32, color: '#fff', background: '#111', minHeight: '100vh' }}>
      <h1>VeloOverlay</h1>
      <p style={{ color: '#aaa' }}>Phase 1 GUI — coming soon.</p>
      {ffmpegAvailable === false && (
        <div style={{ marginTop: 16, padding: 12, background: '#5a1a1a', borderRadius: 6 }}>
          ⚠ FFmpeg not found. Install it with <code>brew install ffmpeg</code> to enable video rendering.
        </div>
      )}
      {ffmpegAvailable === true && (
        <div style={{ marginTop: 16, padding: 12, background: '#1a3a1a', borderRadius: 6 }}>
          ✓ FFmpeg detected.
        </div>
      )}
    </div>
  );
}
