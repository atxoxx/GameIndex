//! Wine, Proton, and Linux compatibility layer runner and environment tools.
//!
//! Covers runner detection/installation (Proton, Wine-GE, …), anticheat
//! runtimes, GPU selection, the Steam launch environment, Wine prefix
//! management, and the Wine/Proton launch path. Public items are re-exported
//! here so `crate::compatibility::Foo` keeps resolving across the app.

mod anticheat;
mod env;
mod gpu;
mod launch;
mod paths;
mod prefixes;
mod proton;
mod runners;
mod settings;
mod steam;
mod types;
mod wine;

#[cfg(test)]
mod tests;

pub use self::anticheat::*;
pub use self::gpu::*;
pub use self::launch::*;
pub use self::paths::*;
pub use self::prefixes::*;
pub use self::proton::*;
pub use self::runners::*;
pub use self::settings::*;
pub use self::steam::*;
pub use self::types::*;
pub use self::wine::*;
