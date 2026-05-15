# xcjs 剧情记忆库 · Remote MCP Server

Claude 通过这个 MCP 服务读你 GitHub 仓库里的剧情设定·而不是靠 Project knowledge 的 RAG 检索。

## 它能干什么 (5 个工具)

| 工具 | 干什么 |
|---|---|
| `get_current_state` | 读当前好感度数值 + 当前剧情停在哪 |
| `read_day` | 读某天的 day 文件 (输入 04-26 或 2026-04-26) |
| `read_file` | 读任意 markdown 文件 (输入 `memory/characters/陶雨.md` 这种路径) |
| `search_memory` | 在索引/角色/设定里搜关键词 |
| `make_context_pack` | 一键生成本轮上下文包·包含必读 + 你指定的角色 + 你指定的日期 |

第一版只读·不会改 GitHub 内容。后面 Phase 2 再加 update 工具。

---

## 部署指南 (零代码·跟着点)

### 第一步: GitHub PAT (Personal Access Token)

如果还没生成·按这个做:

1. 浏览器打开 https://github.com/settings/tokens
2. 点 **Generate new token** → **Generate new token (classic)**
3. **Note** 填: `xcjs-mcp-server`
4. **Expiration** 选: `90 days`
5. **Select scopes** 勾上: **`repo`** (这一项包含读写)
6. 拉到底点 **Generate token**
7. **立刻复制**生成的 `ghp_xxxxxxxxxx...`·关闭页面就看不到了
8. 粘到手机便签或电脑文档暂存·**不要 commit 进任何仓库**

### 第二步: 注册 Render

1. 浏览器打开 https://render.com
2. 用 GitHub 账号登录 (推荐·后面授权快)
3. 首次登录需要授权 Render 访问你的 GitHub 仓库

### 第三步: 创建 Web Service

1. Render 后台首页 → 点右上角 **New +** → **Web Service**
2. **Connect a repository** 选 `iristao215-hash/xcjs`
   - 如果列表里没看到·点 **Configure account** 给 Render 授权读这个仓库
3. 进入设置页·按下面填:

| 字段 | 填什么 |
|---|---|
| **Name** | `xcjs-memory-mcp` (随便起·会变成 URL 一部分) |
| **Region** | 离你近的·`Singapore` 或 `Oregon` 都行 |
| **Branch** | `main` (或当前 MCP 代码所在分支) |
| **Root Directory** | `mcp-server` ⚠️ 必填·告诉 Render 代码在子目录 |
| **Runtime** | `Node` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Instance Type** | `Free` (免费够用·15 分钟没流量会休眠) |

### 第四步: 添加环境变量

页面往下滚到 **Environment Variables** → 点 **Add Environment Variable**·依次加这几条:

| Key | Value |
|---|---|
| `GITHUB_TOKEN` | 第一步复制的 `ghp_xxxx...` |
| `GITHUB_OWNER` | `iristao215-hash` |
| `GITHUB_REPO` | `xcjs` |
| `GITHUB_BRANCH` | `main` |
| `MCP_AUTH_TOKEN` | 自己随便编一串 16 位以上字符·比如 `mcpkey_a8b3c9d2e5f7g1h4`·**记下来一会儿要用** |

⚠️ `MCP_AUTH_TOKEN` 不设也能跑·但相当于裸奔。强烈建议设一个。

### 第五步: 点 Create Web Service

Render 开始 build·大概 2-5 分钟。看日志:

- ✅ 看到 `xcjs-memory MCP server listening on :10000` = 成功
- ❌ 看到红字报错·把日志截图发我·我帮你看

部署成功后顶部会显示一个 URL·类似:
```
https://xcjs-memory-mcp.onrender.com
```

打开 URL 应该看到一段 JSON:
```json
{
  "name": "xcjs-memory MCP server",
  "version": "0.1.0",
  "endpoint": "/mcp",
  ...
}
```

看到这个 = 服务跑起来了。

### 第六步: 在 Claude 添加 Custom Connector

1. 打开 https://claude.ai (网页版·手机 App 当前可能还没这个入口)
2. 点头像 → **Settings**
3. 找 **Connectors** (或 Integrations·名字可能在变)
4. 点 **Add custom connector** → 选 **Remote MCP / Custom URL**
5. 按下面填:

| 字段 | 填什么 |
|---|---|
| **Name** | `xcjs-memory` |
| **URL** | `https://xcjs-memory-mcp.onrender.com/mcp` (注意带 `/mcp`) |
| **Authentication** | 如果你设了 `MCP_AUTH_TOKEN` 选 **Bearer Token**·把那串粘进去 |

6. 点保存。Claude 会去 ping 一下·确认能连。

### 第七步: 用起来

新开一个 Claude 对话 (Project 内或外都行)·检查连接器图标显示 `xcjs-memory` 启用。然后说:

```
请用 xcjs-memory 连接器·调用 make_context_pack
characters: ["陶雨", "幸村精市"]
dates: ["2026-04-26"]
include_must_read: true

读完后告诉我当前好感度·然后我们开始写 4 月 27 日的早晨场景。
```

Claude 会调用工具去 GitHub 真读·读到的内容进 context·不是 RAG 瞎抓。

---

## 常见问题

### Render free tier 会休眠?

会。15 分钟没流量·实例休眠。下次调用时唤醒需要 30-60 秒。不影响功能·只是第一次调用慢。

不想休眠 → 升级 Render Starter $7/月。或者用 cron-job.org 每 10 分钟 ping 一下 `/health`。

### 我改了 memory/ 里的文件·MCP 能立刻读到吗?

能。每次工具调用都是实时从 GitHub 拉·没缓存。

### 怎么知道 Claude 真调用了工具·还是又在编?

每次调用工具·Claude 界面会显示一条 `xcjs-memory → make_context_pack` 的提示。看不到这一行就是没调·让它重新调。

### Token 安全

- `GITHUB_TOKEN`·`MCP_AUTH_TOKEN` 只填在 Render 后台·**永远不要 commit 进仓库·不要发给任何人**
- 如果泄漏: 立刻去 GitHub Settings → Tokens 把那个 token 删掉·重新生成一个换到 Render

---

## 本地开发 (可选·她不需要看这段)

```bash
cd mcp-server
npm install
cp .env.example .env  # 填进真实 token
npm run dev
```

服务跑在 http://localhost:3000·POST 到 /mcp 测试。
