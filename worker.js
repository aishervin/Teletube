// worker.js
// این اسکریپت به صورت یک پروسه جدا اجرا میشه و توسط server.js کنترل (start/stop) میشه.
// کارش: گرفتن لیست ویدیوهای پلی‌لیست، و استریم پشت‌سرهم هرکدوم به آدرس RTMP (تلگرام).
// وقتی پلی‌لیست تموم بشه، دوباره از اول شروع میشه (لوپ بی‌نهایت) مگر این‌که متوقفش کنی.

const { spawn } = require("child_process");

const playlistUrl = process.env.PLAYLIST_URL;
const rtmpUrl = process.env.RTMP_URL;
const cookiesContent = process.env.YT_COOKIES || "";
const proxyUrl = process.env.PROXY_URL || "";
const potBaseUrl = process.env.POT_BASE_URL || "";

if (!playlistUrl || !rtmpUrl) {
  console.error("[worker] PLAYLIST_URL یا RTMP_URL تنظیم نشده، خروج.");
  process.exit(1);
}

const fs = require("fs");
const path = require("path");
const cookiesPath = path.join("/tmp", "cookies.txt");
if (cookiesContent.trim()) {
  fs.writeFileSync(cookiesPath, cookiesContent);
}

function log(line) {
  console.log(`[worker] ${line}`);
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// یک آرگومان مشترک برای yt-dlp (کوکی + پروکسی اگر تعریف شده باشه)
function baseYtdlpArgs() {
  const args = [];
  if (cookiesContent.trim()) {
    args.push("--cookies", cookiesPath);
  }
  if (proxyUrl.trim()) {
    args.push("--proxy", proxyUrl);
  }
  return args;
}

// extractor-args مشترک (player_client + آدرس سرور PO Token در صورت وجود)
function youtubeExtractorArgs(extra) {
  let val = extra || "";
  if (potBaseUrl.trim()) {
    val += (val ? ";" : "") + `getpot_bgutil_baseurl=${potBaseUrl.trim()}`;
  }
  return val ? ["--extractor-args", `youtube:${val}`] : [];
}

function getPlaylistIds() {
  return new Promise((resolve, reject) => {
    const args = [
      ...baseYtdlpArgs(),
      ...youtubeExtractorArgs(),
      "--flat-playlist",
      "--print",
      "%(id)s",
      playlistUrl,
    ];
    const p = spawn("yt-dlp", args);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(err || `yt-dlp exited with code ${code}`));
        return;
      }
      const ids = out
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      resolve(ids);
    });
  });
}

let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});

// شبکه ایمنی: هر خطای پیش‌بینی‌نشده‌ی دیگه هم کل پروسه رو کرش نده، فقط لاگ بشه
process.on("uncaughtException", (e) => {
  log(`خطای پیش‌بینی‌نشده (نادیده گرفته شد تا لوپ ادامه پیدا کنه): ${e.message}`);
});
process.on("unhandledRejection", (e) => {
  log(`Promise رد شده مدیریت‌نشده (نادیده گرفته شد): ${e}`);
});

function streamOneVideo(videoId) {
  return new Promise((resolve) => {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    log(`شروع استریم: ${videoUrl}`);

    // yt-dlp خروجی رو به صورت stream به stdout میده، ffmpeg مستقیم از stdin می‌خونه و به RTMP می‌فرسته
    const ytArgs = [
      ...baseYtdlpArgs(),
      "-f",
      "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
      ...youtubeExtractorArgs("player_client=default,-web_creator"),
      "-o",
      "-",
      videoUrl,
    ];

    const ffArgs = [
      "-re",
      "-i",
      "pipe:0",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-maxrate",
      "3000k",
      "-bufsize",
      "6000k",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "50",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "44100",
      "-f",
      "flv",
      rtmpUrl,
    ];

    const yt = spawn("yt-dlp", ytArgs, { stdio: ["ignore", "pipe", "pipe"] });
    const ff = spawn("ffmpeg", ffArgs, { stdio: ["pipe", "pipe", "pipe"] });

    // مهم: اگر سرور RTMP (تلگرام) اتصال رو قطع کنه، نوشتن روی stdin ffmpeg
    // خطای EPIPE میده. بدون این هندلر، این خطا کل پروسه Node رو کرش می‌کنه.
    ff.stdin.on("error", (e) => {
      log(`ارتباط RTMP قطع شد (${e.code || e.message}) — رد شدن به ویدیوی بعدی.`);
    });
    yt.stdout.on("error", (e) => {
      log(`خطای stream خروجی yt-dlp: ${e.message}`);
    });

    yt.stdout.pipe(ff.stdin);

    yt.stderr.on("data", (d) => {
      const line = d.toString().trim();
      if (line) log(`yt-dlp: ${line.slice(0, 300)}`);
    });
    ff.stderr.on("data", (d) => {
      const line = d.toString().trim();
      if (line) log(`ffmpeg: ${line.slice(0, 300)}`);
    });

    let finished = false;
    function done() {
      if (finished) return;
      finished = true;
      resolve();
    }

    yt.on("error", (e) => {
      log(`خطا در اجرای yt-dlp: ${e.message}`);
    });
    ff.on("error", (e) => {
      log(`خطا در اجرای ffmpeg: ${e.message}`);
    });

    yt.on("close", () => {
      try {
        ff.stdin.end();
      } catch (_) {}
    });

    ff.on("close", (code) => {
      log(`پایان استریم این ویدیو (کد خروج ffmpeg: ${code})`);
      try {
        yt.kill("SIGKILL");
      } catch (_) {}
      done();
    });
  });
}

async function main() {
  log("شروع به کار کارگر استریم...");
  while (!stopped) {
    let ids = [];
    try {
      ids = await getPlaylistIds();
      log(`تعداد ${ids.length} ویدیو در پلی‌لیست پیدا شد.`);
    } catch (e) {
      log(`خطا در گرفتن لیست پلی‌لیست: ${e.message}`);
      await sleep(15000);
      continue;
    }

    if (ids.length === 0) {
      log("پلی‌لیست خالیه، ۳۰ ثانیه صبر می‌کنیم...");
      await sleep(30000);
      continue;
    }

    for (const id of ids) {
      if (stopped) break;
      try {
        await streamOneVideo(id);
      } catch (e) {
        log(`خطا در استریم ویدیوی ${id}: ${e.message}`);
      }
      await sleep(2000);
    }
    log("پلی‌لیست تموم شد، از اول شروع می‌کنیم (لوپ).");
  }
  log("کارگر متوقف شد.");
  process.exit(0);
}

main();
