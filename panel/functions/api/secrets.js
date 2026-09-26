import { authorized, denied, github, json } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  if (!authorized(request, env)) return denied();
  try {
    const data = await github(env, '/actions/secrets?per_page=100');
    const names = new Set((data.secrets || []).map((secret) => secret.name));
    return json({
      PLAYLIST_URL: names.has('PLAYLIST_URL'),
      CSTREAM_RTMPS_URL: names.has('CSTREAM_RTMPS_URL'),
      GSTREAM_RTMPS_URL: names.has('GSTREAM_RTMPS_URL'),
      RTMP_URL: names.has('RTMP_URL'),
      YT_COOKIES: names.has('YT_COOKIES'),
      PROXY_URL: names.has('PROXY_URL'),
      POT_BASE_URL: names.has('POT_BASE_URL'),
    });
  } catch (error) {
    return json({ error: error.message || 'خواندن Secretها ناموفق بود.' }, 502);
  }
}
