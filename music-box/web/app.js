"use strict";

const $ = (id) => document.getElementById(id);
const audio = $("audio");

let queue = [];
let curIndex = -1;
let lrc = [];
let lrcCurLine = -1;
let lastReport = 0;
const seenPicks = new Set();

// ---------- 工具 ----------
function fmt(ms) {
  if (!ms || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
async function jget(url) {
  const r = await fetch(url);
  return r.json();
}
async function jpost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}

// ---------- 标签切换 ----------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $(tab.dataset.tab).classList.add("active");
  });
});

// ---------- 搜索 ----------
async function doSearch() {
  const kw = $("searchInput").value.trim();
  if (!kw) return;
  $("results").innerHTML = '<div class="empty">搜索中…</div>';
  $("discoverEmpty").classList.add("hidden");
  try {
    const { songs } = await jget(`/api/search?keywords=${encodeURIComponent(kw)}`);
    renderResults(songs || []);
  } catch {
    $("results").innerHTML = '<div class="empty">搜索失败，稍后再试</div>';
  }
}
$("searchBtn").addEventListener("click", doSearch);
$("searchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doSearch();
});

function songRow(song, opts = {}) {
  const row = document.createElement("div");
  row.className = "song-row";
  if (opts.playing) row.classList.add("playing");
  row.innerHTML = `
    <img class="song-cover" src="${song.cover ? song.cover + "?param=92y92" : ""}" alt="" />
    <div class="song-info">
      <div class="song-name">${escapeHtml(song.name)}</div>
      <div class="song-artist">${escapeHtml(song.artist)}</div>
    </div>
    <button class="song-act">${opts.actIcon || "▶"}</button>`;
  return row;
}
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function renderResults(songs) {
  const box = $("results");
  box.innerHTML = "";
  if (songs.length === 0) {
    $("discoverEmpty").classList.remove("hidden");
    return;
  }
  $("discoverEmpty").classList.add("hidden");
  songs.forEach((song) => {
    const row = songRow(song, { actIcon: "＋" });
    row.querySelector(".song-act").addEventListener("click", (e) => {
      e.stopPropagation();
      addToQueue(song);
    });
    row.addEventListener("click", () => addAndPlay(song));
    box.appendChild(row);
  });
}

// ---------- 播放列表 ----------
function addToQueue(song) {
  if (!queue.some((s) => s.id === song.id)) queue.push(song);
  renderQueue();
}
function addAndPlay(song) {
  let i = queue.findIndex((s) => s.id === song.id);
  if (i < 0) {
    queue.push(song);
    i = queue.length - 1;
  }
  playIndex(i);
}
function renderQueue() {
  const box = $("queue");
  box.innerHTML = "";
  if (queue.length === 0) {
    $("queueEmpty").classList.remove("hidden");
    return;
  }
  $("queueEmpty").classList.add("hidden");
  queue.forEach((song, i) => {
    const row = songRow(song, { playing: i === curIndex, actIcon: "×" });
    row.querySelector(".song-act").addEventListener("click", (e) => {
      e.stopPropagation();
      removeFromQueue(i);
    });
    row.addEventListener("click", () => playIndex(i));
    box.appendChild(row);
  });
}
function removeFromQueue(i) {
  queue.splice(i, 1);
  if (i < curIndex) curIndex--;
  else if (i === curIndex) curIndex = -1;
  renderQueue();
}

// ---------- 播放核心 ----------
async function fetchUrl(id) {
  const { url } = await jget(`/api/song/url?id=${id}`);
  return url || null;
}
async function playIndex(i) {
  if (i < 0 || i >= queue.length) return;
  curIndex = i;
  const song = queue[i];
  renderQueue();
  showPlayer(song);
  const url = await fetchUrl(song.id);
  if (!url) {
    $("pName").textContent = `${song.name}（拿不到链接·可能要登录VIP）`;
    return;
  }
  audio.src = url;
  try {
    await audio.play();
  } catch {
    /* iOS 可能因无手势被拒·控制栏点播放即可 */
  }
  loadLyric(song.id);
  report();
}
function playNext() {
  if (curIndex + 1 < queue.length) playIndex(curIndex + 1);
}
function playPrev() {
  if (curIndex - 1 >= 0) playIndex(curIndex - 1);
}

$("pPlay").addEventListener("click", async () => {
  if (audio.paused) {
    try { await audio.play(); } catch {}
  } else {
    audio.pause();
  }
});
$("pNext").addEventListener("click", playNext);
$("pPrev").addEventListener("click", playPrev);
$("pSeek").addEventListener("input", () => {
  if (audio.duration) audio.currentTime = (Number($("pSeek").value) / 1000) * audio.duration;
});

function showPlayer(song) {
  $("player").classList.remove("hidden");
  $("pCover").src = song.cover ? song.cover + "?param=92y92" : "";
  $("pName").textContent = song.name;
  $("pArtist").textContent = song.artist;
}

