use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::time::sleep;

pub const BOYA_WEB_BASE_URL: &str = "https://boya.caiada.edu.kg";
pub const DESKTOP_CLIENT_ID: &str = "boya-desktop";
pub const DESKTOP_SCOPE: &str = "desktop:use";

const DEVICE_CODE_URL: &str = "https://boya.caiada.edu.kg/api/auth/device/code";
const DEVICE_TOKEN_URL: &str = "https://boya.caiada.edu.kg/api/auth/device/token";
const DESKTOP_ME_URL: &str = "https://boya.caiada.edu.kg/api/v1/desktop/me";
const SIGN_OUT_URL: &str = "https://boya.caiada.edu.kg/api/auth/sign-out";
const KEYCHAIN_SERVICE: &str = "dev.dylanchiang.boya.account";
const KEYCHAIN_ACCOUNT: &str = "desktop-session";
const OFFLINE_GRACE: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const LOGOUT_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUser {
    pub id: String,
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopMembership {
    pub tier: String,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAccount {
    pub user: DesktopUser,
    pub roles: Vec<String>,
    pub membership: DesktopMembership,
    pub desktop_access: bool,
    pub session_expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAuthSnapshot {
    pub account: DesktopAccount,
    pub offline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredDesktopSession {
    access_token: String,
    expires_at_ms: i64,
    last_verified_at_ms: i64,
    account: DesktopAccount,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Debug, Deserialize)]
struct DeviceTokenResponse {
    access_token: String,
    token_type: String,
    expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct DeviceTokenError {
    error: String,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DesktopMeResponse {
    data: DesktopAccount,
}

#[derive(Debug)]
enum ProbeError {
    Unauthorized,
    Unavailable,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn auth_client_with_timeout(timeout: Duration) -> Result<Client, String> {
    Client::builder()
        .timeout(timeout)
        .user_agent(format!("BOYA Desktop/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "無法建立 BOYA 登入連線".to_owned())
}

fn auth_client() -> Result<Client, String> {
    auth_client_with_timeout(REQUEST_TIMEOUT)
}

fn validate_account(account: DesktopAccount) -> Result<DesktopAccount, String> {
    if account.user.id.trim().is_empty()
        || account.user.email.trim().is_empty()
        || account.session_expires_at.trim().is_empty()
        || !account.desktop_access
        || !matches!(account.membership.tier.as_str(), "free" | "vip")
    {
        return Err("BOYA Web 回傳的會員資料無效".to_owned());
    }
    Ok(account)
}

fn session_is_usable(session: &StoredDesktopSession, at_ms: i64) -> bool {
    at_ms < session.expires_at_ms
        && at_ms <= session.last_verified_at_ms + OFFLINE_GRACE.as_millis() as i64
}

fn snapshot(session: &StoredDesktopSession, offline: bool) -> DesktopAuthSnapshot {
    DesktopAuthSnapshot {
        account: session.account.clone(),
        offline,
    }
}

#[cfg(target_os = "macos")]
fn keychain_get() -> Result<Option<String>, String> {
    use security_framework_sys::base::errSecItemNotFound;

    match security_framework::passwords::get_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| "BOYA 帳號 Session 不是有效的 Keychain 資料".to_owned()),
        Err(error) if error.code() == errSecItemNotFound => Ok(None),
        Err(error) => Err(format!("無法讀取 BOYA 帳號 Session：{error}")),
    }
}

#[cfg(not(target_os = "macos"))]
fn keychain_get() -> Result<Option<String>, String> {
    Err("BOYA Desktop 目前只支援 macOS".to_owned())
}

#[cfg(target_os = "macos")]
fn keychain_set(value: &str) -> Result<(), String> {
    security_framework::passwords::set_generic_password(
        KEYCHAIN_SERVICE,
        KEYCHAIN_ACCOUNT,
        value.as_bytes(),
    )
    .map_err(|error| format!("無法保存 BOYA 帳號 Session：{error}"))
}

#[cfg(not(target_os = "macos"))]
fn keychain_set(_value: &str) -> Result<(), String> {
    Err("BOYA Desktop 目前只支援 macOS".to_owned())
}

#[cfg(target_os = "macos")]
fn keychain_remove() -> Result<(), String> {
    use security_framework_sys::base::errSecItemNotFound;

    match security_framework::passwords::delete_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == errSecItemNotFound => Ok(()),
        Err(error) => Err(format!("無法移除 BOYA 帳號 Session：{error}")),
    }
}

#[cfg(not(target_os = "macos"))]
fn keychain_remove() -> Result<(), String> {
    Err("BOYA Desktop 目前只支援 macOS".to_owned())
}

fn read_stored_session() -> Result<Option<StoredDesktopSession>, String> {
    let Some(value) = keychain_get()? else {
        return Ok(None);
    };
    let session = serde_json::from_str::<StoredDesktopSession>(&value)
        .map_err(|_| "BOYA 帳號 Session 資料損壞，請重新登入".to_owned())?;
    if session.access_token.trim().is_empty() {
        return Err("BOYA 帳號 Session 缺少登入憑證".to_owned());
    }
    Ok(Some(session))
}

fn write_stored_session(session: &StoredDesktopSession) -> Result<(), String> {
    let value = serde_json::to_string(session).map_err(|_| "無法序列化 BOYA 帳號 Session".to_owned())?;
    keychain_set(&value)
}

fn device_verification_url(user_code: &str) -> Result<String, String> {
    if user_code.len() < 4
        || user_code.len() > 32
        || !user_code
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err("BOYA Web 回傳的裝置代碼無效".to_owned());
    }
    Ok(format!("{BOYA_WEB_BASE_URL}/device?user_code={user_code}"))
}

#[cfg(target_os = "macos")]
fn open_browser(url: &str) -> Result<(), String> {
    let status = Command::new("/usr/bin/open")
        .arg(url)
        .status()
        .map_err(|_| "無法開啟 BOYA Web 登入頁面".to_owned())?;
    if status.success() {
        Ok(())
    } else {
        Err("無法開啟 BOYA Web 登入頁面".to_owned())
    }
}

#[cfg(not(target_os = "macos"))]
fn open_browser(_url: &str) -> Result<(), String> {
    Err("BOYA Desktop 目前只支援 macOS".to_owned())
}

async fn request_device_code(client: &Client) -> Result<DeviceCodeResponse, String> {
    let response = client
        .post(DEVICE_CODE_URL)
        .json(&serde_json::json!({
            "client_id": DESKTOP_CLIENT_ID,
            "scope": DESKTOP_SCOPE
        }))
        .send()
        .await
        .map_err(|_| "無法連線到 BOYA Web，請稍後再試".to_owned())?;
    if !response.status().is_success() {
        return Err("BOYA Web 不接受此 Desktop 登入請求".to_owned());
    }
    let response = response
        .json::<DeviceCodeResponse>()
        .await
        .map_err(|_| "BOYA Web 回傳的裝置登入資料無效".to_owned())?;
    if response.device_code.trim().is_empty()
        || response.expires_in == 0
        || response.interval == 0
    {
        return Err("BOYA Web 回傳的裝置登入資料不完整".to_owned());
    }
    device_verification_url(&response.user_code)?;
    Ok(response)
}

async fn poll_device_token(
    client: &Client,
    device: &DeviceCodeResponse,
) -> Result<DeviceTokenResponse, String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(device.expires_in);
    let mut interval = device.interval.max(5);
    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err("裝置登入已逾時，請重新開始登入".to_owned());
        }
        sleep(Duration::from_secs(interval)).await;
        let response = client
            .post(DEVICE_TOKEN_URL)
            .json(&serde_json::json!({
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "device_code": device.device_code,
                "client_id": DESKTOP_CLIENT_ID
            }))
            .send()
            .await
            .map_err(|_| "無法連線到 BOYA Web，正在等待登入結果".to_owned())?;

        if response.status().is_success() {
            let token = response
                .json::<DeviceTokenResponse>()
                .await
                .map_err(|_| "BOYA Web 回傳的登入憑證無效".to_owned())?;
            if token.access_token.trim().is_empty()
                || token.token_type.to_ascii_lowercase() != "bearer"
                || token.expires_in == 0
            {
                return Err("BOYA Web 回傳的登入憑證不完整".to_owned());
            }
            return Ok(token);
        }

        let error = response.json::<DeviceTokenError>().await.unwrap_or(DeviceTokenError {
            error: "unavailable".to_owned(),
            error_description: None,
        });
        match error.error.as_str() {
            "authorization_pending" => continue,
            "slow_down" => {
                interval = interval.saturating_add(5).min(60);
            }
            "access_denied" => return Err("你拒絕了這次 Desktop 登入".to_owned()),
            "expired_token" => return Err("裝置登入已逾時，請重新開始登入".to_owned()),
            _ => {
                let _ = error.error_description;
                return Err("BOYA Web 無法完成 Desktop 登入".to_owned());
            }
        }
    }
}

async fn fetch_account(client: &Client, access_token: &str) -> Result<DesktopAccount, ProbeError> {
    let response = client
        .get(DESKTOP_ME_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|_| ProbeError::Unavailable)?;
    if response.status() == StatusCode::UNAUTHORIZED {
        return Err(ProbeError::Unauthorized);
    }
    if !response.status().is_success() {
        return Err(ProbeError::Unavailable);
    }
    let body = response
        .json::<DesktopMeResponse>()
        .await
        .map_err(|_| ProbeError::Unavailable)?;
    validate_account(body.data).map_err(|_| ProbeError::Unavailable)
}

#[tauri::command]
pub async fn desktop_auth_login() -> Result<DesktopAuthSnapshot, String> {
    let client = auth_client()?;
    let device = request_device_code(&client).await?;
    let verification_url = device_verification_url(&device.user_code)?;
    open_browser(&verification_url)?;
    let token = poll_device_token(&client, &device).await?;
    let account = fetch_account(&client, &token.access_token)
        .await
        .map_err(|_| "登入成功但無法讀取 BOYA 會員資料".to_owned())?;
    let session = StoredDesktopSession {
        access_token: token.access_token,
        expires_at_ms: now_ms().saturating_add(token.expires_in.saturating_mul(1_000) as i64),
        last_verified_at_ms: now_ms(),
        account,
    };
    write_stored_session(&session)?;
    Ok(snapshot(&session, false))
}

#[tauri::command]
pub async fn desktop_auth_get_account() -> Result<Option<DesktopAuthSnapshot>, String> {
    let Some(mut session) = read_stored_session()? else {
        return Ok(None);
    };
    let now = now_ms();
    if now >= session.expires_at_ms {
        keychain_remove()?;
        return Ok(None);
    }

    let client = auth_client()?;
    match fetch_account(&client, &session.access_token).await {
        Ok(account) => {
            session.account = account;
            session.last_verified_at_ms = now;
            write_stored_session(&session)?;
            Ok(Some(snapshot(&session, false)))
        }
        Err(ProbeError::Unauthorized) => {
            keychain_remove()?;
            Ok(None)
        }
        Err(ProbeError::Unavailable) if session_is_usable(&session, now) => {
            Ok(Some(snapshot(&session, true)))
        }
        Err(ProbeError::Unavailable) => Err("BOYA Web 暫時無法驗證會員 Session，請連線後重新嘗試".to_owned()),
    }
}

#[tauri::command]
pub async fn desktop_auth_logout() -> Result<(), String> {
    if let Ok(Some(session)) = read_stored_session() {
        if let Ok(client) = auth_client_with_timeout(LOGOUT_TIMEOUT) {
            let _ = client
                .post(SIGN_OUT_URL)
                .bearer_auth(session.access_token)
                .send()
                .await;
        }
    }
    keychain_remove()
}

pub fn ensure_cached_access() -> Result<(), String> {
    let Some(session) = read_stored_session()? else {
        return Err("請先登入 BOYA 帳號".to_owned());
    };
    if session_is_usable(&session, now_ms()) {
        Ok(())
    } else {
        Err("BOYA 帳號需要重新連線驗證，請先登入".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account() -> DesktopAccount {
        DesktopAccount {
            user: DesktopUser {
                id: "user-1".into(),
                name: "Researcher".into(),
                email: "researcher@example.com".into(),
            },
            roles: vec!["member".into()],
            membership: DesktopMembership {
                tier: "free".into(),
                expires_at: None,
            },
            desktop_access: true,
            session_expires_at: "2026-10-01T00:00:00.000Z".into(),
        }
    }

    #[test]
    fn only_fixed_device_codes_are_opened() {
        let url = device_verification_url("ABCD2345").unwrap();
        assert_eq!(url, "https://boya.caiada.edu.kg/device?user_code=ABCD2345");
        assert!(device_verification_url("bad code").is_err());
        assert!(device_verification_url("https://evil.example").is_err());
    }

    #[test]
    fn offline_grace_requires_recent_verification_and_unexpired_session() {
        let now = now_ms();
        let session = StoredDesktopSession {
            access_token: "opaque-token".into(),
            expires_at_ms: now + 60_000,
            last_verified_at_ms: now - OFFLINE_GRACE.as_millis() as i64 + 1,
            account: account(),
        };
        assert!(session_is_usable(&session, now));
        assert!(!session_is_usable(&session, now + OFFLINE_GRACE.as_millis() as i64));

        let expired = StoredDesktopSession { expires_at_ms: now - 1, ..session };
        assert!(!session_is_usable(&expired, now));
    }

    #[test]
    fn account_validation_keeps_desktop_and_vip_independent() {
        let free = validate_account(account()).unwrap();
        assert!(free.desktop_access);
        assert_eq!(free.membership.tier, "free");

        let invalid = DesktopAccount {
            membership: DesktopMembership {
                tier: "expired-vip".into(),
                expires_at: None,
            },
            ..free
        };
        assert!(validate_account(invalid).is_err());
    }
}
