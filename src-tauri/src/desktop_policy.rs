//! Renderer lifetime policy. All deadlines are monotonic and owned by the tray.
use std::time::{Duration, Instant};

pub const HIDDEN_LIFETIME: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Default)]
pub struct Lifetime {
    hidden_since: Option<Instant>,
    pending: Option<u64>,
    pending_since: Option<Instant>,
    next_token: u64,
    pub exiting: bool,
}
impl Lifetime {
    pub fn shown(&mut self) {
        self.hidden_since = None;
        self.pending = None;
        self.pending_since = None;
        self.exiting = false;
    }
    pub fn hidden(&mut self, now: Instant) {
        // Repeated signals (and background deliveries) must not extend the timer.
        self.hidden_since.get_or_insert(now);
    }
    pub fn is_hidden(&self) -> bool {
        self.hidden_since.is_some()
    }
    pub fn poll(&mut self, now: Instant, lifetime: Duration) -> Option<u64> {
        if self.exiting || self.pending.is_some() {
            return None;
        }
        if now.duration_since(self.hidden_since?) < lifetime {
            return None;
        }
        self.next_token += 1;
        self.pending = Some(self.next_token);
        self.pending_since = Some(now);
        self.pending
    }
    pub fn checkpoint_timed_out(&mut self, now: Instant) -> bool {
        if let (Some(token), Some(started)) = (self.pending, self.pending_since)
            && now.duration_since(started) >= Duration::from_secs(10)
        {
            self.failed(token);
            return true;
        }
        false
    }
    pub fn acknowledge(&mut self, token: u64) -> bool {
        if self.pending == Some(token) && self.is_hidden() && !self.exiting {
            self.pending = None;
            self.pending_since = None;
            self.exiting = true;
            true
        } else {
            false
        }
    }
    pub fn failed(&mut self, token: u64) {
        if self.pending == Some(token) {
            // Do not retry destructive disposal behind the user's back. A later
            // show/hide starts a fresh window; the live renderer remains intact.
            self.pending = None;
            self.pending_since = None;
            self.hidden_since = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn thirty_continuous_hidden_minutes_require_a_checkpoint_ack() {
        let now = Instant::now();
        let mut policy = Lifetime::default();
        assert_eq!(policy.poll(now + HIDDEN_LIFETIME, HIDDEN_LIFETIME), None);
        policy.hidden(now);
        policy.hidden(now + Duration::from_secs(60));
        assert_eq!(
            policy.poll(
                now + HIDDEN_LIFETIME - Duration::from_millis(1),
                HIDDEN_LIFETIME
            ),
            None
        );
        let token = policy.poll(now + HIDDEN_LIFETIME, HIDDEN_LIFETIME).unwrap();
        assert!(!policy.exiting);
        assert_eq!(policy.poll(now + HIDDEN_LIFETIME, HIDDEN_LIFETIME), None);
        assert!(!policy.acknowledge(token + 1));
        assert!(policy.acknowledge(token));
        assert!(policy.exiting);
    }
    #[test]
    fn showing_cancels_the_timer_and_invalidates_a_late_checkpoint() {
        let now = Instant::now();
        let mut policy = Lifetime::default();
        policy.hidden(now);
        let token = policy.poll(now + HIDDEN_LIFETIME, HIDDEN_LIFETIME).unwrap();
        policy.shown();
        assert!(!policy.acknowledge(token));
        assert_eq!(
            policy.poll(now + HIDDEN_LIFETIME * 2, HIDDEN_LIFETIME),
            None
        );
        policy.hidden(now + HIDDEN_LIFETIME * 2);
        let next = policy
            .poll(now + HIDDEN_LIFETIME * 3, HIDDEN_LIFETIME)
            .unwrap();
        assert_ne!(next, token);
        assert!(policy.acknowledge(next));
    }
    #[test]
    fn local_reopen_can_cancel_an_acknowledged_but_not_yet_executed_exit() {
        let now = Instant::now();
        let mut policy = Lifetime::default();
        policy.hidden(now);
        let token = policy.poll(now + HIDDEN_LIFETIME, HIDDEN_LIFETIME).unwrap();
        assert!(policy.acknowledge(token));
        policy.shown();
        assert!(!policy.exiting);
        assert!(!policy.acknowledge(token));
        policy.hidden(now + HIDDEN_LIFETIME);
        assert!(
            policy
                .poll(now + HIDDEN_LIFETIME * 2, HIDDEN_LIFETIME)
                .is_some()
        );
    }
    #[test]
    fn missing_checkpoint_ack_keeps_the_renderer_and_rejects_late_exit() {
        let now = Instant::now();
        let mut policy = Lifetime::default();
        policy.hidden(now);
        let token = policy.poll(now + HIDDEN_LIFETIME, HIDDEN_LIFETIME).unwrap();
        assert!(!policy.checkpoint_timed_out(now + HIDDEN_LIFETIME + Duration::from_secs(9)));
        assert!(policy.checkpoint_timed_out(now + HIDDEN_LIFETIME + Duration::from_secs(10)));
        assert!(!policy.exiting);
        assert!(!policy.acknowledge(token));
    }
    #[test]
    fn checkpoint_failure_preserves_renderer_and_stops_automatic_disposal() {
        let now = Instant::now();
        let mut policy = Lifetime::default();
        policy.hidden(now);
        let token = policy.poll(now + HIDDEN_LIFETIME, HIDDEN_LIFETIME).unwrap();
        policy.failed(token);
        assert!(!policy.exiting);
        assert!(!policy.acknowledge(token));
        assert_eq!(
            policy.poll(now + HIDDEN_LIFETIME * 10, HIDDEN_LIFETIME),
            None
        );
    }
}
