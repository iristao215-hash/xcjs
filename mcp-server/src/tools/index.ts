import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, tryReadFile, tryListDir } from "../github.js";

const MUST_READ = [
  "memory/workflow.md",
  "memory/affinity.md",
  "memory/_专名表.md",
  "memory/_每日事件索引.md",
];

const CHARACTER_DIR = "memory/characters";
const SETTINGS_DIR = "memory/settings";
const VOLUMES_PREFIX = "volumes/";
const MAX_VOLS = 10;

async function findCharacterFile(name: string): Promise<string | null> {
  const files = await tryListDir(CHARACTER_DIR);
  for (const f of files) {
    const basename = (f.split("/").pop() || "").replace(/\.md$/, "");
    if (basename === name || basename.includes(name) || name.includes(basename)) {
      return f;
    }
  }
  return null;
}

function mmddNum(mmdd: string): number {
  const [a, b] = mmdd.split("-").map(Number);
  return a * 100 + b;
}

async function listAllDayFiles(): Promise<string[]> {
  const out: string[] = [];
  const entries = await tryListDir(VOLUMES_PREFIX.replace(/\/$/, ""));
  const volDirs = entries.filter((p) => /\/vol\d+$/.test(p));
  for (const dir of volDirs) {
    const files = await tryListDir(dir);
    out.push(...files.filter((f) => f.endsWith(".md")));
  }
  return out;
}

async function readMany(
  paths: string[]
): Promise<Array<{ path: string; content: string }>> {
  const out: Array<{ path: string; content: string }> = [];
  const BATCH = 12;
  for (let i = 0; i < paths.length; i += BATCH) {
    const chunk = paths.slice(i, i + BATCH);
    const res = await Promise.all(
      chunk.map(async (p) => ({ p, c: await tryReadFile(p) }))
    );
    for (const r of res) if (r.c) out.push({ path: r.p, content: r.c });
  }
  return out;
}

