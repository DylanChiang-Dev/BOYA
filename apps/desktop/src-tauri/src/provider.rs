use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::time::Duration;

pub const OFFICIAL_PROVIDER_ID: &str = "openai";
pub const CUSTOM_PROVIDER_ID: &str = "boya-custom";
pub const OFFICIAL_BASE_URL: &str = "https://api.openai.com/v1";
pub const DEFAULT_MODEL: &str = "gpt-5.6-terra";
const MAX_API_KEY_LENGTH: usize = 8192;
const MAX_MODEL_COUNT: usize = 256;
const MAX_MODEL_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderMode {
    Official,
    Custom,
}

impl Default for ProviderMode {
    fn default() -> Self {
        Self::Official
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
    pub id: String,
    pub name: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct ProviderSettings {
    pub mode: ProviderMode,
    pub name: String,
    pub base_url: String,
    pub models: Vec<ProviderModel>,
}

impl Default for ProviderSettings {
    fn default() -> Self {
        Self {
            mode: ProviderMode::Official,
            name: "OpenAI".to_owned(),
            base_url: OFFICIAL_BASE_URL.to_owned(),
            models: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderImport {
    pub name: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub models: Vec<ProviderModel>,
    pub warning: Option<String>,
}

pub fn default_provider_settings() -> ProviderSettings {
    ProviderSettings::default()
}

pub fn read_provider_settings(preferences: &Value) -> Result<ProviderSettings, String> {
    let mut settings = preferences
        .get("provider")
        .map(|value| serde_json::from_value::<ProviderSettings>(value.clone()))
        .transpose()
        .map_err(|error| format!("Invalid provider preferences: {error}"))?
        .unwrap_or_else(default_provider_settings);
    if settings.mode == ProviderMode::Official {
        settings.name = "OpenAI".to_owned();
        settings.base_url = OFFICIAL_BASE_URL.to_owned();
        settings.models.clear();
    } else if settings.name.trim().is_empty() {
        settings.name = "Custom OpenAI-compatible endpoint".to_owned();
    }
    Ok(settings)
}

pub fn provider_id(settings: &ProviderSettings) -> &'static str {
    match settings.mode {
        ProviderMode::Official => OFFICIAL_PROVIDER_ID,
        ProviderMode::Custom => CUSTOM_PROVIDER_ID,
    }
}

pub fn validate_api_key(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("API Key 不可為空".into());
    }
    if trimmed.len() > MAX_API_KEY_LENGTH {
        return Err("API Key 長度超過限制".into());
    }
    Ok(trimmed.to_owned())
}

pub fn validate_base_url(value: &str) -> Result<Url, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Base URL 不可為空".into());
    }
    let url =
        Url::parse(trimmed).map_err(|_| "Base URL 必須是有效的 http 或 https 網址".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Base URL 必須使用 http 或 https 且包含主機名稱".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Base URL 不可包含帳號或密碼".into());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("Base URL 不可包含 query 或 fragment".into());
    }
    Ok(url)
}

pub fn validate_provider_settings(settings: &ProviderSettings) -> Result<(), String> {
    if settings.mode == ProviderMode::Official {
        return Ok(());
    }
    validate_base_url(&settings.base_url)?;
    if settings.name.trim().is_empty() {
        return Err("服務名稱不可為空".into());
    }
    if settings.models.len() > MAX_MODEL_COUNT {
        return Err("模型數量超過限制".into());
    }
    let mut ids = HashSet::new();
    let mut enabled = 0;
    for model in &settings.models {
        let id = model.id.trim();
        if id.is_empty() || model.name.trim().is_empty() {
            return Err("每個模型都需要 model id 與名稱".into());
        }
        if !ids.insert(id.to_owned()) {
            return Err(format!("模型 id 重複：{id}"));
        }
        if model.enabled {
            enabled += 1;
        }
    }
    if enabled == 0 {
        return Err("至少啟用一個模型後才能啟動自訂端點".into());
    }
    Ok(())
}

pub fn selected_model(preferences: &Value, settings: &ProviderSettings) -> Result<String, String> {
    let provider_matches = preferences
        .get("modelProvider")
        .and_then(Value::as_str)
        .map(|provider| provider == provider_id(settings))
        .unwrap_or(true);
    let requested = if provider_matches {
        preferences
            .get("model")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    } else {
        None
    };
    if settings.mode == ProviderMode::Official {
        return Ok(requested.unwrap_or(DEFAULT_MODEL).to_owned());
    }
    if let Some(requested) = requested {
        if settings
            .models
            .iter()
            .any(|model| model.enabled && model.id == requested)
        {
            return Ok(requested.to_owned());
        }
    }
    settings
        .models
        .iter()
        .find(|model| model.enabled)
        .map(|model| model.id.clone())
        .ok_or_else(|| "自訂端點至少需要一個啟用的模型".into())
}

