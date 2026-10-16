//! Closed HTML/SVG vocabulary for device-local Articles. An HTML5 sanitizer
//! removes executable content before a definition enters the encrypted store.

use crate::error::{AppError, AppResult};
use ammonia::{Builder, UrlRelative};
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};

const HTML_TAGS: &[&str] = &[
    "p",
    "h2",
    "h3",
    "h4",
    "blockquote",
    "ul",
    "ol",
    "li",
    "strong",
    "em",
    "code",
    "pre",
    "a",
    "hr",
    "br",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "section",
    "aside",
    "div",
    "span",
    "figure",
    "figcaption",
    "caption",
    "dl",
    "dt",
    "dd",
];
const SVG_TAGS: &[&str] = &[
    "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text",
    "tspan", "title", "desc",
];
const SVG_ATTRIBUTES: &[&str] = &[
    "viewBox",
    "viewbox",
    "xmlns",
    "role",
    "aria-label",
    "x",
    "y",
    "x1",
    "x2",
    "y1",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "width",
    "height",
    "d",
    "points",
    "fill",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "font-size",
    "font-weight",
    "text-anchor",
    "dominant-baseline",
];

fn number(value: &str) -> bool {
    value
        .parse::<f64>()
        .is_ok_and(|value| value.is_finite() && value.abs() <= 100_000.0)
}

fn safe_attribute<'a>(tag: &str, name: &str, value: &'a str) -> Option<Cow<'a, str>> {
    if tag == "a" && name == "href" && value.starts_with("//") {
        return None;
    }
    if !SVG_TAGS.contains(&tag) || name == "class" {
        return Some(Cow::Borrowed(value));
    }
    let safe = match name {
        "viewBox" | "viewbox" => {
            let values = value
                .split(|c: char| c.is_whitespace() || c == ',')
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>();
            values.len() == 4
                && values.iter().all(|part| number(part))
                && values[2].parse::<f64>().is_ok_and(|n| n > 0.0)
                && values[3].parse::<f64>().is_ok_and(|n| n > 0.0)
        }
        "xmlns" => value == "http://www.w3.org/2000/svg",
        "role" => value == "img",
        "aria-label" => value.chars().count() <= 500,
        "fill" | "stroke" => {
            value == "none"
                || value == "currentColor"
                || value.strip_prefix('#').is_some_and(|hex| {
                    matches!(hex.len(), 3 | 6 | 8)
                        && hex.bytes().all(|byte| byte.is_ascii_hexdigit())
                })
        }
        "d" => {
            value.len() <= 100_000
                && value.chars().all(|c| {
                    c.is_ascii_digit()
                        || c.is_ascii_whitespace()
                        || "mlhvcsqtazMLHVCSQTAZeE.,+-".contains(c)
                })
        }
        "points" => {
            value.len() <= 100_000
                && value
                    .chars()
                    .all(|c| c.is_ascii_digit() || c.is_ascii_whitespace() || "eE.,+-".contains(c))
        }
        "text-anchor" => matches!(value, "start" | "middle" | "end"),
        "dominant-baseline" => matches!(value, "auto" | "middle" | "central" | "hanging"),
        "stroke-linecap" => matches!(value, "butt" | "round" | "square"),
        "stroke-linejoin" => matches!(value, "miter" | "round" | "bevel"),
        _ => number(value),
    };
    safe.then_some(Cow::Borrowed(value))
}

pub(crate) fn sanitize_article_html(input: &str) -> AppResult<String> {
    if input.len() > 262_144 {
        return Err(AppError::Config(
            "Analysis Article HTML is too large".into(),
        ));
    }
    let mut attributes: HashMap<&str, HashSet<&str>> = HashMap::from([
        ("a", HashSet::from(["href", "title"])),
        ("th", HashSet::from(["colspan", "rowspan", "scope"])),
        ("td", HashSet::from(["colspan", "rowspan"])),
    ]);
    let mut classes = HashMap::from([
        ("section", HashSet::from(["article-metrics"])),
        ("aside", HashSet::from(["article-note"])),
        ("div", HashSet::from(["article-metric"])),
        ("span", HashSet::from(["article-kicker", "article-value"])),
    ]);
    for tag in SVG_TAGS {
        attributes.insert(tag, SVG_ATTRIBUTES.iter().copied().collect());
        classes.insert(tag, HashSet::from(["article-accent", "article-muted"]));
    }
    let html = Builder::new()
        .tags(HTML_TAGS.iter().chain(SVG_TAGS).copied().collect())
        .generic_attributes(HashSet::new())
        .tag_attributes(attributes)
        .allowed_classes(classes)
        .clean_content_tags(HashSet::from([
            "script",
            "style",
            "textarea",
            "option",
            "noscript",
            "foreignobject",
            "foreignObject",
            "iframe",
            "object",
            "embed",
        ]))
        .url_schemes(HashSet::from(["http", "https", "mailto"]))
        .url_relative(UrlRelative::Deny)
        .link_rel(None)
        .attribute_filter(safe_attribute)
        .clean(input)
        .to_string();
    if html.len() > 262_144 {
        return Err(AppError::Config(
            "Analysis Article HTML is too large".into(),
        ));
    }
    Ok(html)
}