async function findDayFile(date: string): Promise<string | null> {
  const m = date.match(/(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const target = `${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const targetN = mmddNum(target);

  for (let v = 1; v <= MAX_VOLS; v++) {
    const files = await tryListDir(`${VOLUMES_PREFIX}vol${v}`);
    if (files.length === 0) continue;

    const exact = files.find(
      (f) => (f.split("/").pop() || "") === `${target}.md`
    );
    if (exact) return exact;

    for (const f of files) {
      const base = f.split("/").pop() || "";
      // 文件名形如 MM-DD_标题.md 或 MM-DD至MM-DD_标题.md；跨月区间(如 12-30至01-02)不保证命中
      const rm = base.match(/^(\d{2}-\d{2})(?:至(\d{2}-\d{2}))?/);
      if (!rm) continue;
      if (rm[1] === target) return f;
      if (rm[2]) {
        const s = mmddNum(rm[1]);
        const e = mmddNum(rm[2]);
        if (s <= targetN && targetN <= e) return f;
      }
    }
  }
  return null;
}

export function registerTools(server: McpServer): void {
  server.tool(
    "get_current_state",
    "读取当前剧情状态: 好感度数值 + 最近发生的事件 + 当前停在哪。每次写新场景前必调用。⚠️ 重要：本工具返回的是当前状态快照(数值+近期事件标题/索引)·不是完整剧情。涉及具体过往细节(台词·动作·在场·情绪)·必须在调用后用 read_day 读对应 day 文件原文·不得仅凭本工具返回的摘要写作。",
    {},
    async () => {
      const affinity = await tryReadFile("memory/affinity.md");
      const currentState = await tryReadFile("memory/_当前状态.md");
      const parts: string[] = [];
      if (affinity) parts.push(`# memory/affinity.md\n\n${affinity}`);
      if (currentState) parts.push(`# memory/_当前状态.md\n\n${currentState}`);
      if (parts.length === 0) {
        return {
          content: [
            { type: "text", text: "未找到当前状态文件 (memory/affinity.md 或 memory/_当前状态.md)" },
          ],
        };
      }
      return {
        content: [{ type: "text", text: parts.join("\n\n---\n\n") }],
      };
    }
  );

  server.tool(
    "read_day",
    "读取某一天的详细剧情文件正文(自动匹配 `MM-DD_标题.md` 与 `MM-DD至MM-DD_…` 合并文件)。输入 YYYY-MM-DD 或 MM-DD。",
    {
      date: z.string().describe("日期格式 YYYY-MM-DD 或 MM-DD·例如 2026-04-20 或 04-20"),
    },
    async ({ date }) => {
      const path = await findDayFile(date);
      if (!path) {
        return {
          content: [{ type: "text", text: `未找到 ${date} 对应的 day 文件` }],
        };
      }
      const content = await readFile(path);
      return {
        content: [{ type: "text", text: `# ${path}\n\n${content}` }],
      };
    }
  );

  server.tool(
    "read_file",
    "读取仓库内任意 markdown 文件。输入相对路径例如 memory/characters/陶雨.md。",
    {
      path: z.string().describe("仓库内相对路径"),
    },
    async ({ path }) => {
      const content = await tryReadFile(path);
      if (content === null) {
        return {
          content: [{ type: "text", text: `文件不存在: ${path}` }],
        };
      }
      return {
        content: [{ type: "text", text: `# ${path}\n\n${content}` }],
      };
    }
  );

  server.tool(
    "search_memory",
    "按关键词【定位文件】(只回坐标·不回正文)。scope=all(默认)=索引+角色+设定+全部 day 正文一次同搜·一步到位。命中后**必须挑最相关的 1 个文件 read 全文**·索引/摘要只是路牌不是答案·禁逐个扫读·禁 bash/uploads(铁律一/二)。回忆旧情节直接用本工具·别说'没有/不记得'。",
    {
      query: z.string().describe("关键词·长词拆成单词空格分隔(如 '颜料 画笔 写生')"),
      scope: z
        .enum(["all", "index", "characters", "settings", "volumes"])
        .optional()
        .describe(
          "all=索引+角色+设定+day 正文 一次同搜(默认)；volumes=只搜 day 正文；index/characters/settings=单独范围"
        ),
    },
    async ({ query, scope = "all" }) => {
      const targets: string[] = [];
      if (scope === "all" || scope === "index") {
        targets.push("memory/_每日事件索引.md");
        targets.push("memory/_专名表.md");
        targets.push("memory/workflow.md");
      }
      if (scope === "all" || scope === "characters") {
        const charFiles = await tryListDir(CHARACTER_DIR);
        targets.push(...charFiles);
      }
      if (scope === "all" || scope === "settings") {
        const setFiles = await tryListDir(SETTINGS_DIR);
        targets.push(...setFiles);
      }
      if (scope === "all" || scope === "volumes") {
        const dayFiles = await listAllDayFiles();
        targets.push(...dayFiles);
      }

      const terms = query
        .split(/[\s,，、;；/|]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      const needles = terms.length > 0 ? terms : [query];

      const docs = await readMany(targets);
      const results: Array<{ path: string; score: number; matches: string[] }> =
        [];
      for (const { path, content } of docs) {
        const lines = content.split("\n");
        const matches: string[] = [];
        let score = 0;
        for (let i = 0; i < lines.length; i++) {
          if (needles.some((n) => lines[i].includes(n))) {
            score++;
            if (matches.length < 3) {
              matches.push(`[${i + 1}] ${lines[i].trim().slice(0, 160)}`);
            }
          }
        }
        if (matches.length > 0) {
          results.push({ path, score, matches });
        }
      }
      results.sort((a, b) => b.score - a.score);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `未找到 "${query}"。先 grep memory/_每日事件索引.md（含各种第一次/感情脉络/⭐锚点总表·几乎总能直接点到文件）；再查 memory/_专名表.md 展开同义词、把长词拆成单词空格分隔重搜（scope=volumes）。⚠️ 严禁改用 bash／本地 grep／代码执行／uploads——剧情仓库只在 xcjs-memory·本地沙箱没有它。`,
            },
          ],
        };
      }

      const meta = results.filter(
        (r) => !r.path.startsWith(VOLUMES_PREFIX)
      );
      const vol = results.filter((r) =>
        r.path.startsWith(VOLUMES_PREFIX)
      );
      const VOL_TOP = 8;
      const shown = [...meta, ...vol.slice(0, VOL_TOP)];
      const body = shown
        .map((r) => `## ${r.path}（命中 ${r.score}）\n${r.matches.join("\n")}`)
        .join("\n\n");
      const footer = [
        "",
        "—————",
        `⚠️ 以上仅"定位坐标"·不是正文。索引/档案命中 ${meta.length} 个、day 正文命中 ${vol.length} 个${
          vol.length > VOL_TOP ? `（正文只列前 ${VOL_TOP}·按相关度）` : ""
        }。`,
        "下一步：挑**最相关的 1 个**用 read_day／read_file 读**全文**再据正文回答。",
        "❗ 索引/摘要只是路牌·不是答案——具体细节只能从那个文件正文读出来（铁律一）。",
        "🚫 不要逐个全读——读一串 day 文件会瞬间耗光上下文·本项目最浪费的错。",
        "🚫 别用 bash/本地 grep/uploads(仓库只在 xcjs-memory)。要的不在表里→拆词/换同义词重搜。",
      ].join("\n");
      return { content: [{ type: "text", text: body + footer }] };
    }
  );

  server.tool(
    "make_context_pack",
    "为本轮场景续写生成上下文包·自动读取必读文件 + 指定角色档案 + 指定 day 文件。每次写新场景的第一步调用此工具。⚠️ 重要：本工具返回的是上下文骨架(必读+档案摘要+索引)·不是完整剧情。涉及具体过往细节(台词·动作·在场·情绪)·必须在调用后用 read_day 读对应 day 文件原文·不得仅凭本工具返回的摘要写作。未找到项必须用 read_file 主动补读。",
    {
      characters: z
        .array(z.string())
        .optional()
        .describe('涉及的角色名·如 ["陶雨","幸村精市"]·会自动找到对应档案'),
      dates: z
        .array(z.string())
        .optional()
        .describe('涉及的日期·如 ["2026-04-26","2026-04-20"]·会自动找到对应 day 文件'),
      include_must_read: z
        .boolean()
        .optional()
        .describe("是否包含必读 (workflow/affinity/专名表/索引)·默认 true"),
    },
    async ({ characters = [], dates = [], include_must_read = true }) => {
      const parts: string[] = [];
      const loaded: string[] = [];
      const missing: string[] = [];

      if (include_must_read) {
        for (const path of MUST_READ) {
          const content = await tryReadFile(path);
          if (content) {
            parts.push(`# ${path}\n\n${content}`);
            loaded.push(path);
          } else {
            missing.push(path);
          }
        }
      }

      for (const name of characters) {
        const path = await findCharacterFile(name);
        if (path) {
          const content = await tryReadFile(path);
          if (content) {
            parts.push(`# ${path}\n\n${content}`);
            loaded.push(path);
          }
        } else {
          missing.push(`character:${name}`);
        }
      }

      for (const date of dates) {
        const path = await findDayFile(date);
        if (path) {
          const content = await tryReadFile(path);
          if (content) {
            parts.push(`# ${path}\n\n${content}`);
            loaded.push(path);
          }
        } else {
          missing.push(`day:${date}`);
        }
      }

      const summary = [
        `已载入 ${loaded.length} 个文件:`,
        ...loaded.map((p) => `  ✓ ${p}`),
      ];
      if (missing.length > 0) {
        summary.push("", `未找到 ${missing.length} 项:`);
        for (const m of missing) summary.push(`  ✗ ${m}`);
      }

      return {
        content: [
          { type: "text", text: summary.join("\n") },
          { type: "text", text: parts.join("\n\n---\n\n") },
        ],
      };
    }
  );
}