audio.addEventListener("play", () => { $("pPlay").textContent = "⏸"; report(); });
audio.addEventListener("pause", () => { $("pPlay").textContent = "▶"; report(); });
audio.addEventListener("ended", playNext);
audio.addEventListener("timeupdate", () => {
  if (audio.duration) {
    $("pSeek").value = String(Math.floor((audio.currentTime / audio.duration) * 1000));
    $("pCur").textContent = fmt(audio.currentTime * 1000);
    $("pDur").textContent = fmt(audio.duration * 1000);
  }
  highlightLyric(audio.currentTime * 1000);
  if (Date.now() - lastReport > 5000) report();
});
// 坑①：网易云 mp3 直链几小时过期 → 报错就用 id 重拿一次接着放
audio.addEventListener("error", async () => {
  if (curIndex < 0) return;
  const pos = audio.currentTime;
  const url = await fetchUrl(queue[curIndex].id);
  if (url) {
    audio.src = url;
    audio.currentTime = pos || 0;
    try { await audio.play(); } catch {}
  }
});

// ---------- 上报"当前在听"(AI 靠这个看到她在听什么) ----------
function report() {
  if (curIndex < 0) return;
  lastReport = Date.now();
  const song = queue[curIndex];
  jpost("/api/now-playing", {
    id: song.id,
    name: song.name,
    artist: song.artist,
    album: song.album || "",
    cover: song.cover || "",
    isPlaying: !audio.paused,
    positionMs: Math.floor((audio.currentTime || 0) * 1000),
    durationMs: Math.floor((audio.duration || 0) * 1000),
  }).catch(() => {});
}

// ---------- 歌词 ----------
async function loadLyric(id) {
  lrc = [];
  lrcCurLine = -1;
  $("lyricBox").innerHTML = '<div class="empty">加载歌词…</div>';
  try {
    const { lyric } = await jget(`/api/lyric?id=${id}`);
    lrc = parseLrc(lyric || "");
    renderLyric();
  } catch {
    $("lyricBox").innerHTML = '<div class="empty">暂无歌词</div>';
  }
}
function parseLrc(text) {
  const out = [];
  text.split("\n").forEach((line) => {
    const m = line.match(/\[(\d+):(\d+)(?:\.(\d+))?\]/g);
    const words = line.replace(/\[[^\]]*\]/g, "").trim();
    if (!m || !words) return;
    m.forEach((tag) => {
      const t = tag.match(/\[(\d+):(\d+)(?:\.(\d+))?\]/);
      const ms = (+t[1]) * 60000 + (+t[2]) * 1000 + (t[3] ? +String(t[3]).padEnd(3, "0").slice(0, 3) : 0);
      out.push({ ms, words });
    });
  });
  return out.sort((a, b) => a.ms - b.ms);
}
function renderLyric() {
  const box = $("lyricBox");
  if (lrc.length === 0) {
    box.innerHTML = '<div class="empty">暂无歌词</div>';
    return;
  }
  box.innerHTML = lrc.map((l, i) => `<div class="lyric-line" data-i="${i}">${escapeHtml(l.words)}</div>`).join("");
}
function highlightLyric(ms) {
  if (lrc.length === 0) return;
  let idx = -1;
  for (let i = 0; i < lrc.length; i++) {
    if (lrc[i].ms <= ms) idx = i;
    else break;
  }
  if (idx === lrcCurLine) return;
  lrcCurLine = idx;
  const box = $("lyricBox");
  box.querySelectorAll(".lyric-line").forEach((el) => el.classList.remove("cur"));
  const cur = box.querySelector(`.lyric-line[data-i="${idx}"]`);
  if (cur) {
    cur.classList.add("cur");
    cur.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

// ---------- 幸村点歌横幅(坑②：iOS 必须用户手势触发播放) ----------
async function checkPicks() {
  try {
    const { picks } = await jget("/api/picks");
    if (!picks || picks.length === 0) return;
    const pick = picks[picks.length - 1];
    if (seenPicks.has(pick.pickId)) return;
    seenPicks.add(pick.pickId);
    showPickBanner(pick);
  } catch {}
}
function showPickBanner(pick) {
  $("pickFrom").textContent = pick.from || "幸村";
  $("pickSong").textContent = `《${pick.name}》— ${pick.artist}`;
  $("pickMsg").textContent = pick.message || "";
  const banner = $("pickBanner");
  banner.classList.remove("hidden");
  $("pickPlayBtn").onclick = async () => {
    banner.classList.add("hidden");
    jpost("/api/picks/consume", { pickId: pick.pickId }).catch(() => {});
    addAndPlay({ id: pick.songId, name: pick.name, artist: pick.artist, album: "", cover: pick.cover });
  };
  $("pickCloseBtn").onclick = () => {
    banner.classList.add("hidden");
    jpost("/api/picks/consume", { pickId: pick.pickId }).catch(() => {});
  };
}

// 坑③：iOS Safari 后台标签页 JS 被暂停 → 切回前台立刻查一次
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkPicks();
});
window.addEventListener("focus", checkPicks);
setInterval(checkPicks, 5000);

// ---------- 登录状态 ----------
async function refreshLogin() {
  try {
    const s = await jget("/api/login/status");
    $("loginLink").textContent = s.loggedIn ? `${s.nickname || "已登录"} ♪` : "未登录 →";
  } catch {}
}

refreshLogin();
checkPicks();