pub fn models_json(settings: &ProviderSettings) -> Result<Option<Value>, String> {
    if settings.mode == ProviderMode::Official {
        return Ok(None);
    }
    validate_provider_settings(settings)?;
    let models = settings
        .models
        .iter()
        .filter(|model| model.enabled)
        .map(|model| json!({ "id": model.id.trim(), "name": model.name.trim() }))
        .collect::<Vec<_>>();
    let mut providers = Map::new();
    providers.insert(
        CUSTOM_PROVIDER_ID.to_owned(),
        json!({
            "name": settings.name.trim(),
            "baseUrl": settings.base_url.trim().trim_end_matches('/'),
            "api": "openai-completions",
            "models": models,
        }),
    );
    Ok(Some(json!({ "providers": providers })))
}

pub fn write_models_file(private_dir: &Path, settings: &ProviderSettings) -> Result<(), String> {
    let path = private_dir.join("models.json");
    match models_json(settings)? {
        Some(value) => fs::write(
            &path,
            serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("Cannot write Pi models config: {error}")),
        None => match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("Cannot remove stale Pi models config: {error}")),
        },
    }
}

pub fn models_endpoint(base_url: &str) -> Result<Url, String> {
    let mut url = validate_base_url(base_url)?;
    let path = url.path().trim_end_matches('/');
    url.set_path(&format!("{path}/models"));
    Ok(url)
}

pub async fn fetch_models(
    base_url: &str,
    api_key: Option<&str>,
) -> Result<Vec<ProviderModel>, String> {
    let endpoint = models_endpoint(base_url)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| "無法建立模型查詢連線".to_string())?;
    let mut request = client.get(endpoint);
    if let Some(api_key) = api_key.filter(|value| !value.trim().is_empty()) {
        request = request.bearer_auth(api_key.trim());
    }
    let response = request
        .send()
        .await
        .map_err(|_| "無法連線到模型端點".to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("模型端點回應 HTTP {}", status.as_u16()));
    }
    if response
        .content_length()
        .is_some_and(|length| length as usize > MAX_MODEL_RESPONSE_BYTES)
    {
        return Err("模型端點回應過大".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "無法讀取模型端點回應".to_string())?;
    if bytes.len() > MAX_MODEL_RESPONSE_BYTES {
        return Err("模型端點回應過大".into());
    }
    let body = serde_json::from_slice::<Value>(&bytes)
        .map_err(|_| "模型端點回應不是有效 JSON".to_string())?;
    let data = body
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "模型端點缺少 data 陣列".to_string())?;
    let mut models = data
        .iter()
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?.trim();
            if id.is_empty() {
                return None;
            }
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(id);
            Some(ProviderModel {
                id: id.to_owned(),
                name: name.to_owned(),
                enabled: true,
            })
        })
        .collect::<Vec<_>>();
    models.sort_by(|left, right| left.id.cmp(&right.id));
    models.dedup_by(|left, right| left.id == right.id);
    if models.is_empty() {
        return Err("模型端點沒有可用模型".into());
    }
    Ok(models)
}

