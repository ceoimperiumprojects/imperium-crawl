//! HTML → Markdown conversion. Equivalent to TS `utils/markdown.ts`.

use html2md::parse_html;

/// Convert HTML to Markdown using `html2md`. Preserves links and headings.
pub fn html_to_markdown(html: &str) -> String {
    parse_html(html)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_basic_html() {
        let md = html_to_markdown("<h1>Hello</h1><p>World</p>");
        assert!(md.contains("Hello"));
        assert!(md.contains("World"));
    }

    #[test]
    fn preserves_links() {
        let md = html_to_markdown(r#"<a href="https://example.com">Example</a>"#);
        assert!(md.contains("Example"));
        assert!(md.contains("example.com"));
    }
}
