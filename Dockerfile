FROM node:20-bookworm-slim

# ffmpeg + python (برای yt-dlp) + ابزارهای پایه
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 python3-pip curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp همیشه آخرین نسخه (یوتیوب مدام تغییر می‌کنه)
RUN pip3 install --no-cache-dir --break-system-packages -U yt-dlp

# PO Token provider: جایگزین کوکی برای عبور از چک "Sign in to confirm you're not a bot"
# دو بخش داره: سرور Node (که اجرا میشه و توکن تولید می‌کنه) و پلاگین پایتون (که yt-dlp ازش استفاده می‌کنه)
RUN npm install -g bgutil-ytdlp-pot-provider
RUN pip3 install --no-cache-dir --break-system-packages -U bgutil-ytdlp-pot-provider

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY . .
RUN chmod +x start.sh

ENV NODE_ENV=production
ENV DATA_DIR=/data

EXPOSE 3000
CMD ["./start.sh"]
