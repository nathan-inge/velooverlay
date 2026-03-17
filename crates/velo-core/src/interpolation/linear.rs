use super::InterpolationStrategy;
use crate::error::InterpolationError;
use crate::model::{SignalStatus, TelemetryFrame, TelemetryPoint, TelemetrySession};
use crate::sync::{SyncResult, VideoMetadata};

pub struct LinearInterpolation;

impl InterpolationStrategy for LinearInterpolation {
    fn interpolate(
        &self,
        session: &TelemetrySession,
        sync: &SyncResult,
        video: &VideoMetadata,
    ) -> Result<Vec<TelemetryFrame>, InterpolationError> {
        if session.points.is_empty() {
            return Err(InterpolationError::EmptySession);
        }
        if video.frame_rate <= 0.0 {
            return Err(InterpolationError::InvalidFrameRate(video.frame_rate));
        }

        let frame_duration_ms = (1000.0 / video.frame_rate) as u64;
        let total_frames = (video.duration_ms / frame_duration_ms) as usize;

        let mut frames = Vec::with_capacity(total_frames);

        for frame_index in 0..total_frames {
            let video_time_ms = frame_index as u64 * frame_duration_ms;

            // Convert video time to telemetry time using the sync offset.
            // If offset is +3500ms, telemetry time 0 = video time 3500ms.
            let telem_time_ms = video_time_ms as i64 - sync.offset_ms;

            let (data, signal_status) = if telem_time_ms < 0 {
                // Video starts before telemetry — no data yet.
                (zero_point(0), SignalStatus::Lost)
            } else {
                interpolate_at(&session.points, telem_time_ms as u64)
            };

            frames.push(TelemetryFrame {
                frame_index: frame_index as u64,
                video_time_ms,
                data,
                signal_status,
            });
        }

        Ok(frames)
    }
}

/// Linearly interpolate (or extrapolate) a `TelemetryPoint` at `target_ms`
/// from the sorted slice of raw points.
fn interpolate_at(points: &[TelemetryPoint], target_ms: u64) -> (TelemetryPoint, SignalStatus) {
    // Find the two surrounding points using binary search.
    let idx = points.partition_point(|p| p.timestamp_ms <= target_ms);

    if idx == 0 {
        // Before the first sample.
        return (points[0].clone(), SignalStatus::Lost);
    }
    if idx >= points.len() {
        // After the last sample.
        return (points[points.len() - 1].clone(), SignalStatus::Lost);
    }

    let before = &points[idx - 1];
    let after = &points[idx];

    // t = 0.0 at `before`, 1.0 at `after`
    let span = (after.timestamp_ms - before.timestamp_ms) as f64;
    let t = if span == 0.0 {
        0.0
    } else {
        (target_ms - before.timestamp_ms) as f64 / span
    };

    let data = TelemetryPoint {
        timestamp_ms: target_ms,
        lat: lerp_opt(before.lat, after.lat, t),
        lon: lerp_opt(before.lon, after.lon, t),
        altitude_m: lerp_opt_f32(before.altitude_m, after.altitude_m, t),
        speed_ms: lerp_opt_f32(before.speed_ms, after.speed_ms, t),
        heart_rate: lerp_opt_u8(before.heart_rate, after.heart_rate, t),
        cadence: lerp_opt_u8(before.cadence, after.cadence, t),
        power: lerp_opt_u16(before.power, after.power, t),
        distance_m: lerp_opt_f32(before.distance_m, after.distance_m, t),
    };

    (data, SignalStatus::Interpolated)
}

// --- Helper lerp functions ---
// `lerp` = "linear interpolation": result = a + (b - a) * t
// If either input is None (signal lost), the output is None.

fn lerp_opt(a: Option<f64>, b: Option<f64>, t: f64) -> Option<f64> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a + (b - a) * t),
        _ => None,
    }
}

fn lerp_opt_f32(a: Option<f32>, b: Option<f32>, t: f64) -> Option<f32> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a + (b - a) * t as f32),
        _ => None,
    }
}

fn lerp_opt_u8(a: Option<u8>, b: Option<u8>, t: f64) -> Option<u8> {
    match (a, b) {
        (Some(a), Some(b)) => Some((a as f64 + (b as f64 - a as f64) * t).round() as u8),
        _ => None,
    }
}

fn lerp_opt_u16(a: Option<u16>, b: Option<u16>, t: f64) -> Option<u16> {
    match (a, b) {
        (Some(a), Some(b)) => Some((a as f64 + (b as f64 - a as f64) * t).round() as u16),
        _ => None,
    }
}

fn zero_point(timestamp_ms: u64) -> TelemetryPoint {
    TelemetryPoint {
        timestamp_ms,
        lat: None,
        lon: None,
        altitude_m: None,
        speed_ms: None,
        heart_rate: None,
        cadence: None,
        power: None,
        distance_m: None,
    }
}
