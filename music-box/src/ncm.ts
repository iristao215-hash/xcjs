import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const NCM_BASE = process.env.NCM_BASE || "http://127.0.0.1:3000";
const COOKIE_FILE = process.env.COOKIE_FILE || "./data/ncm_cookie.txt";

let cookieCache: string | null = null;

function ensureDir(file: string): void {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function getCookie(): string {
  if (cookieCache !== null) return cookieCache;
  if (existsSync(COOKIE_FILE)) {
    cookieCache = readFileSync(COOKIE_FILE, "utf8").trim();
  } else {
    cookieCache = "";
  }
  return cookieCache;
}

export function saveCookie(cookie: string): void {
  cookieCache = cookie.trim();
  ensureDir(COOKIE_FILE);
  writeFileSync(COOKIE_FILE, cookieCache, "utf8");
}

export function isLoggedIn(): boolean {
  return getCookie().length > 0;
}

type Params = Record<string, string | number | boolean | undefined>;

async function ncmGet(path: string, params: Params = {}, withCookie = true): Promise<any> {
  const url = new URL(path, NCM_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  url.searchParams.set("timestamp", String(Date.now()));
  if (withCookie) {
    const cookie = getCookie();
    if (cookie) url.searchParams.set("cookie", cookie);
  }
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

export interface Song {
  id: number;
  name: string;
  artist: string;
  album: string;
  cover: string;
  durationMs: number;
}

function mapCloudSong(s: any): Song {
  return {
    id: s.id,
    name: s.name,
    artist: Array.isArray(s.ar) ? s.ar.map((a: any) => a.name).join("/") : "",
    album: s.al?.name || "",
    cover: s.al?.picUrl || "",
    durationMs: s.dt || 0,
  };
}

export async function searchSongs(keywords: string, limit = 30): Promise<Song[]> {
  const data = await ncmGet("/cloudsearch", { keywords, type: 1, limit });
  const songs = data?.result?.songs;
  if (!Array.isArray(songs)) return [];
  return songs.map(mapCloudSong);
}

export async function songDetail(id: number): Promise<Song | null> {
  const data = await ncmGet("/song/detail", { ids: id });
  const s = data?.songs?.[0];
  return s ? mapCloudSong(s) : null;
}

export async function songUrl(id: number, level = "exhigh"): Promise<string | null> {
  const data = await ncmGet("/song/url/v1", { id, level });
  return data?.data?.[0]?.url || null;
}

export async function lyric(id: number): Promise<string> {
  const data = await ncmGet("/lyric", { id });
  return data?.lrc?.lyric || "";
}

// ---- 扫码登录流程 ----
export async function qrKey(): Promise<string> {
  const data = await ncmGet("/login/qr/key", {}, false);
  return data?.data?.unikey || "";
}

export async function qrCreate(key: string): Promise<string> {
  const data = await ncmGet("/login/qr/create", { key, qrimg: true }, false);
  return data?.data?.qrimg || "";
}

export async function qrCheck(
  key: string
): Promise<{ code: number; message: string; cookie?: string }> {
  const data = await ncmGet("/login/qr/check", { key }, false);
  return { code: data?.code, message: data?.message || "", cookie: data?.cookie };
}

export async function loginStatus(): Promise<{ nickname: string | null }> {
  const data = await ncmGet("/login/status", {});
  const profile = data?.data?.profile || data?.profile;
  return { nickname: profile?.nickname || null };
}
