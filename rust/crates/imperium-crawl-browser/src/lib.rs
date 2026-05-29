//! L3 stealth: headless browser via chromiumoxide. L4: CamoFox subprocess.
//!
//! Port of `../../src/stealth/browser.ts`, `browser-pool.ts`,
//! `chrome-profile.ts`, and `../../src/core/action-executor.ts`. Anti-
//! detection JS is injected via `Page.addScriptToEvaluateOnNewDocument`.

#[cfg(feature = "browser")]
pub mod actions;
#[cfg(feature = "browser")]
pub mod browser;
#[cfg(feature = "camofox")]
pub mod camofox;
#[cfg(feature = "browser")]
pub mod pool;
#[cfg(feature = "browser")]
pub mod profile;

#[cfg(feature = "browser")]
pub use actions::{Action, ActionExecutor, ActionResult, ScrollDirection};
#[cfg(feature = "browser")]
pub use browser::{BrowserClient, BrowserOptions};
#[cfg(feature = "camofox")]
pub use camofox::CamoFoxClient;
#[cfg(feature = "browser")]
pub use pool::{BrowserPool, PooledBrowser};
#[cfg(feature = "browser")]
pub use profile::ChromeProfile;
