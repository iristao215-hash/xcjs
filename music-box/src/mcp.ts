import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchSongs, songDetail, type Song } from "./ncm.js";
import { getNowPlaying, getHistory, addPick } from "./state.js";

const PICK_FROM = process.env.PICK_FROM || "幸村";

function fmtAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分钟前`;
  return `${Math.floor(s / 3600)}小时前`;
}

export function registerMusicTools(server: McpServer): void {
  server.tool(
    "get_now_playing",
    "看陶雨此刻在听什么歌(歌名/歌手/专辑/是否正在播放/播放进度)。这是'和她一起听歌'的眼睛——想知道她现在在听什么、据此在剧情里回应时调用。她没在听则返回空。",
    {},
    async () => {
      const np = getNowPlaying();
      if (!np) {
        return { content: [{ type: "text", text: "她现在没有在听歌(音乐盒里没有播放中的曲目)。" }] };
      }
      const stale = Date.now() - np.updatedAt > 5 * 60 * 1000;
      const pos = Math.floor(np.positionMs / 1000);
      const dur = Math.floor(np.durationMs / 1000);
      const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      const lines = [
        `《${np.name}》— ${np.artist}`,
        `专辑：${np.album}`,
        `状态：${np.isPlaying ? "正在播放" : "已暂停"}（${mmss(pos)}/${mmss(dur)}）`,
        `更新于 ${fmtAgo(np.updatedAt)}${stale ? "（已超过5分钟没更新，可能已经离开音乐盒）" : ""}`,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "list_recent_songs",
    "看陶雨最近在音乐盒里听过的歌(按时间倒序)。想了解她最近的心情/口味、或避免重复点歌时调用。",
    { limit: z.number().optional().describe("返回条数·默认10") },
    async ({ limit = 10 }) => {
      const hist = getHistory(limit);
      if (hist.length === 0) {
        return { content: [{ type: "text", text: "还没有播放记录。" }] };
      }
      const body = hist
        .map((h, i) => `${i + 1}. 《${h.name}》— ${h.artist}（${fmtAgo(h.playedAt)}）`)
        .join("\n");
      return { content: [{ type: "text", text: body }] };
    }
  );

  server.tool(
    "search_song",
    "在网易云搜歌·返回候选(歌名/歌手/专辑/song_id)。给陶雨点歌前先用它确认要点的是哪一首·再把 song_id 传给 pick_song_for_her。",
    {
      keyword: z.string().describe("歌名或'歌名 歌手'·如 '晴天 周杰伦'"),
      limit: z.number().optional().describe("返回条数·默认8"),
    },
    async ({ keyword, limit = 8 }) => {
      const songs = await searchSongs(keyword, limit);
      if (songs.length === 0) {
        return { content: [{ type: "text", text: `没搜到 "${keyword}"。换个关键词或加上歌手名再试。` }] };
      }
      const body = songs
        .map((s) => `- song_id=${s.id}｜《${s.name}》— ${s.artist}｜专辑：${s.album}`)
        .join("\n");
      return { content: [{ type: "text", text: body }] };
    }
  );

  server.tool(
    "pick_song_for_her",
    `给陶雨点一首歌。她的音乐盒会在顶部弹一条横幅"${PICK_FROM}给你点了一首《X》"·她点一下就播放(声音只在她那边出·你听不到·这是'一起听'的你这端)。可只给 keyword(自动取搜索第一条)·或直接给 song_id(配合 search_song 更精准)。message 是你想对她说的一句话·会显示在横幅里。`,
    {
      song_id: z.number().optional().describe("精确的歌曲ID(来自 search_song)·优先用这个"),
      keyword: z.string().optional().describe("没有 song_id 时·按关键词搜·取第一条"),
      message: z.string().optional().describe(`随歌附一句话·如 '想你了'。留空则用默认`),
    },
    async ({ song_id, keyword, message }) => {
      let song: Song | null = null;
      if (song_id) {
        song = await songDetail(song_id);
      } else if (keyword) {
        const list = await searchSongs(keyword, 1);
        song = list[0] || null;
      }
      if (!song) {
        return {
          content: [{ type: "text", text: "没找到要点的歌。给 song_id(用 search_song 拿)或换个 keyword。" }],
        };
      }
      const pick = addPick({
        songId: song.id,
        name: song.name,
        artist: song.artist,
        cover: song.cover,
        message: message || `${PICK_FROM}给你点了一首歌`,
        from: PICK_FROM,
      });
      return {
        content: [
          {
            type: "text",
            text: `已给陶雨点歌：《${song.name}》— ${song.artist}\n附言：${pick.message}\n她下次打开/切回音乐盒页面时·顶部会弹出横幅·点一下即播放。`,
          },
        ],
      };
    }
  );
}
