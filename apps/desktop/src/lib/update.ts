import { create } from "zustand";
import { latestRelease } from "./tauri";

const RELEASE_URL = "https://boya-website.pages.dev/releases/latest.json";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ENABLED_KEY = "boya.update.enabled";
const BADGE_KEY = "boya.update.badge";
const DISMISSED_KEY = "boya.update.dismissed";
const LAST_CHECKED_KEY = "boya.update.lastCheckedAt";
const LATEST_KEY = "boya.update.latest";

export interface UpdateInfo {
  version: string;
  url: string;
  name: string | null;
  publishedAt: string | null;
}

interface ReleaseManifest {
  version?: string;
  channel?: string;
  publishedAt?: string;
  releasePageUrl?: string;
}

type CheckStatus = "idle" | "checking" | "ready" | "error";

interface UpdateState {
  enabled: boolean;
  badgeEnabled: boolean;
  dismissedVersion: string | null;
  lastCheckedAt: number | null;
  latest: UpdateInfo | null;
  status: CheckStatus;
  error: string | null;
  currentVersion: string;
  hasUpdate: boolean;
  showBadge: boolean;
  setEnabled: (enabled: boolean) => void;
  setBadgeEnabled: (enabled: boolean) => void;
  dismissBadge: () => void;
  check: (opts?: { manual?: boolean; now?: number }) => Promise<void>;
  maybeAutoCheck: () => Promise<void>;
}

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(key);
  if (v === "1") return true;
  if (v === "0") return false;
  return fallback;
}

function readNumber(key: string): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readLatest(): UpdateInfo | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LATEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UpdateInfo;
    return parsed?.version && parsed?.url ? parsed : null;
  } catch {
    return null;
  }
}

function persistLatest(latest: UpdateInfo | null): void {
  if (typeof window === "undefined") return;
  if (latest) window.localStorage.setItem(LATEST_KEY, JSON.stringify(latest));
  else window.localStorage.removeItem(LATEST_KEY);
}

function setLocal(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  if (value === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, value);
}

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "").split(/[+-]/)[0] ?? "";
}

export function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a).split(".").map((x) => Number.parseInt(x, 10));
  const pb = normalizeVersion(b).split(".").map((x) => Number.parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const da = Number.isFinite(pa[i]) ? pa[i] : 0;
    const db = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

export function shouldAutoCheck(lastCheckedAt: number | null, now: number): boolean {
  return !lastCheckedAt || now - lastCheckedAt >= CHECK_INTERVAL_MS;
}

export function shouldShowUpdateBadge(args: {
  enabled: boolean;
  badgeEnabled: boolean;
  latest: UpdateInfo | null;
  currentVersion: string;
  dismissedVersion: string | null;
}): boolean {
  if (!args.enabled || !args.badgeEnabled || !args.latest) return false;
  if (!isNewerVersion(args.latest.version, args.currentVersion)) return false;
  return normalizeVersion(args.latest.version) !== normalizeVersion(args.dismissedVersion ?? "");
}

function derive(base: Pick<UpdateState, "enabled" | "badgeEnabled" | "latest" | "currentVersion" | "dismissedVersion">) {
  const hasUpdate = Boolean(base.latest && isNewerVersion(base.latest.version, base.currentVersion));
  const showBadge = shouldShowUpdateBadge(base);
  return { hasUpdate, showBadge };
}

async function fetchLatestRelease(): Promise<UpdateInfo> {
  const native = await latestRelease();
  if (native) return native;

  const res = await fetch(RELEASE_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Boya update service returned ${res.status}`);
  const json = (await res.json()) as ReleaseManifest;
  const version = json.version?.trim();
  const url = json.releasePageUrl?.trim();
  if (!version || !url) throw new Error("Boya release manifest was incomplete");
  return {
    version,
    url,
    name: json.channel ? `Boya Desktop ${version} (${json.channel})` : `Boya Desktop ${version}`,
    publishedAt: json.publishedAt ?? null,
  };
}

const initial = {
  enabled: readBool(ENABLED_KEY, false),
  badgeEnabled: readBool(BADGE_KEY, true),
  dismissedVersion: typeof window === "undefined" ? null : window.localStorage.getItem(DISMISSED_KEY),
  lastCheckedAt: readNumber(LAST_CHECKED_KEY),
  latest: readLatest(),
  currentVersion: __APP_VERSION__,
};

export const useUpdateStore = create<UpdateState>((set, get) => ({
  ...initial,
  status: "idle",
  error: null,
  ...derive(initial),
  setEnabled: (enabled) => {
    setLocal(ENABLED_KEY, enabled ? "1" : "0");
    set((s) => ({ enabled, ...derive({ ...s, enabled }) }));
  },
  setBadgeEnabled: (badgeEnabled) => {
    setLocal(BADGE_KEY, badgeEnabled ? "1" : "0");
    set((s) => ({ badgeEnabled, ...derive({ ...s, badgeEnabled }) }));
  },
  dismissBadge: () => {
    const dismissedVersion = get().latest?.version ?? null;
    setLocal(DISMISSED_KEY, dismissedVersion);
    set((s) => ({ dismissedVersion, ...derive({ ...s, dismissedVersion }) }));
  },
  check: async (opts) => {
    const manual = opts?.manual ?? false;
    const now = opts?.now ?? Date.now();
    const s = get();
    if (!manual) {
      if (!s.enabled) return;
      if (!shouldAutoCheck(s.lastCheckedAt, now)) return;
    }
    set({ status: "checking", error: null });
    try {
      const latest = await fetchLatestRelease();
      setLocal(LAST_CHECKED_KEY, String(now));
      persistLatest(latest);
      set((cur) => ({
        latest,
        lastCheckedAt: now,
        status: "ready",
        error: null,
        ...derive({ ...cur, latest }),
      }));
    } catch (e) {
      setLocal(LAST_CHECKED_KEY, String(now));
      set({
        lastCheckedAt: now,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
  maybeAutoCheck: () => get().check({ manual: false }),
}));
