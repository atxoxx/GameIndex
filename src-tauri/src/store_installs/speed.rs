//! Throughput and ETA for transfers nobody reports a speed for.
//!
//! Both stores publish a byte counter, never a rate, so speed is derived
//! from how far the counter moved between two polls. That makes the value
//! only as good as the polling cadence, and raw deltas flicker badly at
//! 2 s resolution — a 70/30 exponential average keeps the number steady
//! without making a genuine stall invisible.

use std::time::Duration;

/// Exponential smoothing weight given to the newest sample.
const NEW_SAMPLE_WEIGHT: f64 = 0.3;

#[derive(Debug, Default, Clone)]
pub struct TransferSpeed {
    last_bytes: u64,
    smoothed: Option<f64>,
}

impl TransferSpeed {
    /// Seed the tracker without producing a reading. Called on the first
    /// sight of a transfer, where a delta against zero would report the
    /// whole downloaded size as one tick's worth of speed.
    pub fn seed(&mut self, bytes: u64) {
        self.last_bytes = bytes;
        self.smoothed = None;
    }

    /// Feed the current byte count and the time since the previous feed.
    /// Returns the smoothed bytes/second, or `None` while nothing has
    /// moved yet.
    pub fn observe(&mut self, bytes: u64, elapsed: Duration) -> Option<f64> {
        let moved = bytes.saturating_sub(self.last_bytes);
        if moved == 0 {
            // A flat tick is either a stalled transfer or the gap between
            // a download finishing and staging starting; keep the last
            // reading rather than decaying to zero on every quiet tick.
            return self.smoothed;
        }

        let millis = elapsed.as_millis().max(1) as f64;
        let instant = (moved as f64) * 1000.0 / millis;
        self.smoothed = Some(match self.smoothed {
            Some(prev) => prev * (1.0 - NEW_SAMPLE_WEIGHT) + instant * NEW_SAMPLE_WEIGHT,
            None => instant,
        });
        self.last_bytes = bytes;
        self.smoothed
    }

    /// Whole seconds left at the current smoothed rate.
    pub fn eta(&self, total: u64, done: u64) -> Option<u64> {
        let remaining = total.saturating_sub(done) as f64;
        match self.smoothed {
            Some(speed) if speed > 1.0 => Some((remaining / speed).round() as u64),
            _ => None,
        }
    }

    /// Last smoothed reading, for a tick that had nothing new to say.
    pub fn rate(&self) -> Option<f64> {
        self.smoothed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_then_first_moving_tick_reports_instant_rate() {
        let mut s = TransferSpeed::default();
        s.seed(1_000);
        let speed = s.observe(3_000, Duration::from_secs(2)).unwrap();
        assert!((speed - 1_000.0).abs() < 0.01);
    }

    #[test]
    fn second_tick_is_smoothed_not_replaced() {
        let mut s = TransferSpeed::default();
        s.seed(0);
        s.observe(2_000, Duration::from_secs(2)); // 1000 B/s
        let speed = s.observe(10_000, Duration::from_secs(2)).unwrap(); // instant 4000 B/s
        assert!((speed - 1_900.0).abs() < 0.01);
    }

    #[test]
    fn flat_tick_holds_the_previous_reading() {
        let mut s = TransferSpeed::default();
        s.seed(0);
        let first = s.observe(2_000, Duration::from_secs(2)).unwrap();
        let flat = s.observe(2_000, Duration::from_secs(2)).unwrap();
        assert_eq!(flat, first);
    }

    #[test]
    fn zero_elapsed_does_not_divide_by_zero() {
        let mut s = TransferSpeed::default();
        s.seed(0);
        let speed = s.observe(1_000, Duration::from_millis(0)).unwrap();
        assert!(speed.is_finite());
    }

    #[test]
    fn eta_uses_remaining_bytes_over_rate() {
        let mut s = TransferSpeed::default();
        s.seed(0);
        s.observe(1_000, Duration::from_secs(1)); // 1000 B/s
        assert_eq!(s.eta(11_000, 1_000), Some(10));
    }

    #[test]
    fn eta_is_none_without_a_reading() {
        let s = TransferSpeed::default();
        assert_eq!(s.eta(10_000, 0), None);
        assert_eq!(s.rate(), None);
    }
}