pub fn parse_ccswitch_import(link: &str) -> Result<ProviderImport, String> {
    let url = Url::parse(link.trim()).map_err(|_| "CC Switch 連結格式無效".to_string())?;
    if url.scheme() != "ccswitch" || url.host_str() != Some("v1") || url.path() != "/import" {
        return Err("只支援 ccswitch://v1/import 連結".into());
    }
    let query = url.query_pairs().into_owned().collect::<Vec<_>>();
    let value = |key: &str| {
        query
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.clone())
    };
    if value("resource").as_deref() != Some("provider") {
        return Err("CC Switch 連結不是 provider 匯入".into());
    }
    let config = value("config")
        .map(|encoded| decode_json_config(&encoded))
        .transpose()?;
    let base_url = value("endpoint")
        .or_else(|| {
            config.as_ref().and_then(|config| {
                find_string(config, &["baseUrl", "base_url", "baseURL", "endpoint"])
            })
        })
        .or_else(|| {
            config.as_ref().and_then(|config| {
                find_string(
                    config,
                    &["ANTHROPIC_BASE_URL", "OPENAI_BASE_URL", "OPENAI_API_BASE"],
                )
            })
        })
        .map(|endpoint| {
            endpoint
                .split(',')
                .next()
                .unwrap_or_default()
                .trim()
                .trim_end_matches('/')
                .to_owned()
        })
        .ok_or_else(|| "CC Switch 連結缺少 endpoint".to_string())?;
    validate_base_url(&base_url)?;
    let api_key = value("apiKey")
        .or_else(|| {
            config.as_ref().and_then(|config| {
                find_string(
                    config,
                    &[
                        "apiKey",
                        "api_key",
                        "OPENAI_API_KEY",
                        "ANTHROPIC_AUTH_TOKEN",
                        "ANTHROPIC_API_KEY",
                    ],
                )
            })
        })
        .map(|key| key.trim().to_owned())
        .filter(|key| !key.is_empty());
    let mut models = config.as_ref().map(extract_models).unwrap_or_default();
    if let Some(model) = config
        .as_ref()
        .and_then(|config| find_string(config, &["model", "OPENAI_MODEL", "ANTHROPIC_MODEL"]))
        .filter(|model| !model.trim().is_empty())
    {
        push_model(
            &mut models,
            ProviderModel {
                id: model.trim().to_owned(),
                name: model.trim().to_owned(),
                enabled: true,
            },
        );
    }
    if let Some(model) = value("model").filter(|model| !model.trim().is_empty()) {
        push_model(
            &mut models,
            ProviderModel {
                id: model.trim().to_owned(),
                name: model.trim().to_owned(),
                enabled: true,
            },
        );
    }
    let warning = match value("app").as_deref() {
        Some("claude") | Some("claude-desktop") => Some("此 CC Switch 連結標示為 Claude/Anthropic；BOYA 目前只送 OpenAI 相容 chat completions，請確認中轉站同時支援該格式".to_owned()),
        Some("codex") => Some("此 CC Switch 連結標示為 Codex Responses；BOYA 目前只送 OpenAI 相容 chat completions，請確認端點支援該格式".to_owned()),
        _ => None,
    };
    Ok(ProviderImport {
        name: value("name")
            .or_else(|| {
                config
                    .as_ref()
                    .and_then(|config| find_string(config, &["name"]))
            })
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| "Imported provider".to_owned()),
        base_url,
        api_key,
        models,
        warning,
    })
}

fn decode_json_config(encoded: &str) -> Result<Value, String> {
    let candidate = encoded.replace(' ', "+");
    let mut candidates = vec![candidate.clone()];
    for padding in 1..=3 {
        if (candidate.len() + padding) % 4 == 0 {
            candidates.push(format!("{candidate}{}", "=".repeat(padding)));
        }
    }
    let bytes = candidates
        .into_iter()
        .find_map(|candidate| {
            STANDARD
                .decode(candidate.as_bytes())
                .ok()
                .or_else(|| STANDARD_NO_PAD.decode(candidate.as_bytes()).ok())
                .or_else(|| URL_SAFE.decode(candidate.as_bytes()).ok())
                .or_else(|| URL_SAFE_NO_PAD.decode(candidate.as_bytes()).ok())
        })
        .ok_or_else(|| "CC Switch config 不是有效 base64".to_string())?;
    serde_json::from_slice(&bytes).map_err(|_| "CC Switch config 不是有效 JSON".to_string())
}

fn find_string(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(object) => {
            for key in keys {
                if let Some(result) = object
                    .get(*key)
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    return Some(result.to_owned());
                }
            }
            object.values().find_map(|value| find_string(value, keys))
        }
        Value::Array(values) => values.iter().find_map(|value| find_string(value, keys)),
        _ => None,
    }
}

fn extract_models(value: &Value) -> Vec<ProviderModel> {
    let mut models = Vec::new();
    if let Some(model_value) = value.get("models") {
        match model_value {
            Value::Array(values) => values.iter().for_each(|value| {
                if let Some(model) = parse_model_value(value, None) {
                    push_model(&mut models, model);
                }
            }),
            Value::Object(values) => values.iter().for_each(|(id, value)| {
                if let Some(model) = parse_model_value(value, Some(id)) {
                    push_model(&mut models, model);
                }
            }),
            _ => {}
        }
    }
    models
}

fn parse_model_value(value: &Value, fallback_id: Option<&str>) -> Option<ProviderModel> {
    let (id, name) = match value {
        Value::String(id) => (id.trim().to_owned(), id.trim().to_owned()),
        Value::Object(object) => {
            let id = object
                .get("id")
                .and_then(Value::as_str)
                .or(fallback_id)?
                .trim()
                .to_owned();
            let name = object
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(&id)
                .trim()
                .to_owned();
            (id, name)
        }
        _ => return None,
    };
    if id.is_empty() || name.is_empty() {
        None
    } else {
        Some(ProviderModel {
            id,
            name,
            enabled: true,
        })
    }
}

