#!/bin/sh
# این اسکریپت اول سرور PO Token رو در پس‌زمینه بالا می‌آره
# (جایگزین کوکی برای دور زدن چک ربات یوتیوب)، بعد پنل کنترل رو اجرا می‌کنه.

echo "[start] در حال اجرای سرور PO Token..."
bgutil-pot-server > /tmp/pot-server.log 2>&1 &
POT_PID=$!

# چند ثانیه صبر می‌کنیم تا سرور PO Token بالا بیاد
sleep 3

if kill -0 "$POT_PID" 2>/dev/null; then
  echo "[start] سرور PO Token با موفقیت اجرا شد (pid $POT_PID)."
else
  echo "[start] هشدار: سرور PO Token بالا نیومد، ادامه بدون آن..."
fi

echo "[start] در حال اجرای پنل کنترل..."
exec node server.js
