#!/usr/bin/env python3
"""Download playlist items before sending them to a Telegram RTMP stream."""

from __future__ import annotations

import os
import re
import signal
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


PLAYLIST_URL = os.environ.get("PLAYLIST_URL", "").strip()
RTMP_URL = os.environ.get("RTMP_URL", "").strip()
COOKIES = os.environ.get("YT_COOKIES", "")
PROXY_URL = os.environ.get("PROXY_URL", "").strip()
POT_BASE_URL = os.environ.get("POT_BASE_URL", "").strip()
DESTINATION = os.environ.get("DESTINATION", "custom").strip() or "custom"
STREAM_QUALITY = os.environ.get("STREAM_QUALITY", "balanced").strip() or "balanced"

# Web clients support cookies and expose real media formats once the EJS
# challenge solver is enabled. Keep android_vr as a final no-cookie fallback.
CLIENTS = ("web", "web_safari", "web_embedded", "android_vr")
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{6,}$")
QUALITY_PROFILES = {
    "economy": {"max_height": 480, "max_width": 854, "bitrate": "900k", "maxrate": "1100k", "bufsize": "1800k", "audio": "96k", "fps": 25, "gop": 50},
    "balanced": {"max_height": 720, "max_width": 1280, "bitrate": "1500k", "maxrate": "1800k", "bufsize": "3000k", "audio": "128k", "fps": 30, "gop": 60},
    "high": {"max_height": 1080, "max_width": 1920, "bitrate": "2600k", "maxrate": "3200k", "bufsize": "5200k", "audio": "128k", "fps": 30, "gop": 60},
}
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
        "--js-runtimes",
        "node",
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


def format_candidates(max_height: int) -> tuple[str, ...]:
    # Prefer a merged MP4, then allow YouTube's native container choices, and
    # finally fall back to one progressive file for videos with few formats.
    return (
        f"bv*[height<={max_height}][ext=mp4]+ba[ext=m4a]/b[height<={max_height}][ext=mp4]",
        f"bv*[height<={max_height}]+ba/b[height<={max_height}]",
        f"best[height<={max_height}]/best",
    )


def download_video(video_id: str, directory: Path) -> Path | None:
    video_url = f"https://www.youtube.com/watch?v={video_id}"
    profile = QUALITY_PROFILES[STREAM_QUALITY]
    for client in CLIENTS:
        for format_value in format_candidates(profile["max_height"]):
            output = directory / "video.%(ext)s"
            result = run_checked(
                yt_args(client)
                + [
                    "--no-playlist",
                    "--format",
                    format_value,
                    "--merge-output-format",
                    "mp4",
                    "--remux-video",
                    "mp4",
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
                if path.is_file() and path.stat().st_size > 0 and not path.name.endswith(".part")
            ]
            if result.returncode == 0 and files:
                log(f"Prepared {video_id} with {client} and {format_value}")
                return files[0]
            for path in files:
                path.unlink(missing_ok=True)
            details = error_tail(result.stderr)
            if details:
                log(f"Format failed for {video_id} ({client}): {details}")
    return None


def stream_file(video_path: Path) -> int:
    profile = QUALITY_PROFILES[STREAM_QUALITY]
    args = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-re",
        "-i",
        str(video_path),
        "-vf",
        f"scale=w='min({profile['max_width']},iw)':h=-2",
        "-r",
        str(profile["fps"]),
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
        profile["bitrate"],
        "-maxrate",
        profile["maxrate"],
        "-bufsize",
        profile["bufsize"],
        "-pix_fmt",
        "yuv420p",
        "-g",
        str(profile["gop"]),
        "-c:a",
        "aac",
        "-b:a",
        profile["audio"],
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
    if stderr and stderr.strip():
        lines = redact(stderr.strip()).splitlines()[-5:]
        for line in lines:
            log(f"ffmpeg: {line[:500]}")
    return process.returncode


def stream_downloaded(video_id: str, video_path: Path) -> None:
    log(f"Streaming {video_id} from {video_path.suffix[1:] or 'file'} with {STREAM_QUALITY} profile")
    for attempt in range(1, 4):
        code = stream_file(video_path)
        if code == 0 or STOP:
            log(f"Finished {video_id} with ffmpeg exit code {code}")
            return
        log(f"RTMP ended for {video_id} (attempt {attempt}/3); reconnecting in 5 seconds")
        if attempt < 3:
            time.sleep(5)
    log(f"Moving to the next video after RTMP retries for {video_id}")


def stream_playlist(ids: list[str]) -> None:
    # Keep exactly one item ahead downloading while the current item is live.
    with ThreadPoolExecutor(max_workers=1) as executor:
        current_directory = tempfile.TemporaryDirectory(prefix="teletube-")
        current_future = executor.submit(download_video, ids[0], Path(current_directory.name))
        try:
            for index, video_id in enumerate(ids):
                try:
                    video_path = current_future.result()
                except (OSError, subprocess.SubprocessError) as error:
                    log(f"Download task failed for {video_id}: {redact(str(error))}")
                    video_path = None

                next_directory = None
                next_future = None
                if index + 1 < len(ids) and not STOP:
                    next_id = ids[index + 1]
                    next_directory = tempfile.TemporaryDirectory(prefix="teletube-")
                    log(f"Prefetching next item {next_id}")
                    next_future = executor.submit(download_video, next_id, Path(next_directory.name))

                if video_path is None:
                    log(f"Skipping {video_id}: all download formats failed")
                else:
                    try:
                        stream_downloaded(video_id, video_path)
                    except (OSError, subprocess.SubprocessError) as error:
                        log(f"Playback failed for {video_id}: {redact(str(error))}")

                current_directory.cleanup()
                if STOP:
                    break
                if next_directory is None or next_future is None:
                    break
                current_directory = next_directory
                current_future = next_future
        finally:
            current_directory.cleanup()


def main() -> int:
    global STREAM_QUALITY
    if not PLAYLIST_URL or not RTMP_URL:
        log("PLAYLIST_URL and RTMP_URL are required")
        return 1
    if STREAM_QUALITY not in QUALITY_PROFILES:
        log(f"Unknown quality '{STREAM_QUALITY}', using balanced")
        STREAM_QUALITY = "balanced"

    log(f"Destination: {DESTINATION}; quality: {STREAM_QUALITY}; max download: 1080p")

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
        try:
            stream_playlist(ids)
        except (OSError, subprocess.SubprocessError) as error:
            log(f"Playlist pass failed: {redact(str(error))}")
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