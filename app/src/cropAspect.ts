/**
 * Crop aspect ratio utilities shared between Stage, FramingEditor, Toolbar,
 * and the Zustand store.
 *
 * The stage is always 1920×1080 logical pixels.  When a crop is active we
 * carve out a centred strip of that width and export it at the chosen
 * resolution.  The overlay PNGs are always rendered at full 1920×1080 and
 * then cropped by FFmpeg; only the visible strip is composited.
 */

export type CropAspect = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | null;

const STAGE_W = 1920;
const STAGE_H = 1080;

function even(n: number): number {
  return n % 2 === 0 ? n : n - 1;
}

/** Parse an aspect-ratio string into (w, h) integers. */
export function parseCropAspect(aspect: CropAspect): { arW: number; arH: number } {
  if (!aspect) return { arW: 16, arH: 9 };
  const [arW, arH] = aspect.split(':').map(Number);
  return { arW, arH };
}

/**
 * Width of the centred crop strip in 1920×1080 logical stage space.
 * `null` (no crop) → full stage width (1920).
 */
export function cropStripWidth(aspect: CropAspect): number {
  if (!aspect) return STAGE_W;
  const { arW, arH } = parseCropAspect(aspect);
  return Math.floor(STAGE_H * arW / arH);
}

/** X-offset of the crop strip's left edge in 1920×1080 space. */
export function cropStripOffsetX(aspect: CropAspect): number {
  return Math.floor((STAGE_W - cropStripWidth(aspect)) / 2);
}

/**
 * Resolve the export output pixel dimensions.
 *
 * For all crop aspects "1080p" means the SHORT edge of the output = 1080 px:
 *   9:16  → 1080 × 1920   (portrait)
 *   3:4   → 1080 × 1440   (portrait)
 *   1:1   → 1080 × 1080   (square)
 *   4:3   → 1440 × 1080   (landscape)
 *   none  → 1920 × 1080   (standard 16:9)
 *
 * "source" gives native crop dimensions at the source video's own height.
 */
export function resolveOutputSize(
  resolution: 'source' | '1080p' | '1440p' | '4k',
  meta: { width: number; height: number } | null,
  cropAspect: CropAspect,
): { width: number; height: number } {
  if (!cropAspect) {
    if (resolution === 'source' && meta) return { width: meta.width, height: meta.height };
    if (resolution === '4k')    return { width: 3840, height: 2160 };
    if (resolution === '1440p') return { width: 2560, height: 1440 };
    return { width: 1920, height: 1080 };
  }

  const { arW, arH } = parseCropAspect(cropAspect);

  if (resolution === 'source' && meta) {
    const h = meta.height;
    const w = Math.floor(h * arW / arH);
    return { width: even(w), height: even(h) };
  }

  // Named resolutions: the short edge determines scale.
  const shortEdge = resolution === '4k' ? 2160 : resolution === '1440p' ? 1440 : 1080;

  if (arW === arH) return { width: shortEdge, height: shortEdge };

  if (arW > arH) {
    // Landscape (e.g. 4:3): short edge = height
    const h = shortEdge;
    const w = even(Math.round(h * arW / arH));
    return { width: w, height: h };
  } else {
    // Portrait (e.g. 9:16, 3:4): short edge = width
    const w = shortEdge;
    const h = even(Math.round(w * arH / arW));
    return { width: w, height: h };
  }
}
