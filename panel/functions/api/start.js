import { authorized, denied, github, json, workflowPath } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  if (!authorized(request, env)) return denied();
  try {
    const body = await request.json().catch(() => ({}));
    const playlistUrl = typeof body.playlistUrl === 'string' ? body.playlistUrl.trim() : '';
    const rtmpUrl = typeof body.rtmpUrl === 'string' ? body.rtmpUrl.trim() : '';
    const proxyUrl = typeof body.proxyUrl === 'string' ? body.proxyUrl.trim() : '';
    if (!playlistUrl || !rtmpUrl) return json({ error: 'لینک پلی‌لیست و RTMP لازم است.' }, 400);
    await github(env, `${workflowPath()}/dispatches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: env.GITHUB_REF || 'main', inputs: { playlist_url: playlistUrl, rtmp_url: rtmpUrl, proxy_url: proxyUrl } }),
    });
    return json({ ok: true, message: 'دستور شروع ارسال شد.' });
  } catch (error) {
    return json({ error: error.message || 'شروع استریم انجام نشد.' }, 502);
  }
}