fn push_model(models: &mut Vec<ProviderModel>, model: ProviderModel) {
    if !models.iter().any(|existing| existing.id == model.id) {
        models.push(model);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(id: &str, enabled: bool) -> ProviderModel {
        ProviderModel {
            id: id.to_owned(),
            name: id.to_owned(),
            enabled,
        }
    }

    fn custom_settings(models: Vec<ProviderModel>) -> ProviderSettings {
        ProviderSettings {
            mode: ProviderMode::Custom,
            name: "Gateway".to_owned(),
            base_url: "https://gateway.example/v1".to_owned(),
            models,
        }
    }

    #[test]
    fn custom_models_json_contains_only_enabled_models() {
        let settings = custom_settings(vec![model("live", true), model("disabled", false)]);
        let value = models_json(&settings).unwrap().unwrap();
        assert_eq!(
            value["providers"][CUSTOM_PROVIDER_ID]["baseUrl"],
            "https://gateway.example/v1"
        );
        assert_eq!(
            value["providers"][CUSTOM_PROVIDER_ID]["api"],
            "openai-completions"
        );
        assert_eq!(
            value["providers"][CUSTOM_PROVIDER_ID]["models"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            value["providers"][CUSTOM_PROVIDER_ID]["models"][0]["id"],
            "live"
        );
    }

    #[test]
    fn invalid_custom_provider_requires_one_enabled_model() {
        let settings = custom_settings(vec![model("disabled", false)]);
        let error = validate_provider_settings(&settings).unwrap_err();
        assert!(error.contains("啟用") || error.contains("enabled"));
    }

    #[test]
    fn parses_ccswitch_query_and_json_config() {
        let link = "ccswitch://v1/import?resource=provider&name=Gateway&endpoint=https%3A%2F%2Fgateway.example%2Fv1&apiKey=abc123&model=query-model&config=eyJtb2RlbHMiOlt7ImlkIjoiZnJvbS1jb25maWciLCJuYW1lIjoiQ29uZmlnIG1vZGVsIn1dfQ";
        let imported = parse_ccswitch_import(link).unwrap();
        assert_eq!(imported.name, "Gateway");
        assert_eq!(imported.base_url, "https://gateway.example/v1");
        assert_eq!(imported.api_key.as_deref(), Some("abc123"));
        assert_eq!(
            imported
                .models
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["from-config", "query-model"]
        );
    }

    #[test]
    fn imports_openai_environment_keys_models_and_transport_warning() {
        let config = serde_json::json!({
            "env": {
                "OPENAI_API_KEY": "env-key",
                "OPENAI_BASE_URL": "https://gateway.example/v1",
                "OPENAI_MODEL": "env-model"
            }
        });
        let encoded = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&config).unwrap());
        let link = format!("ccswitch://v1/import?resource=provider&app=claude&config={encoded}");
        let imported = parse_ccswitch_import(&link).unwrap();
        assert_eq!(imported.api_key.as_deref(), Some("env-key"));
        assert_eq!(imported.base_url, "https://gateway.example/v1");
        assert_eq!(imported.models[0].id, "env-model");
        assert!(imported.warning.is_some());
    }

    #[test]
    fn rejects_wrong_ccswitch_scheme_version_and_path() {
        for link in [
            "https://v1/import?resource=provider&endpoint=https%3A%2F%2Fexample.com",
            "ccswitch://v2/import?resource=provider&endpoint=https%3A%2F%2Fexample.com",
            "ccswitch://v1/not-import?resource=provider&endpoint=https%3A%2F%2Fexample.com",
        ] {
            assert!(
                parse_ccswitch_import(link).is_err(),
                "accepted invalid link: {link}"
            );
        }
    }

    #[test]
    fn appends_models_to_a_base_url_without_replacing_the_version_path() {
        assert_eq!(
            models_endpoint("https://gateway.example/v1")
                .unwrap()
                .as_str(),
            "https://gateway.example/v1/models"
        );
    }

    #[test]
    fn validates_arbitrary_api_keys_and_rejects_url_credentials() {
        assert_eq!(validate_api_key(" abc123 ").unwrap(), "abc123");
        assert!(validate_api_key("   ").is_err());
        assert!(validate_base_url("https://user:password@gateway.example/v1").is_err());
    }
}
