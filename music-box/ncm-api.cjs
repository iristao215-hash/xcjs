// 启动开源的 NeteaseCloudMusicApi 服务(本机用·只给 music-box 后端代理调用)
const { serveNcmApi } = require("NeteaseCloudMusicApi");

serveNcmApi({
  port: Number(process.env.NCM_PORT || 3000),
  host: "127.0.0.1",
}).then((s) => {
  const addr = s.address();
  console.log(`NeteaseCloudMusicApi running on 127.0.0.1:${addr.port}`);
});
