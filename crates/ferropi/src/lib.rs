//! Local Ferropi broker. Initial transport targets macOS/Linux; Pi RPC is portable.
#[cfg(unix)]
mod local;
#[cfg(unix)]
pub use local::*;
