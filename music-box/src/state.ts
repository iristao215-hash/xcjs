import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const STATE_FILE = process.env.STATE_FILE || "./data/state.json";
const HISTORY_MAX = 30;

export interface NowPlaying {
  id: number;
  name: string;
  artist: string;
  album: string;
  cover: string;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  updatedAt: number;
}

export interface Pick {
  pickId: string;
  songId: number;
  name: string;
  artist: string;
  cover: string;
  message: string;
  from: string;
  createdAt: number;
  consumed: boolean;
}

export interface HistoryItem {
  id: number;
  name: string;
  artist: string;
  playedAt: number;
}

interface State {
  nowPlaying: NowPlaying | null;
  picks: Pick[];
  history: HistoryItem[];
}

let state: State = { nowPlaying: null, picks: [], history: [] };

function ensureDir(file: string): void {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function load(): void {
  if (existsSync(STATE_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8"));
      state = {
        nowPlaying: parsed.nowPlaying ?? null,
        picks: Array.isArray(parsed.picks) ? parsed.picks : [],
        history: Array.isArray(parsed.history) ? parsed.history : [],
      };
    } catch {
      /* 损坏就从空开始 */
    }
  }
}
load();

function persist(): void {
  ensureDir(STATE_FILE);
  writeFileSync(STATE_FILE, JSON.stringify(state), "utf8");
}

export function setNowPlaying(np: NowPlaying): void {
  const prev = state.nowPlaying;
  state.nowPlaying = np;
  // 切到新歌时记一条历史
  if (np.id && (!prev || prev.id !== np.id)) {
    state.history.unshift({
      id: np.id,
      name: np.name,
      artist: np.artist,
      playedAt: Date.now(),
    });
    state.history = state.history.slice(0, HISTORY_MAX);
  }
  persist();
}

export function getNowPlaying(): NowPlaying | null {
  return state.nowPlaying;
}

export function getHistory(limit = 10): HistoryItem[] {
  return state.history.slice(0, limit);
}

export function addPick(p: Omit<Pick, "pickId" | "createdAt" | "consumed">): Pick {
  const pick: Pick = {
    ...p,
    pickId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    consumed: false,
  };
  state.picks.push(pick);
  state.picks = state.picks.slice(-50);
  persist();
  return pick;
}

export function getPendingPicks(): Pick[] {
  return state.picks.filter((p) => !p.consumed);
}

export function markConsumed(pickId: string): void {
  const p = state.picks.find((x) => x.pickId === pickId);
  if (p) {
    p.consumed = true;
    persist();
  }
}
