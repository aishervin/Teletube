# استریم پلی لیست یوتیوب به تلگرام با GitHub Actions

این نسخه به جای Railway، استریم را روی GitHub Actions اجرا می کند. Workflow فایل `worker.js` را اجرا می کند، ویدیوهای پلی لیست را یکی یکی می خواند و با FFmpeg به RTMP تلگرام می فرستد.

## راه اندازی

در ریپوی GitHub به مسیر زیر بروید:

`Settings` → `Secrets and variables` → `Actions` → `New repository secret`

این Secretها را بسازید:

| نام | مقدار |
| --- | --- |
| `PLAYLIST_URL` | لینک پلی لیست یوتیوب |
| `RTMP_URL` | لینک کامل RTMP تلگرام، شامل Stream Key |
| `YT_COOKIES` | محتوای فایل Netscape cookie یوتیوب، اختیاری ولی برای خطای کوکی پیشنهاد می شود |
| `PROXY_URL` | پروکسی کامل، اختیاری |
| `POT_BASE_URL` | آدرس سرویس PO Token، اختیاری |

کوکی را فقط در Secret قرار دهید و هرگز آن را در فایل ریپو، Issue یا لاگ عمومی نگذارید. کوکی های فعلی این پروژه از ریپو حذف شده اند.

## شروع استریم

1. تب `Actions` را باز کنید.
2. Workflow با نام `YouTube playlist to Telegram` را انتخاب کنید.
3. روی `Run workflow` بزنید.

Workflow به صورت زمان بندی شده هم هر ۶ ساعت اجرا می شود. هر اجرای GitHub-hosted حداکثر حدود ۶ ساعت است؛ بنابراین ممکن است بین دو اجرا چند دقیقه قطعی وجود داشته باشد و این روش برای پخش ۲۴ ساعته به اندازه Railway پایدار نیست.

## توقف

در تب `Actions` اجرای فعال را باز کنید و آن را لغو کنید. اجرای زمان بندی شده بعدی دوباره شروع می شود؛ برای توقف کامل، زمان بندی `schedule` را از فایل `.github/workflows/youtube-to-telegram.yml` حذف یا غیرفعال کنید.

## خطاهای رایج

- `Sign in to confirm you're not a bot` یا `403`: کوکی یوتیوب را با یک فایل Netscape جدید جایگزین کنید.
- خطای اتصال RTMP: لینک RTMP و Stream Key را از Live Stream کانال دوباره بگیرید.
- اجرای ناموفق به دلیل Secret: نام Secretها باید دقیقاً مطابق جدول بالا باشد.

## پنل کنترل Cloudflare Pages

فایل های پنل در پوشه `panel` قرار دارند. برای اجرای امن پنل، این متغیرهای سمت سرور Cloudflare Pages را تنظیم کنید:

- `GITHUB_TOKEN`: توکن GitHub با دسترسی Actions برای همین ریپو
- `PANEL_PASSWORD`: رمز ورود به پنل
- `GITHUB_OWNER`: اختیاری؛ مقدار پیش فرض `Aishervin`
- `GITHUB_REPO`: اختیاری؛ مقدار پیش فرض `teletube`

پنل فقط وضعیت Secretها و اجرای Workflow را نشان می دهد و هیچ مقدار محرمانه ای را به مرورگر نمی فرستد.
