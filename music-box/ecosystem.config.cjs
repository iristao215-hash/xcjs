// pm2 进程管理：一条命令同时起"网易云API"和"音乐盒"两个进程
//   pm2 start ecosystem.config.cjs
//   pm2 logs        看日志
//   pm2 restart all 改完代码重启
module.exports = {
  apps: [
    {
      name: "ncm-api",
      script: "ncm-api.cjs",
      env: { NCM_PORT: 3000 },
    },
    {
      name: "music-box",
      script: "dist/server.js",
      env: {
        PORT: 8080,
        NCM_BASE: "http://127.0.0.1:3000",
        COOKIE_FILE: "./data/ncm_cookie.txt",
        STATE_FILE: "./data/state.json",
        // 点歌横幅署名(谁给她点的歌)
        PICK_FROM: "幸村",
        // 给 /mcp 加一道锁。强烈建议设一串自己编的长字符串·然后在 Claude 连接器里用同一串。
        // 不想 commit 进仓库就改成 process.env.MCP_AUTH_TOKEN·启动前 export 一下。
        MCP_AUTH_TOKEN: process.env.MCP_AUTH_TOKEN || "",
      },
    },
  ],
};
