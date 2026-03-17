import type { TelemetryFrameDto } from '../types';

/**
 * Binary-search the frame array for the frame whose `videoTimeMs` is closest
 * to (and not greater than) `videoTimeMs`.
 *
 * Returns null when the array is empty or time is before the first frame.
 */
export function findFrameAtTime(
  frames: TelemetryFrameDto[],
  videoTimeMs: number,
): TelemetryFrameDto | null {
  if (frames.length === 0) return null;

  let lo = 0;
  let hi = frames.length - 1;

  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].videoTimeMs <= videoTimeMs) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  // If the closest frame is still in the future, return null.
  if (frames[lo].videoTimeMs > videoTimeMs) return null;

  return frames[lo];
}
