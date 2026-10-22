//! A bounded slide-reveal when the outstanding inbox count changes. No idle
//! animation: once settled, the controller goes back to its normal wait budget.
use std::time::{Duration, Instant};
use tauri::image::Image;

const SLIDE: Duration = Duration::from_millis(280);
const HEIGHT: u32 = 48;
const GLYPH: u32 = 28;

#[derive(Default)]
pub struct TrayIndicator {
    count: usize,
    from: f64,
    to: f64,
    started: Option<Instant>,
    rendered: Option<(u32, usize, bool)>,
}
impl TrayIndicator {
    pub fn set_count(&mut self, count: usize, now: Instant) {
        if self.count == count {
            return;
        }
        self.from = self.width(now);
        self.to = if count == 0 {
            48.0
        } else {
            56.0 + count.to_string().len() as f64 * f64::from(GLYPH)
        };
        self.count = count;
        self.started = Some(now);
    }
    fn width(&self, now: Instant) -> f64 {
        let Some(started) = self.started else {
            return self.to.max(48.0);
        };
        let t =
            (now.saturating_duration_since(started).as_secs_f64() / SLIDE.as_secs_f64()).min(1.0);
        self.from + (self.to - self.from) * (1.0 - (1.0 - t).powi(3))
    }
    pub fn animating(&self) -> bool {
        self.started.is_some()
    }
    pub fn frame(&mut self, attention: bool, now: Instant) -> Option<Image<'static>> {
        let width = self.width(now).round() as u32;
        if self
            .started
            .is_some_and(|started| now.saturating_duration_since(started) >= SLIDE)
        {
            self.started = None;
        }
        let key = (width, self.count, attention);
        if self.rendered == Some(key) {
            return None;
        }
        self.rendered = Some(key);
        Some(render(width, self.count, attention))
    }
}
fn render(width: u32, count: usize, attention: bool) -> Image<'static> {
    let bird = if attention {
        tauri::include_image!("icons/tray-macos-attention.png")
    } else {
        tauri::include_image!("icons/tray-template.png")
    };
    let digits = if attention {
        tauri::include_image!("icons/tray-digits-attention.png")
    } else {
        tauri::include_image!("icons/tray-digits.png")
    };
    let mut rgba = vec![0; (width * HEIGHT * 4) as usize];
    for y in 0..HEIGHT {
        for x in 0..width {
            let pixel = if x < HEIGHT {
                let start = ((y * HEIGHT + x) * 4) as usize;
                &bird.rgba()[start..start + 4]
            } else {
                &[0, 0, 0, 0]
            };
            let start = ((y * width + x) * 4) as usize;
            rgba[start..start + 4].copy_from_slice(pixel);
        }
    }
    if count > 0 {
        for (index, digit) in count.to_string().bytes().enumerate() {
            let left = 56 + index as u32 * GLYPH;
            for y in 0..HEIGHT {
                for x in 0..GLYPH {
                    if left + x >= width {
                        break;
                    }
                    let src =
                        ((y * digits.width() + u32::from(digit - b'0') * GLYPH + x) * 4) as usize;
                    let dst = ((y * width + left + x) * 4) as usize;
                    rgba[dst..dst + 4].copy_from_slice(&digits.rgba()[src..src + 4]);
                }
            }
        }
    }
    Image::new_owned(rgba, width, HEIGHT)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn icon_open_paths_do_not_acquire_default_black_fills() {
        let icon = tauri::include_image!("icons/icon.png");
        let pixel = |x: u32, y: u32| {
            let offset =
                ((y * icon.height() / 512 * icon.width() + x * icon.width() / 512) * 4) as usize;
            &icon.rgba()[offset..offset + 4]
        };
        assert_eq!(pixel(0, 0)[3], 0, "keep the outer corners transparent");
        for (x, y) in [(421, 188), (179, 387)] {
            assert!(
                pixel(x, y)[..3].iter().all(|channel| *channel > 230),
                "beak/leg stroke interiors must stay unfilled"
            );
        }
    }
    #[test]
    fn count_reveals_then_settles_without_an_idle_timer() {
        let now = Instant::now();
        let mut indicator = TrayIndicator::default();
        assert_eq!(indicator.frame(false, now).unwrap().width(), 48);
        indicator.set_count(3, now);
        assert!(indicator.animating());
        let middle = indicator.frame(false, now + SLIDE / 2).unwrap();
        assert!(middle.width() > 48 && middle.width() < 84);
        let end = indicator.frame(false, now + SLIDE).unwrap();
        assert_eq!(end.width(), 84);
        assert!(!indicator.animating());
        assert!(indicator.frame(false, now + SLIDE * 2).is_none());
        indicator.set_count(12, now + SLIDE * 2);
        assert_eq!(
            indicator.frame(false, now + SLIDE * 3).unwrap().width(),
            112
        );
        indicator.set_count(0, now + SLIDE * 3);
        assert_eq!(indicator.frame(false, now + SLIDE * 4).unwrap().width(), 48);
        assert!(!indicator.animating());
    }
    #[test]
    fn count_survives_acknowledgement_and_glyphs_are_visible() {
        let now = Instant::now();
        let mut indicator = TrayIndicator::default();
        indicator.set_count(27, now);
        indicator.frame(true, now + SLIDE);
        let frame = indicator.frame(false, now + SLIDE).unwrap();
        assert_eq!(frame.width(), 112);
        assert!(
            frame
                .rgba()
                .chunks_exact(4)
                .enumerate()
                .any(|(i, p)| i % 112 >= 56 && p[3] > 128)
        );
        assert!(!indicator.animating());
    }
}
