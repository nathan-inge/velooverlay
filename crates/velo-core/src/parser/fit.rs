use super::TelemetryParser;
use crate::error::ParseError;
use crate::model::{TelemetryPoint, TelemetrySession};
use chrono::Utc;
use fitparser::Value;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

/// Conversion factor: FIT semicircles → decimal degrees.
/// Full circle = 2^32 semicircles = 360°, so 1 semicircle = 180 / 2^31 degrees.
const SEMICIRCLES_TO_DEGREES: f64 = 180.0 / 2_147_483_648.0;

pub struct FitParser;

impl TelemetryParser for FitParser {
    fn supported_extensions(&self) -> &[&str] {
        &["fit"]
    }

    fn parse(&self, path: &Path) -> Result<TelemetrySession, ParseError> {
        let file = File::open(path).map_err(|e| ParseError::Io {
            path: path.to_path_buf(),
            source: e,
        })?;

        let records = fitparser::from_reader(&mut BufReader::new(file))
            .map_err(|e| ParseError::FitParse(e.to_string()))?;

        let mut points: Vec<TelemetryPoint> = Vec::new();
        let mut session_start_time = None;
        // The base timestamp is the first Record timestamp; all subsequent
        // timestamps are stored as milliseconds relative to it.
        let mut base_timestamp: Option<chrono::DateTime<chrono::Utc>> = None;

        for record in &records {
            // fitparser returns a string-based kind — match on the Debug output.
            // We care about two message types:
            //   "session" → contains the ride start time
            //   "record"  → per-second data points
            let kind = format!("{:?}", record.kind()).to_lowercase();

            match kind.as_str() {
                "session" => {
                    for field in record.fields() {
                        if field.name() == "start_time" {
                            if let Value::Timestamp(dt) = field.value() {
                                // fitparser returns DateTime<Local>; convert to UTC.
                                session_start_time = Some(dt.with_timezone(&Utc));
                            }
                        }
                    }
                }

                "record" => {
                    let mut timestamp_opt = None;
                    let mut lat: Option<f64> = None;
                    let mut lon: Option<f64> = None;
                    let mut altitude_m: Option<f32> = None;
                    let mut speed_ms: Option<f32> = None;
                    let mut heart_rate: Option<u8> = None;
                    let mut cadence: Option<u8> = None;
                    let mut power: Option<u16> = None;
                    let mut distance_m: Option<f32> = None;

                    for field in record.fields() {
                        match field.name() {
                            "timestamp" => {
                                if let Value::Timestamp(dt) = field.value() {
                                    timestamp_opt = Some(dt.with_timezone(&Utc));
                                }
                            }
                            "position_lat" => {
                                // Stored as SInt32 semicircles — fitparser does NOT
                                // convert these to degrees; we do it ourselves.
                                lat = field_as_i32(field)
                                    .map(|v| v as f64 * SEMICIRCLES_TO_DEGREES);
                            }
                            "position_long" => {
                                lon = field_as_i32(field)
                                    .map(|v| v as f64 * SEMICIRCLES_TO_DEGREES);
                            }
                            // Prefer enhanced_altitude (higher resolution) over altitude.
                            "enhanced_altitude" => {
                                altitude_m = field_as_f64(field).map(|v| v as f32);
                            }
                            "altitude" => {
                                if altitude_m.is_none() {
                                    altitude_m = field_as_f64(field).map(|v| v as f32);
                                }
                            }
                            // Prefer enhanced_speed over speed.
                            "enhanced_speed" => {
                                speed_ms = field_as_f64(field).map(|v| v as f32);
                            }
                            "speed" => {
                                if speed_ms.is_none() {
                                    speed_ms = field_as_f64(field).map(|v| v as f32);
                                }
                            }
                            "heart_rate" => {
                                heart_rate = field_as_u8(field);
                            }
                            "cadence" => {
                                cadence = field_as_u8(field);
                            }
                            "power" => {
                                power = field_as_u16(field);
                            }
                            "distance" => {
                                distance_m = field_as_f64(field).map(|v| v as f32);
                            }
                            _ => {}
                        }
                    }

                    if let Some(dt) = timestamp_opt {
                        // Set base timestamp from the very first Record.
                        let base = *base_timestamp.get_or_insert(dt);

                        // Compute elapsed milliseconds from session start.
                        let timestamp_ms = dt
                            .signed_duration_since(base)
                            .num_milliseconds()
                            .max(0) as u64;

                        points.push(TelemetryPoint {
                            timestamp_ms,
                            lat,
                            lon,
                            altitude_m,
                            speed_ms,
                            heart_rate,
                            cadence,
                            power,
                            distance_m,
                        });
                    }
                }

                _ => {}
            }
        }

        if points.is_empty() {
            return Err(ParseError::FitParse(
                "No data records found in FIT file".to_string(),
            ));
        }

        // Use session start_time if found; fall back to first Record timestamp.
        let recorded_start_time = session_start_time.or(base_timestamp);

        Ok(TelemetrySession {
            source_file: path.to_path_buf(),
            recorded_start_time,
            points,
        })
    }
}

// ---------------------------------------------------------------------------
// Value extraction helpers
// ---------------------------------------------------------------------------
// fitparser returns values as a Value enum. These helpers extract a specific
// numeric type, handling all the integer/float variants that could represent
// a given field.

fn field_as_f64(field: &fitparser::FitDataField) -> Option<f64> {
    match field.value() {
        Value::Float64(v) => Some(*v),
        Value::Float32(v) => Some(*v as f64),
        Value::UInt8(v) => Some(*v as f64),
        Value::UInt16(v) => Some(*v as f64),
        Value::UInt32(v) => Some(*v as f64),
        Value::UInt64(v) => Some(*v as f64),
        Value::SInt8(v) => Some(*v as f64),
        Value::SInt16(v) => Some(*v as f64),
        Value::SInt32(v) => Some(*v as f64),
        Value::SInt64(v) => Some(*v as f64),
        _ => None,
    }
}

fn field_as_i32(field: &fitparser::FitDataField) -> Option<i32> {
    match field.value() {
        Value::SInt32(v) => Some(*v),
        Value::SInt16(v) => Some(*v as i32),
        _ => None,
    }
}

fn field_as_u8(field: &fitparser::FitDataField) -> Option<u8> {
    match field.value() {
        Value::UInt8(v) => Some(*v),
        Value::UInt16(v) => u8::try_from(*v).ok(),
        _ => None,
    }
}

fn field_as_u16(field: &fitparser::FitDataField) -> Option<u16> {
    match field.value() {
        Value::UInt16(v) => Some(*v),
        Value::UInt8(v) => Some(*v as u16),
        _ => None,
    }
}
