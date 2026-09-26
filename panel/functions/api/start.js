import { authorized, denied, github, json, workflowPath } from '../_lib.js';

const destinations = new Set(['channel', 'group', 'custom']);
const qualities = new Set(['economy', 'balanced', 'high']);

export async function onRequestPost({ request, env }) {
  if (!authorized(request, env)) return denied();
  try {
    const body = await request.json().catch(() => ({}));
    const playlistUrl = typeof body.playlistUrl === 'string' ? body.playlistUrl.trim() : '';
    const destination = destinations.has(body.destination) ? body.destination : 'channel';
    const streamQuality = qualities.has(body.streamQuality) ? body.streamQuality : 'balanced';
    const rtmpUrl = typeof body.rtmpUrl === 'string' ? body.rtmpUrl.trim() : '';
    const proxyUrl = typeof body.proxyUrl === 'string' ? body.proxyUrl.trim() : '';

    if (destination === 'custom' && !rtmpUrl) {
      return json({ error: 'مقصد سفارشی به آدرس RTMP نیاز دارد.' }, 400);
    }

    const inputs = { destination, stream_quality: streamQuality };
    if (playlistUrl) inputs.playlist_url = playlistUrl;
    if (proxyUrl) inputs.proxy_url = proxyUrl;
    if (destination === 'custom') inputs.rtmp_url = rtmpUrl;

    await github(env, `${workflowPath()}/dispatches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: env.GITHUB_REF || 'main', inputs }),
    });
    return json({ ok: true, message: 'اجرای جدید در صف GitHub Actions قرار گرفت.' });
  } catch (error) {
    return json({ error: error.message || 'شروع اجرا ناموفق بود.' }, 502);
  }
}
