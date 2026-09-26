import { authorized, denied, github, json, workflowPath } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  if (!authorized(request, env)) return denied();
  try {
    await github(env, `${workflowPath()}/dispatches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: env.GITHUB_REF || 'main' }),
    });
    return json({ ok: true, message: 'دستور شروع ارسال شد.' });
  } catch (error) {
    return json({ error: error.message || 'شروع استریم انجام نشد.' }, 502);
  }
}
