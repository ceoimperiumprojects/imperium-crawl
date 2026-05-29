//! Flow storage — read/write flows from `.yaml`, `.yml`, or `.json` files.

use std::path::{Path, PathBuf};

use imperium_crawl_core::{CrawlError, Result};

use crate::schema::Flow;

/// Filesystem-backed flow store. Stateless — the functions take paths
/// directly and do not require an instance.
pub struct FlowStore;

impl FlowStore {
    /// Load a flow from `path`. The file extension determines the format:
    /// `.yaml`/`.yml` → YAML, `.json` → JSON. Other extensions return an
    /// error.
    pub fn load(path: impl AsRef<Path>) -> Result<Flow> {
        let path = path.as_ref();
        let text = std::fs::read_to_string(path).map_err(CrawlError::from)?;
        match extension(path) {
            Some("yaml") | Some("yml") => Flow::from_yaml(&text),
            Some("json") => Flow::from_json(&text),
            other => Err(CrawlError::InvalidArg(format!(
                "unsupported flow extension '{}' for {}",
                other.unwrap_or(""),
                path.display()
            ))),
        }
    }

    /// Write `flow` to `path`. Extension picks the serializer; `.yaml`/`.yml`
    /// emit YAML, `.json` emits pretty JSON.
    pub fn save(flow: &Flow, path: impl AsRef<Path>) -> Result<()> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(CrawlError::from)?;
            }
        }
        let text = match extension(path) {
            Some("yaml") | Some("yml") | None => flow.to_yaml()?,
            Some("json") => flow.to_json_pretty()?,
            Some(other) => {
                return Err(CrawlError::InvalidArg(format!(
                    "unsupported flow extension '{other}' for {}",
                    path.display()
                )))
            }
        };
        std::fs::write(path, text).map_err(CrawlError::from)?;
        Ok(())
    }

    /// List flow files in `dir`. Returns absolute paths of every file whose
    /// extension is `.yaml`, `.yml`, or `.json`. Non-existent directories
    /// return an empty vec (not an error).
    pub fn list(dir: impl AsRef<Path>) -> Result<Vec<PathBuf>> {
        let dir = dir.as_ref();
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for entry in std::fs::read_dir(dir).map_err(CrawlError::from)? {
            let entry = entry.map_err(CrawlError::from)?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if matches!(extension(&path), Some("yaml") | Some("yml") | Some("json")) {
                out.push(path);
            }
        }
        out.sort();
        Ok(out)
    }
}

fn extension(path: &Path) -> Option<&str> {
    path.extension().and_then(|e| e.to_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::FlowStep;
    use serde_json::Map;
    use tempfile::TempDir;

    fn sample_flow() -> Flow {
        Flow {
            name: "demo".into(),
            description: Some("storage roundtrip".into()),
            version: 1,
            vars: Map::new(),
            steps: vec![FlowStep {
                id: Some("s1".into()),
                tool: "scrape".into(),
                args: serde_json::json!({"url": "https://example.com"}),
                output_var: Some("page".into()),
                expect: None,
                retry: 0,
            }],
        }
    }

    #[test]
    fn roundtrip_yaml() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("demo.yaml");
        let flow = sample_flow();
        FlowStore::save(&flow, &path).expect("save");
        let loaded = FlowStore::load(&path).expect("load");
        assert_eq!(loaded, flow);
    }

    #[test]
    fn roundtrip_json() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("demo.json");
        let flow = sample_flow();
        FlowStore::save(&flow, &path).expect("save");
        let loaded = FlowStore::load(&path).expect("load");
        assert_eq!(loaded, flow);
    }

    #[test]
    fn list_returns_only_flow_files() {
        let dir = TempDir::new().unwrap();
        let flow = sample_flow();
        FlowStore::save(&flow, dir.path().join("a.yaml")).unwrap();
        FlowStore::save(&flow, dir.path().join("b.json")).unwrap();
        // Unrelated file should be ignored.
        std::fs::write(dir.path().join("readme.txt"), "ignore me").unwrap();
        let mut listed = FlowStore::list(dir.path()).unwrap();
        listed.sort();
        let names: Vec<_> = listed
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["a.yaml", "b.json"]);
    }

    #[test]
    fn list_missing_dir_returns_empty() {
        let path = std::path::Path::new("/tmp/imperium-crawl-doesnt-exist-xyz");
        let out = FlowStore::list(path).unwrap();
        assert!(out.is_empty());
    }
}
