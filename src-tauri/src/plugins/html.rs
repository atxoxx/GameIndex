//! CSS-selector HTML extraction for the plugin sandbox.
//!
//! Plugins that scrape a store page need structured nodes, not raw
//! markup: `parseHtml` hands back `{ text, html, attrs }` per match so
//! a plugin can read a price or a download link without embedding an
//! HTML parser. `scraper` is already in the tree, so this stays a thin
//! adapter over it.

use serde_json::{Map, Value};

/// Select up to `limit` nodes matching `selector` and describe each as
/// `{ text, html, attrs }`.
///
/// `text` is the node's concatenated text content, `html` its inner
/// markup, and `attrs` a name→value map of its attributes. An invalid
/// selector returns an ordinary error (plugins should surface it as a
/// thrown JS exception).
pub fn query(html: &str, selector: &str, limit: usize) -> Result<Value, String> {
    let document = scraper::Html::parse_document(html);
    let parsed = scraper::Selector::parse(selector)
        .map_err(|e| format!("parseHtml: invalid selector {selector:?}: {e:?}"))?;

    let mut out: Vec<Value> = Vec::new();
    for element in document.select(&parsed).take(limit) {
        let text = element.text().collect::<String>();

        let mut attrs = Map::new();
        for (name, value) in element.value().attrs() {
            attrs.insert(name.to_string(), Value::String(value.to_string()));
        }

        let mut node = Map::new();
        node.insert("text".to_string(), Value::String(text));
        node.insert("html".to_string(), Value::String(element.html()));
        node.insert("attrs".to_string(), Value::Object(attrs));
        out.push(Value::Object(node));
    }

    Ok(Value::Array(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = r#"
        <html><body>
          <a class="dl" href="https://example.com/one" data-id="1">First</a>
          <a class="dl" href="https://example.com/two">Second</a>
          <a class="other" href="https://example.com/three">Third</a>
        </body></html>
    "#;

    #[test]
    fn selector_returns_matching_nodes() {
        let value = query(PAGE, "a.dl", 100).expect("query");
        let nodes = value.as_array().expect("array");
        assert_eq!(nodes.len(), 2);

        assert_eq!(nodes[0]["text"], "First");
        assert_eq!(nodes[0]["attrs"]["href"], "https://example.com/one");
        assert_eq!(nodes[0]["attrs"]["data-id"], "1");
        assert!(nodes[0]["html"].as_str().unwrap().contains("First"));

        assert_eq!(nodes[1]["text"], "Second");
        assert_eq!(nodes[1]["attrs"]["href"], "https://example.com/two");
    }

    #[test]
    fn limit_caps_results() {
        let value = query(PAGE, "a", 1).expect("query");
        assert_eq!(value.as_array().expect("array").len(), 1);
    }

    #[test]
    fn invalid_selector_is_an_error() {
        let err = query(PAGE, "a[", 10).unwrap_err();
        assert!(err.contains("invalid selector"), "unexpected: {err}");
    }
}
