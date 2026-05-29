//! Concurrent browser pool.
//!
//! Port of `../../src/stealth/browser-pool.ts`. Strategy:
//!
//! - Up to `max_size` long-lived [`BrowserClient`] entries.
//! - Acquire returns a [`PooledBrowser`] guard that releases the underlying
//!   client back to the pool on drop.
//! - Concurrency is capped by a `tokio::sync::Semaphore` keyed off
//!   `max_size`; if all permits are taken, callers wait.
//! - Idle browsers older than `idle_timeout` are evicted by a background
//!   reaper task. (Drop the [`BrowserPool`] to stop the reaper.)

use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};
use tokio::task::JoinHandle;

use imperium_crawl_core::constants::{
    DEFAULT_BROWSER_IDLE_TIMEOUT_MS, DEFAULT_BROWSER_POOL_SIZE,
};
use imperium_crawl_core::{CrawlError, FetchResult, Result};

use crate::browser::{BrowserClient, BrowserOptions};

struct PoolEntry {
    client: BrowserClient,
    last_used: Instant,
}

#[derive(Default)]
struct PoolInner {
    entries: Vec<PoolEntry>,
}

pub struct BrowserPool {
    max_size: usize,
    idle_timeout: Duration,
    options: BrowserOptions,
    inner: Arc<Mutex<PoolInner>>,
    semaphore: Arc<Semaphore>,
    reaper: Mutex<Option<JoinHandle<()>>>,
}

impl std::fmt::Debug for BrowserPool {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BrowserPool")
            .field("max_size", &self.max_size)
            .field("idle_timeout_ms", &self.idle_timeout.as_millis())
            .finish()
    }
}

impl BrowserPool {
    /// Create a new pool. `max_size = 0` falls back to
    /// `DEFAULT_BROWSER_POOL_SIZE`.
    pub fn new(max_size: usize) -> Self {
        Self::with_options(max_size, BrowserOptions::headless_new())
    }

    pub fn with_options(max_size: usize, options: BrowserOptions) -> Self {
        let size = if max_size == 0 { DEFAULT_BROWSER_POOL_SIZE } else { max_size };
        let idle_timeout = Duration::from_millis(DEFAULT_BROWSER_IDLE_TIMEOUT_MS);
        let inner = Arc::new(Mutex::new(PoolInner::default()));
        let semaphore = Arc::new(Semaphore::new(size));

        let pool = Self {
            max_size: size,
            idle_timeout,
            options,
            inner: Arc::clone(&inner),
            semaphore,
            reaper: Mutex::new(None),
        };
        pool.start_reaper();
        pool
    }

    fn start_reaper(&self) {
        let inner = Arc::clone(&self.inner);
        let timeout = self.idle_timeout;
        let handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                let mut guard = inner.lock().await;
                let now = Instant::now();
                let mut keep: Vec<PoolEntry> = Vec::with_capacity(guard.entries.len());
                let drained: Vec<PoolEntry> = std::mem::take(&mut guard.entries);
                for entry in drained {
                    if now.duration_since(entry.last_used) > timeout {
                        // Drop the client (Chrome process tears down).
                        drop(entry);
                    } else {
                        keep.push(entry);
                    }
                }
                guard.entries = keep;
            }
        });
        // Attach the handle without blocking — try_lock here is safe because
        // we just constructed the pool and no one else has a reference.
        if let Ok(mut slot) = self.reaper.try_lock() {
            *slot = Some(handle);
        }
    }

    /// Acquire a browser from the pool. Waits for an available semaphore
    /// permit if all slots are busy.
    pub async fn acquire(&self) -> Result<PooledBrowser> {
        let permit = Arc::clone(&self.semaphore)
            .acquire_owned()
            .await
            .map_err(|e| CrawlError::Browser(format!("semaphore closed: {e}")))?;

        // Try to reuse an idle entry first.
        let mut guard = self.inner.lock().await;
        if let Some(entry) = guard.entries.pop() {
            drop(guard);
            return Ok(PooledBrowser {
                client: Some(entry.client),
                inner: Arc::clone(&self.inner),
                _permit: permit,
            });
        }
        drop(guard);

        // No idle entry — launch a fresh one.
        let client = BrowserClient::new(self.options.clone()).await?;
        Ok(PooledBrowser {
            client: Some(client),
            inner: Arc::clone(&self.inner),
            _permit: permit,
        })
    }

    /// Convenience: acquire + fetch + release.
    pub async fn fetch(&self, url: &str) -> Result<FetchResult> {
        let guard = self.acquire().await?;
        let client = guard.client.as_ref().expect("acquired client");
        client.fetch(url).await
    }

    pub fn max_size(&self) -> usize {
        self.max_size
    }

    /// Current snapshot — `(idle_count, busy_count)`.
    pub async fn stats(&self) -> (usize, usize) {
        let guard = self.inner.lock().await;
        let idle = guard.entries.len();
        let busy = self.max_size - self.semaphore.available_permits();
        (idle, busy)
    }

    /// Close all browsers. After this, the pool is unusable.
    pub async fn close_all(&self) -> Result<()> {
        let mut guard = self.inner.lock().await;
        let entries: Vec<PoolEntry> = std::mem::take(&mut guard.entries);
        drop(guard);
        for entry in entries {
            let _ = entry.client.close().await;
        }
        if let Some(reaper) = self.reaper.lock().await.take() {
            reaper.abort();
        }
        Ok(())
    }
}

impl Drop for BrowserPool {
    fn drop(&mut self) {
        if let Ok(mut slot) = self.reaper.try_lock() {
            if let Some(task) = slot.take() {
                task.abort();
            }
        }
    }
}

/// Guard returned by [`BrowserPool::acquire`]. Returning the inner client to
/// the pool happens on drop, which is synchronous; we therefore stash the
/// client back without awaiting (the entry is reusable immediately).
pub struct PooledBrowser {
    client: Option<BrowserClient>,
    inner: Arc<Mutex<PoolInner>>,
    _permit: OwnedSemaphorePermit,
}

impl PooledBrowser {
    /// Borrow the underlying [`BrowserClient`].
    pub fn client(&self) -> &BrowserClient {
        self.client.as_ref().expect("PooledBrowser used after drop")
    }
}

impl std::ops::Deref for PooledBrowser {
    type Target = BrowserClient;
    fn deref(&self) -> &Self::Target {
        self.client()
    }
}

impl Drop for PooledBrowser {
    fn drop(&mut self) {
        if let Some(client) = self.client.take() {
            let inner = Arc::clone(&self.inner);
            // We cannot await in Drop — schedule a tokio task. If no
            // runtime is available (e.g. drop happens after shutdown), just
            // discard the client.
            if let Ok(handle) = tokio::runtime::Handle::try_current() {
                handle.spawn(async move {
                    let mut guard = inner.lock().await;
                    guard.entries.push(PoolEntry { client, last_used: Instant::now() });
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn defaults_apply_when_size_zero() {
        let pool = BrowserPool::new(0);
        assert_eq!(pool.max_size(), DEFAULT_BROWSER_POOL_SIZE);
    }

    #[tokio::test]
    async fn stats_starts_empty() {
        let pool = BrowserPool::new(2);
        let (idle, busy) = pool.stats().await;
        assert_eq!(idle, 0);
        assert_eq!(busy, 0);
    }
}
