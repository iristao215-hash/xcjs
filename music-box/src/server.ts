import express, { type Request, type Response } from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerMusicTools } from "./mcp.js";
import {
  searchSongs,
  songUrl,
  lyric,
  isLoggedIn,
  saveCookie,
  loginStatus,
  qrKey,
  qrCreate,
  qrCheck,
} from "./ncm.js";
import {
  setNowPlaying,
  getNowPlaying,
  getPendingPicks,
  markConsumed,
} from "./state.js";

const PORT = parseInt(process.env.PORT || "8080", 10);
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, "..", "web");

const app = express();
app.use(express.json({ limit: "2mb" }));

// ---------- 音乐盒前端 API ----------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, loggedIn: isLoggedIn() });
});

app.get("/api/search", async (req: Request, res: Response) => {
  const keywords = String(req.query.keywords || "").trim();
  if (!keywords) return res.json({ songs: [] });
  try {
    const songs = await searchSongs(keywords, 30);
    res.json({ songs });
  } catch (e) {
    res.status(502).json({ error: "搜索失败", detail: String(e) });
  }
});

app.get("/api/song/url", async (req: Request, res: Response) => {
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ error: "缺少 id" });
  try {
    const url = await songUrl(id);
    if (!url) return res.status(404).json({ error: "拿不到播放链接(可能需要VIP登录)" });
    res.json({ url });
  } catch (e) {
    res.status(502).json({ error: "获取播放链接失败", detail: String(e) });
  }
});

app.get("/api/lyric", async (req: Request, res: Response) => {
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ error: "缺少 id" });
  try {
    res.json({ lyric: await lyric(id) });
  } catch (e) {
    res.status(502).json({ error: "获取歌词失败", detail: String(e) });
  }
});

// 前端上报当前在听 —— AI 靠这个"看到"她在听什么
app.post("/api/now-playing", (req: Request, res: Response) => {
  const b = req.body || {};
  if (!b.id) return res.status(400).json({ error: "缺少 id" });
  setNowPlaying({
    id: Number(b.id),
    name: String(b.name || ""),
    artist: String(b.artist || ""),
    album: String(b.album || ""),
    cover: String(b.cover || ""),
    isPlaying: Boolean(b.isPlaying),
    positionMs: Number(b.positionMs || 0),
    durationMs: Number(b.durationMs || 0),
    updatedAt: Date.now(),
  });
  res.json({ ok: true });
});

app.get("/api/now-playing", (_req, res) => {
  res.json({ nowPlaying: getNowPlaying() });
});

// 前端轮询点歌队列(AI 给她点的歌)
app.get("/api/picks", (_req, res) => {
  res.json({ picks: getPendingPicks() });
});

app.post("/api/picks/consume", (req: Request, res: Response) => {
  const pickId = String(req.body?.pickId || "");
  if (!pickId) return res.status(400).json({ error: "缺少 pickId" });
  markConsumed(pickId);
  res.json({ ok: true });
});

// ---------- 扫码登录(在 VPS 上生成二维码·用手机网易云App扫) ----------
app.get("/api/login/qr", async (_req, res) => {
  try {
    const key = await qrKey();
    const qrimg = await qrCreate(key);
    res.json({ key, qrimg });
  } catch (e) {
    res.status(502).json({ error: "生成二维码失败", detail: String(e) });
  }
});

app.get("/api/login/check", async (req: Request, res: Response) => {
  const key = String(req.query.key || "");
  if (!key) return res.status(400).json({ error: "缺少 key" });
  try {
    const r = await qrCheck(key);
    if (r.code === 803 && r.cookie) {
      saveCookie(r.cookie);
    }
    res.json(r);
  } catch (e) {
    res.status(502).json({ error: "检查扫码状态失败", detail: String(e) });
  }
});

app.get("/api/login/status", async (_req, res) => {
  try {
    const s = await loginStatus();
    res.json({ loggedIn: isLoggedIn(), nickname: s.nickname });
  } catch {
    res.json({ loggedIn: isLoggedIn(), nickname: null });
  }
});

// ---------- MCP(给 Claude / 幸村 用) ----------
function createMcpServer(): McpServer {
  const server = new McpServer({ name: "xcjs-music-box", version: "0.1.0" });
  registerMusicTools(server);
  return server;
}

app.use("/mcp", (req: Request, res: Response, next) => {
  if (!AUTH_TOKEN) return next();
  if (req.headers.authorization !== `Bearer ${AUTH_TOKEN}`) {
    res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
    return;
  }
  next();
});

app.post("/mcp", async (req: Request, res: Response) => {
  let server: McpServer | undefined;
  let transport: StreamableHTTPServerTransport | undefined;
  try {
    server = createMcpServer();
    transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport?.close();
      server?.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("MCP request error:", e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed in stateless mode" }, id: null });
});
app.delete("/mcp", (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed in stateless mode" }, id: null });
});

// ---------- 静态前端 ----------
app.use(express.static(WEB_DIR));

app.listen(PORT, () => {
  console.log(`xcjs-music-box listening on :${PORT}`);
  console.log(`  网易云登录态: ${isLoggedIn() ? "已登录" : "未登录(VIP歌只能试听30秒·去 /login 扫码)"}`);
  console.log(`  MCP 鉴权: ${AUTH_TOKEN ? "需要 Bearer token" : "未设置(裸奔·建议设 MCP_AUTH_TOKEN)"}`);
});
