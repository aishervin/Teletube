FROM node:20-bookworm-slim

# ffmpeg + python (برای yt-dlp) + ابزارهای پایه
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 python3-pip curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp همیشه آخرین نسخه (یوتیوب مدام تغییر می‌کنه)
RUN pip3 install --no-cache-dir --break-system-packages -U yt-dlp

# پلاگین PO Token برای yt-dlp (سرور تولید توکن به‌صورت جدا روی Railway اجرا میشه، اینجا فقط پلاگین سمت کلاینت لازمه)
RUN pip3 install --no-cache-dir --break-system-packages -U bgutil-ytdlp-pot-provider

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV DATA_DIR=/data

EXPOSE 3000
CMD ["node", "server.js"]
