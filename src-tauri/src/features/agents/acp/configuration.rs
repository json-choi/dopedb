//! Project only advertised model and permission-mode choices into the Desktop UI.
use super::{MAX_CONFIG_OPTION_ID_BYTES, MAX_CONFIG_OPTION_VALUE_BYTES};
use std::collections::{HashMap, HashSet};

pub(super) fn project_options(
    config_options: Vec<serde_json::Value>,
) -> (Vec<serde_json::Value>, HashMap<String, HashSet<String>>) {
    let mut allowed = HashMap::<String, HashSet<String>>::new();
    let config_options = config_options
        .into_iter()
        .filter_map(|option| {
            let object = option.as_object()?;
            if !matches!(object.get("category")?.as_str()?, "model" | "mode")
                || object.get("type")?.as_str()? != "select"
            {
                return None;
            }
            let id = object.get("id")?.as_str()?.to_owned();
            if id.is_empty() || id.len() > MAX_CONFIG_OPTION_ID_BYTES {
                return None;
            }
            let mut values = HashSet::new();
            collect_config_select_values(object.get("options"), &mut values);
            if let Some(current) = object.get("currentValue").and_then(|value| value.as_str()) {
                if !current.is_empty() && current.len() <= MAX_CONFIG_OPTION_VALUE_BYTES {
                    values.insert(current.to_owned());
                }
            }
            if values.is_empty() {
                return None;
            }
            allowed.insert(id, values);
            Some(serde_json::Value::Object(object.clone()))
        })
        .collect::<Vec<_>>();
    (config_options, allowed)
}

fn collect_config_select_values(value: Option<&serde_json::Value>, values: &mut HashSet<String>) {
    let Some(entries) = value.and_then(serde_json::Value::as_array) else {
        return;
    };
    for entry in entries {
        let Some(object) = entry.as_object() else {
            continue;
        };
        if let Some(value) = object.get("value").and_then(serde_json::Value::as_str) {
            if !value.is_empty() && value.len() <= MAX_CONFIG_OPTION_VALUE_BYTES {
                values.insert(value.to_owned());
            }
        } else {
            collect_config_select_values(object.get("options"), values);
        }
    }
}

#[cfg(test)]
pub(crate) fn assert_session_configuration_contract() {
    use serde_json::json;
    let (options, allowed) = project_options(vec![
        json!({"id":"model","category":"model","type":"select","currentValue":"default",
            "options":[{"value":"default","name":"Default"}]}),
        json!({"id":"mode","category":"mode","type":"select","currentValue":"default",
            "options":[{"group":"permissions","options":[
                {"value":"default","name":"Manual"},
                {"value":"bypassPermissions","name":"Bypass permissions"}]}]}),
        json!({"id":"other","category":"unknown","type":"select","currentValue":"yes"}),
        json!({"id":"toggle","category":"mode","type":"boolean","currentValue":true}),
    ]);
    assert_eq!(options.len(), 2);
    assert_eq!(options[1]["currentValue"], "default");
    assert!(allowed["mode"].contains("bypassPermissions"));
    assert!(!allowed["mode"].contains("unadvertised"));
    assert!(!allowed["model"].contains("bypassPermissions"));
    assert!(!allowed.contains_key("other"));
    assert!(!allowed.contains_key("toggle"));
    assert!(project_options(Vec::new()).1.is_empty());
}
