import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools/index.js";
import { repoInfo } from "./github.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "xcjs-memory",
    version: "0.1.0",
  });
  registerTools(server);
  return server;
}

const app = express();
app.use(express.json({ limit: "10mb" }));

app.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "xcjs-memory MCP server",
    version: "0.1.0",
    endpoint: "/mcp",
    repo: `${repoInfo.owner}/${repoInfo.repo}@${repoInfo.branch}`,
    auth: AUTH_TOKEN ? "bearer-token-required" : "none",
  });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.use("/mcp", (req: Request, res: Response, next) => {
  if (!AUTH_TOKEN) return next();
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${AUTH_TOKEN}`) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
    return;
  }
  next();
});

app.post("/mcp", async (req: Request, res: Response) => {
  let server: McpServer | undefined;
  let transport: StreamableHTTPServerTransport | undefined;
  try {
    server = createMcpServer();
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport?.close();
      server?.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("MCP request error:", e);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed in stateless mode" },
    id: null,
  });
});

app.delete("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed in stateless mode" },
    id: null,
  });
});

app.listen(PORT, () => {
  console.log(`xcjs-memory MCP server listening on :${PORT}`);
  console.log(`  GitHub: ${repoInfo.owner}/${repoInfo.repo}@${repoInfo.branch}`);
  console.log(`  Auth: ${AUTH_TOKEN ? "bearer token required" : "disabled (open)"}`);
});
