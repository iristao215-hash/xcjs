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

async function findDayFile(date: string): Promise<string | null> {
  const m = date.match(/(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  const mmdd = `${mm}-${dd}`;

  for (let v = 1; v <= MAX_VOLS; v++) {
    const path = `${VOLUMES_PREFIX}vol${v}/${mmdd}.md`;
    const content = await tryReadFile(path);
    if (content !== null) return path;
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
    "读取某一天的详细剧情文件。输入 YYYY-MM-DD 或 MM-DD·返回 day 文件正文。",
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
    "按关键词搜索剧情索引·角色档案·设定文件。返回匹配片段及所在文件。不搜索 day 文件正文 (用 read_day 直接读)。",
    {
      query: z.string().describe("搜索关键词·例如 '茉莉' 或 'First Time' 或 '斋藤'"),
      scope: z
        .enum(["all", "index", "characters", "settings"])
        .optional()
        .describe("搜索范围·默认 all"),
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

      const results: Array<{ path: string; matches: string[] }> = [];
      for (const path of targets) {
        const content = await tryReadFile(path);
        if (!content) continue;
        const lines = content.split("\n");
        const matches: string[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(query)) {
            const before = i > 0 ? lines[i - 1] : "";
            const line = lines[i];
            const after = i < lines.length - 1 ? lines[i + 1] : "";
            matches.push(
              [
                before && `[${i}] ${before}`,
                `[${i + 1}] ${line}`,
                after && `[${i + 2}] ${after}`,
              ]
                .filter(Boolean)
                .join("\n")
            );
            if (matches.length >= 5) break;
          }
        }
        if (matches.length > 0) {
          results.push({ path, matches });
        }
      }

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `未找到关键词 "${query}" 的匹配` }],
        };
      }
      const output = results
        .map((r) => `## ${r.path}\n\n${r.matches.join("\n\n— — —\n\n")}`)
        .join("\n\n");
      return { content: [{ type: "text", text: output }] };
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
