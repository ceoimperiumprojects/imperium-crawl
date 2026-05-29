//! imperium-crawl CLI entry point. Sprint 16.
//!
//! Dynamic tool registration: reads `imperium_crawl_tools::build_registry()`
//! and exposes each tool either:
//! - directly via `imperium-crawl <tool-name> <json-args>`, or
//! - through one of the convenience subcommands (`tools`, `run`, `schema`).

use anyhow::{anyhow, Context, Result};
use clap::{Parser, Subcommand};
use imperium_crawl_core::Config;
use imperium_crawl_tools::build_registry;
use owo_colors::OwoColorize;
use std::io::IsTerminal;

#[derive(Debug, Parser)]
#[command(
    name = "imperium-crawl",
    version,
    about = "Web scraping + automation toolkit (Rust port). Use `imperium-crawl tools` to list available tools."
)]
struct Cli {
    /// Output format: json | pretty | markdown
    #[arg(short, long, global = true, default_value = "pretty")]
    format: String,

    /// Quiet logging
    #[arg(short, long, global = true)]
    quiet: bool,

    /// Verbose logging (debug)
    #[arg(short, long, global = true)]
    verbose: bool,

    #[command(subcommand)]
    cmd: Option<Cmd>,
}

#[derive(Debug, Subcommand)]
enum Cmd {
    /// List all available tools and their descriptions
    Tools,
    /// Show JSON schema for a specific tool
    Schema {
        /// Tool name
        name: String,
    },
    /// Run a tool by name with JSON args.
    /// Example: imperium-crawl run scrape '{"url":"https://example.com"}'
    Run {
        /// Tool name
        name: String,
        /// JSON-encoded args object (or `@file.json` to read from a file).
        #[arg(default_value = "{}")]
        args: String,
    },
    /// Show port progress
    Status,
    /// Quick scrape — equivalent to `run scrape '{"url":"…"}'`
    Scrape {
        url: String,
        #[arg(long, default_value = "markdown")]
        format: String,
        #[arg(long, value_delimiter = ',')]
        include: Vec<String>,
    },
    /// Quick search — Brave Web Search API
    Search {
        query: String,
        #[arg(long, default_value_t = 10)]
        count: u32,
        #[arg(long)]
        country: Option<String>,
        #[arg(long)]
        freshness: Option<String>,
    },
}

#[tokio::main]
async fn main() {
    let exit = match real_main().await {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("{} {:#}", "error:".red().bold(), e);
            1
        }
    };
    std::process::exit(exit);
}

async fn real_main() -> Result<()> {
    let cli = Cli::parse();

    // tracing
    let level = if cli.verbose {
        "debug"
    } else if cli.quiet {
        "warn"
    } else {
        "info"
    };
    let env = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(format!("imperium_crawl={level}")));
    tracing_subscriber::fmt().with_env_filter(env).with_target(false).init();

    // .env first
    let _ = Config::load(); // also pulls .env

    let registry = build_registry();
    let is_tty = std::io::stdout().is_terminal();

    let cmd = cli.cmd.unwrap_or(Cmd::Tools);
    match cmd {
        Cmd::Tools => print_tools(&registry, is_tty),
        Cmd::Schema { name } => {
            let tool = registry
                .get(&name)
                .ok_or_else(|| anyhow!("tool not found: {name}"))?;
            let schema = tool.schema();
            println!("{}", serde_json::to_string_pretty(&schema).context("encode schema")?);
        }
        Cmd::Run { name, args } => {
            let args_value = parse_args_input(&args)?;
            let out = registry
                .execute(&name, args_value)
                .await
                .with_context(|| format!("run {name}"))?;
            print_output(&out, &cli.format, is_tty);
        }
        Cmd::Status => {
            println!("imperium-crawl Rust port v{}", env!("CARGO_PKG_VERSION"));
            println!("Tools registered: {}", registry.len());
            for n in registry.names() {
                println!("  - {n}");
            }
        }
        Cmd::Scrape { url, format, include } => {
            let mut args = serde_json::json!({"url": url, "format": format});
            if !include.is_empty() {
                args["include"] = serde_json::json!(include);
            }
            let out = registry.execute("scrape", args).await.context("scrape")?;
            print_output(&out, &cli.format, is_tty);
        }
        Cmd::Search { query, count, country, freshness } => {
            let mut args = serde_json::json!({"query": query, "count": count});
            if let Some(c) = country {
                args["country"] = serde_json::json!(c);
            }
            if let Some(f) = freshness {
                args["freshness"] = serde_json::json!(f);
            }
            if registry.get("search").is_none() {
                return Err(anyhow!(
                    "search tool not available. Set BRAVE_API_KEY in your env to enable it."
                ));
            }
            let out = registry.execute("search", args).await.context("search")?;
            print_output(&out, &cli.format, is_tty);
        }
    }

    Ok(())
}

fn parse_args_input(input: &str) -> Result<serde_json::Value> {
    let text = if let Some(path) = input.strip_prefix('@') {
        std::fs::read_to_string(path).with_context(|| format!("read {path}"))?
    } else {
        input.to_string()
    };
    serde_json::from_str(&text).context("parse args JSON")
}

fn print_tools(registry: &imperium_crawl_core::ToolRegistry, color: bool) {
    let names = registry.names();
    if names.is_empty() {
        println!("(no tools registered — check API keys in .env)");
        return;
    }
    println!("Tools available: {}", names.len());
    for n in &names {
        if let Some(t) = registry.get(n) {
            let s = t.schema();
            if color {
                println!("  {}  {}", n.bold().cyan(), s.description.dimmed());
            } else {
                println!("  {n:24}  {}", s.description);
            }
        }
    }
}

fn print_output(out: &imperium_crawl_core::ToolOutput, format: &str, color: bool) {
    match format {
        "json" => {
            println!("{}", serde_json::to_string_pretty(&out.data).unwrap_or_default());
        }
        "markdown" => {
            if let Some(s) = out.data.as_str() {
                println!("{s}");
            } else if let Some(s) = out.data.get("markdown").and_then(|v| v.as_str()) {
                println!("{s}");
            } else if let Some(s) = out.data.get("content").and_then(|v| v.as_str()) {
                println!("{s}");
            } else {
                println!("{}", serde_json::to_string_pretty(&out.data).unwrap_or_default());
            }
        }
        _ => {
            // pretty
            if color {
                eprintln!(
                    "{} duration={}ms stealth={:?}",
                    "→".green().bold(),
                    out.meta.duration_ms,
                    out.meta.stealth_level
                );
            }
            println!("{}", serde_json::to_string_pretty(&out.data).unwrap_or_default());
        }
    }
}
