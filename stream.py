#!/usr/bin/env python3
"""Download playlist items before sending them to a Telegram RTMP stream."""

from __future__ import annotations

import os
import re
import signal
import subprocess
import tempfile
import time
from pathlib import Path


PLAYLIST_URL = os.environ.get("PLAYLIST_URL", "").strip()
RTMP_URL = os.environ.get("RTMP_URL", "").strip()
COOKIES = os.environ.get("YT_COOKIES", "")
PROXY_URL = os.environ.get("PROXY_URL", "").strip()
POT_BASE_URL = os.environ.get("POT_BASE_URL", "").strip()

# android_vr currently exposes a progressive format without the web client's
# "The page needs to be reloaded" failure. The other clients are fallbacks.
CLIENTS = ("android_vr", "android", "web_safari")
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{6,}$")
STOP = False


def log(message: str) -> None:
    print(f"[stream] {message}", flush=True)


def redact(text: str) -> str:
    for secret in (RTMP_URL, PLAYLIST_URL, PROXY_URL, COOKIES):
        if secret:
            text = text.replace(secret, "[redacted]")
    return text


def error_tail(text: str) -> str:
    return redact(" | ".join(text.strip().splitlines()[-3:]))


def handle_signal(_signum: int, _frame: object) -> None:
    global STOP
    STOP = True
    log("Stop requested")


def extractor_args(client: str) -> str:
    value = f"player_client={client}"
    if POT_BASE_URL:
        value += f";getpot_bgutil_baseurl={POT_BASE_URL}"
    return value


def yt_args(client: str) -> list[str]:
    args = [
        "yt-dlp",
        "--ignore-config",
        "--no-warnings",
        "--extractor-args",
        f"youtube:{extractor_args(client)}",
        "--retries",
        "3",
        "--fragment-retries",
        "3",
        "--file-access-retries",
        "3",
        "--socket-timeout",
        "30",
    ]
    if COOKIES.strip():
        args += ["--cookies", COOKIES_PATH]
    if PROXY_URL:
        args += ["--proxy", PROXY_URL]
    return args


def run_checked(args: list[str], *, timeout: int | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )


def playlist_ids() -> list[str]:
    for client in CLIENTS:
        result = run_checked(
            yt_args(client)
            + [
                "--flat-playlist",
                "--ignore-errors",
                "--print",
                "%(id)s",
                PLAYLIST_URL,
            ],
            timeout=180,
        )
        ids: list[str] = []
        for line in result.stdout.splitlines():
            video_id = line.strip()
            if VIDEO_ID.fullmatch(video_id) and video_id not in ids:
                ids.append(video_id)
        if ids:
            log(f"Found {len(ids)} playlist item(s) with client {client}")
            return ids
        details = error_tail(result.stderr)
        if details:
            log(f"Playlist client {client} failed: {details}")
    return []


def download_video(video_id: str, directory: Path) -> Path | None:
    video_url = f"https://www.youtube.com/watch?v={video_id}"
    for client in CLIENTS:
        output = directory / "video.%(ext)s"
        result = run_checked(
            yt_args(client)
            + [
                "--no-playlist",
                "--format",
                "best[height<=1080]/best",
                "--output",
                str(output),
                "--no-part",
                "--force-overwrites",
                video_url,
            ],
            timeout=900,
        )
        files = [
            path
            for path in directory.glob("video.*")
            if path.is_file() and path.stat().st_size > 0
        ]
        if result.returncode == 0 and files:
            return files[0]
        for path in files:
            path.unlink(missing_ok=True)
        details = error_tail(result.stderr)
        if details:
            log(f"Download client {client} failed for {video_id}: {details}")
    return None


def stream_file(video_path: Path) -> int:
    args = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-re",
        "-i",
        str(video_path),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "zerolatency",
        "-b:v",
        "2500k",
        "-maxrate",
        "2500k",
        "-bufsize",
        "5000k",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "60",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "44100",
        "-f",
        "flv",
        RTMP_URL,
    ]
    process = subprocess.Popen(
        args,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    while process.poll() is None:
        if STOP:
            process.terminate()
        try:
            stderr, _ = process.communicate(timeout=1)
            break
        except subprocess.TimeoutExpired:
            continue
    else:
        stderr, _ = process.communicate()
    if stderr.strip():
        lines = redact(stderr.strip()).splitlines()[-5:]
        for line in lines:
            log(f"ffmpeg: {line[:500]}")
    return process.returncode


def stream_video(video_id: str) -> None:
    with tempfile.TemporaryDirectory(prefix="teletube-") as directory_name:
        directory = Path(directory_name)
        log(f"Downloading {video_id}")
        video_path = download_video(video_id, directory)
        if video_path is None:
            log(f"Skipping {video_id}: download failed")
            return
        log(f"Streaming {video_id} from {video_path.suffix[1:] or 'file'}")
        code = stream_file(video_path)
        log(f"Finished {video_id} with ffmpeg exit code {code}")


def main() -> int:
    if not PLAYLIST_URL or not RTMP_URL:
        log("PLAYLIST_URL and RTMP_URL are required")
        return 1

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)
    while not STOP:
        try:
            ids = playlist_ids()
        except (OSError, subprocess.SubprocessError) as error:
            log(f"Playlist lookup failed: {redact(str(error))}")
            ids = []
        if not ids:
            log("No playable playlist items; retrying in 30 seconds")
            time.sleep(30)
            continue
        for video_id in ids:
            if STOP:
                break
            try:
                stream_video(video_id)
            except (OSError, subprocess.SubprocessError) as error:
                log(f"Item {video_id} failed: {redact(str(error))}")
            if not STOP:
                time.sleep(2)
        if not STOP:
            log("Playlist finished; refreshing in 30 seconds")
            time.sleep(30)
    return 0


with tempfile.NamedTemporaryFile("w", prefix="teletube-cookies-", suffix=".txt", delete=False) as cookie_file:
    COOKIES_PATH = cookie_file.name
    if COOKIES.strip():
        cookie_file.write(COOKIES)

try:
    raise SystemExit(main())
finally:
    try:
        Path(COOKIES_PATH).unlink(missing_ok=True)
    except OSError:
        pass
