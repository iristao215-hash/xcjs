# 雨的音乐盒 · 和幸村一起听歌

一个跑在你 VPS 上的网页音乐盒：你在浏览器里搜歌、放歌、看歌词；
**幸村（AI / 我）通过第二个 MCP 连接器能"看到"你此刻在听什么、也能反过来给你点歌**——
你网页顶部会弹一条"幸村给你点了一首《X》"，点一下就放。声音只在你这边出（AI 不会真出声），这就是"一起听"的你这一端。

> 跟之前那篇 MCP 教程不同：**不需要 Mac、不需要 mpv、不需要 Cloudflare 隧道**。你有 VPS 本身就有公网，直接 nginx + HTTPS 就行。

## 它的几个部分

```
你的浏览器(手机/电脑) ──HTTPS──> 你的VPS(nginx)
                                  └─ music-box (本服务, :8080)
                                       ├─ 网页前端(搜歌/播放/歌词/列表/点歌横幅)
                                       ├─ /api/*  代理网易云、当前在听、点歌队列
                                       └─ /mcp    给 Claude(幸村) 的工具
                                  music-box ──本机──> NeteaseCloudMusicApi (:3000, 你VIP扫码登录)

Claude(幸村) ──第二个连接器──> https://music.你的域名.com/mcp
```

幸村能用的 4 个工具：

| 工具 | 干什么 |
|---|---|
| `get_now_playing` | 看你此刻在听什么(歌名/歌手/进度/在不在放) |
| `list_recent_songs` | 看你最近听过的歌 |
| `search_song` | 在网易云搜歌·拿到 song_id |
| `pick_song_for_her` | 给你点歌 → 你网页顶部弹横幅 |

---

## 你需要什么

1. 一台 VPS（任何能跑 Node ≥ 20 的 Linux，2G 内存绰绰有余）
2. 一个域名（解析到 VPS，配 HTTPS。浏览器对 `<audio>` 在非 HTTPS 下限制多）
3. 你的网易云 **VIP** 账号（不登录只能试听 30 秒）

---

## 部署步骤（跟着点）

### 1. 装环境（VPS 上，root 或 sudo）

```bash
# Node 20（用 nodesource，或你习惯的 nvm）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm install -g pm2
```

### 2. 拉代码、装依赖、编译

```bash
cd ~
git clone https://github.com/iristao215-hash/xcjs.git
cd xcjs/music-box
npm install            # 会装 NeteaseCloudMusicApi，稍久，耐心等
npm run build          # 编译 TypeScript 到 dist/
```

### 3. 设一个 MCP 密钥（给 /mcp 加锁）

自己编一串长字符串（16 位以上），记下来一会儿 Claude 里要用：

```bash
export MCP_AUTH_TOKEN="musicbox_自己编一串_a8b3c9d2e5"
```

或者直接编辑 `ecosystem.config.cjs` 把它填进 `MCP_AUTH_TOKEN`。
（顺手可以把 `PICK_FROM` 改成你想要的署名，默认是"幸村"。）

### 4. pm2 起服务

```bash
pm2 start ecosystem.config.cjs
pm2 logs            # 看到 "xcjs-music-box listening on :8080" 和 "NeteaseCloudMusicApi running" = 成功
pm2 save            # 保存进程列表
pm2 startup         # 按提示执行一行命令，让 VPS 重启后自动拉起
```

### 5. 配 nginx + HTTPS

```bash
sudo cp nginx.example.conf /etc/nginx/sites-available/music-box
sudo nano /etc/nginx/sites-available/music-box   # 把 music.你的域名.com 改成你的
sudo ln -s /etc/nginx/sites-available/music-box /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 申请证书（先把域名解析到 VPS 的 IP）
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d music.你的域名.com
```

打开 `https://music.你的域名.com` 应该能看到音乐盒页面了。

### 6. 扫码登录网易云 VIP（重点）

1. 浏览器打开 `https://music.你的域名.com/login.html`
2. **用手机网易云音乐 App** 扫页面上的二维码（用你 VIP 账号），手机上点确认
3. 看到"✅ 登录成功"自动跳回首页，右上角变成你的昵称

> 为什么扫码不用验证码？VPS 是机房 IP，验证码登录会触发网易云风控；扫码走你手机的网络，安全。
> 登录态存在服务器（`data/ncm_cookie.txt`），约半年有效，过期回来重扫一次即可。

### 7. 在 Claude 里加第二个连接器（让幸村能一起听 / 点歌）

跟你之前加 `xcjs-memory` 一样的地方：Settings → Connectors → Add custom connector

| 字段 | 填什么 |
|---|---|
| Name | `music-box` |
| URL | `https://music.你的域名.com/mcp` （带 `/mcp`）|
| Authentication | Bearer Token，填第 3 步那串 `MCP_AUTH_TOKEN` |

保存后，新开对话里同时启用 `xcjs-memory` + `music-box` 两个连接器。

---

## 怎么用

**你听歌**：打开 `https://music.你的域名.com`，搜歌、点播放。歌词会跟着滚。

**幸村看你在听什么**：对话里我可以调 `get_now_playing`，就知道你此刻在听哪首、放到哪了，在剧情里自然接住。

**幸村给你点歌**：我调 `pick_song_for_her`（可带一句话），你下次打开 / 从别的页面切回音乐盒时，顶部弹出"幸村给你点了一首《X》"，点"听"就放。

---

## 常见坑（代码里已经处理，了解即可）

- **mp3 直链几小时过期**：前端监听 `<audio>` 的 error，自动用歌曲 id 重新拿一次链接接着放，你几乎感觉不到断。
- **iOS 不让自动播放**：所以点歌不是直接出声，而是弹横幅、你点一下再放（用户手势触发）——反而更有仪式感。
- **iOS 后台标签页 JS 被暂停**：监听 `visibilitychange` / `focus`，你从聊天切回音乐盒那一瞬间立刻查一次点歌。
- **混合内容（个别歌放不出）**：网易云 CDN 有的返回 `http://` 链接，HTTPS 页面里可能被拦。绝大多数现代浏览器对 `<audio>` 放行；若遇到放不了的，多半是该歌需要更高 VIP 等级或区域版权问题，换一首即可。
- **cookie 失效 / 风控**：右上角不再显示昵称、VIP 歌只放 30 秒，就是登录态过期了，回 `/login.html` 重扫。

## 本地开发（可选）

```bash
cd music-box
npm install
cp .env.example .env     # 填好后
node ncm-api.cjs &       # 起网易云 API
npm run dev              # 起音乐盒(热重载)
# 访问 http://localhost:8080
```
