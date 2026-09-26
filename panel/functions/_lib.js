const WORKFLOW = 'youtube-to-telegram.yml';

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function authorized(request, env) {
  const expected = env.PANEL_PASSWORD || '';
  const provided = request.headers.get('x-panel-password') || '';
  return Boolean(expected && provided && expected === provided);
}

export function denied() {
  return json({ error: 'رمز پنل نادرست است یا پنل هنوز پیکربندی نشده.' }, 401);
}

export function workflowPath() {
  return `/actions/workflows/${WORKFLOW}`;
}

export async function github(env, path, init = {}) {
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN در Cloudflare تنظیم نشده است.');
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER || 'Aishervin'}/${env.GITHUB_REPO || 'teletube'}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'teletube-control-panel',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch (_) {}
  if (!response.ok) throw new Error(`GitHub API خطای ${response.status} برگرداند.`);
  return body;
}

export { WORKFLOW };
