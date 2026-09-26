// server.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DATA_DIR = process.env.DATA_DIR || "/data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (_) {
    return { playlistUrl: "", rtmpUrl: "", cookies: "", proxyUrl: "" };
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

let workerProcess = null;
let logs = [];
const MAX_LOGS = 500;

function pushLog(line) {
  const stamped = `[${new Date().toLocaleTimeString("fa-IR")}] ${line}`;
  logs.push(stamped);
  if (logs.length > MAX_LOGS) logs.shift();
}

function isRunning() {
  return !!workerProcess && workerProcess.exitCode === null;
}

function startWorker() {
  if (isRunning()) return { ok: false, message: "استریم از قبل در حال اجراست." };
  const cfg = loadConfig();
  if (!cfg.playlistUrl || !cfg.rtmpUrl) {
    return { ok: false, message: "اول لینک پلی‌لیست و لینک استریم رو ذخیره کن." };
  }

  workerProcess = spawn("node", [path.join(__dirname, "worker.js")], {
    env: {
      ...process.env,
      PLAYLIST_URL: cfg.playlistUrl,
      RTMP_URL: cfg.rtmpUrl,
      YT_COOKIES: cfg.cookies || "",
      PROXY_URL: cfg.proxyUrl || "",
    },
  });

  pushLog("درخواست شروع استریم ارسال شد.");

  workerProcess.stdout.on("data", (d) => {
    d.toString()
      .split("\n")
      .filter(Boolean)
      .forEach((line) => pushLog(line));
  });
  workerProcess.stderr.on("data", (d) => {
    d.toString()
      .split("\n")
      .filter(Boolean)
      .forEach((line) => pushLog(line));
  });
  workerProcess.on("close", (code) => {
    pushLog(`پروسه استریم متوقف شد (کد: ${code}).`);
    workerProcess = null;
  });

  return { ok: true, message: "استریم شروع شد." };
}

function stopWorker() {
  if (!isRunning()) return { ok: false, message: "استریمی در حال اجرا نیست." };
  pushLog("درخواست توقف استریم ارسال شد.");
  workerProcess.kill("SIGTERM");
  setTimeout(() => {
    if (isRunning()) workerProcess.kill("SIGKILL");
  }, 8000);
  return { ok: true, message: "دستور توقف ارسال شد." };
}

// --- API ---

app.get("/api/config", (req, res) => {
  const cfg = loadConfig();
  // کوکی رو کامل برنمی‌گردونیم، فقط میگیم ست شده یا نه
  res.json({
    playlistUrl: cfg.playlistUrl || "",
    rtmpUrl: cfg.rtmpUrl || "",
    proxyUrl: cfg.proxyUrl || "",
    hasCookies: !!(cfg.cookies && cfg.cookies.trim()),
  });
});

app.post("/api/config", (req, res) => {
  const { playlistUrl, rtmpUrl, cookies, proxyUrl } = req.body || {};
  const cfg = loadConfig();
  if (typeof playlistUrl === "string") cfg.playlistUrl = playlistUrl.trim();
  if (typeof rtmpUrl === "string") cfg.rtmpUrl = rtmpUrl.trim();
  if (typeof proxyUrl === "string") cfg.proxyUrl = proxyUrl.trim();
  if (typeof cookies === "string" && cookies.trim()) cfg.cookies = cookies;
  saveConfig(cfg);
  pushLog("تنظیمات ذخیره شد.");
  res.json({ ok: true });
});

app.post("/api/start", (req, res) => {
  res.json(startWorker());
});

app.post("/api/stop", (req, res) => {
  res.json(stopWorker());
});

app.get("/api/status", (req, res) => {
  res.json({ running: isRunning(), logs: logs.slice(-200) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`پنل کنترل روی پورت ${PORT} بالا اومد.`);
});
