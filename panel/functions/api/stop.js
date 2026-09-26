import { authorized, denied, github, json, workflowPath } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  if (!authorized(request, env)) return denied();
  try {
    const data = await github(env, `${workflowPath()}/runs?per_page=20`);
    const run = (data.workflow_runs || []).find((item) => ['queued', 'in_progress'].includes(item.status));
    if (!run) return json({ ok: true, message: 'اجرای فعالی پیدا نشد.' });
    await github(env, `/actions/runs/${run.id}/cancel`, { method: 'POST' });
    return json({ ok: true, message: 'دستور توقف ارسال شد.' });
  } catch (error) {
    return json({ error: error.message || 'توقف استریم انجام نشد.' }, 502);
  }
}
