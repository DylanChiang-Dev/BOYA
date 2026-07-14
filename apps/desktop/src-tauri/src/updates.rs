use serde::{Deserialize, Serialize};

const RELEASE_MANIFEST_URL: &str = "https://boya-website.pages.dev/releases/latest.json";

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ReleaseManifest {
    version: String,
    channel: Option<String>,
    published_at: Option<String>,
    release_page_url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub version: String,
    pub url: String,
    pub name: Option<String>,
    pub published_at: Option<String>,
}

#[tauri::command]
pub async fn latest_release() -> Result<ReleaseInfo, String> {
    tauri::async_runtime::spawn_blocking(fetch_latest_release)
        .await
        .map_err(|e| format!("update check task failed: {e}"))?
}

fn fetch_latest_release() -> Result<ReleaseInfo, String> {
    let body = reqwest::blocking::Client::builder()
        .user_agent("Boya Desktop update checker")
        .build()
        .map_err(|e| format!("could not create HTTP client: {e}"))?
        .get(RELEASE_MANIFEST_URL)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|e| format!("could not fetch Boya release manifest: {e}"))?
        .text()
        .map_err(|e| format!("could not read Boya release manifest: {e}"))?;
    parse_latest_release(&body)
}

fn parse_latest_release(json: &str) -> Result<ReleaseInfo, String> {
    let manifest: ReleaseManifest =
        serde_json::from_str(json).map_err(|e| format!("invalid Boya release manifest: {e}"))?;
    let version = manifest.version.trim().to_string();
    let url = manifest.release_page_url.trim().to_string();
    if version.is_empty() || url.is_empty() {
        return Err("Boya release manifest was incomplete".into());
    }
    let name = manifest
        .channel
        .map(|channel| format!("Boya Desktop {version} ({channel})"))
        .or_else(|| Some(format!("Boya Desktop {version}")));
    Ok(ReleaseInfo {
        version,
        url,
        name,
        published_at: manifest.published_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_release_manifest() {
        let json = r#"{
          "version": "0.1.8",
          "channel": "preview",
          "publishedAt": "2026-07-09T13:59:12Z",
          "releasePageUrl": "https://boya-website.pages.dev/zh-hant/desktop/#download"
        }"#;

        assert_eq!(
            parse_latest_release(json).unwrap(),
            ReleaseInfo {
                version: "0.1.8".into(),
                url: "https://boya-website.pages.dev/zh-hant/desktop/#download".into(),
                name: Some("Boya Desktop 0.1.8 (preview)".into()),
                published_at: Some("2026-07-09T13:59:12Z".into()),
            },
        );
    }

    #[test]
    fn rejects_incomplete_release_manifest() {
        let error = parse_latest_release(r#"{"version":"","releasePageUrl":""}"#)
            .expect_err("empty fields must be rejected");
        assert_eq!(error, "Boya release manifest was incomplete");
    }
}
