//! Stealth fetch engine for imperium-crawl.
//!
//! Three-level escalation:
//! - **L1 Headers** — native HTTP via reqwest + realistic browser headers
//! - **L2 TLS**     — wreq/BoringSSL with Chrome JA3/JA4 fingerprint
//! - **L3 Browser** — delegated to `imperium-crawl-browser` (chromiumoxide) — Sprint 4
//!
//! Anti-bot detection signals trigger automatic escalation L1 → L2 → L3.

pub mod detector;
pub mod escalation;
pub mod headers;
pub mod proxy;
pub mod tls;

pub use detector::{AntiBotDetector, AntiBotSignal};
pub use escalation::{StealthClient, StealthOptions};
pub use headers::{header_map_for_url, random_chrome_emulation, random_profile, HeaderProfile};
pub use proxy::{parse_proxy_url, ParsedProxy, ProxyPool};
pub use tls::TlsClient;
