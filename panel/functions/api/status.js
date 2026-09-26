import { authorized, denied, github, json, workflowPath } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  if (!authorized(request, env)) return denied();
  try {
    const data = await github(env, `${workflowPath()}/runs?per_page=5`);
    const latest = data.workflow_runs?.[0] || null;
    const jobsData = latest
      ? await github(env, `/actions/runs/${latest.id}/jobs?per_page=20`)
      : { jobs: [] };
    return json({
      run: latest && {
        id: latest.id,
        run_number: latest.run_number,
        status: latest.status,
        conclusion: latest.conclusion,
        created_at: latest.created_at,
        updated_at: latest.updated_at,
        html_url: latest.html_url,
      },
      jobs: (jobsData.jobs || []).map((job) => ({
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
      })),
      recent: (data.workflow_runs || []).map((run) => ({
        run_number: run.run_number,
        status: run.status,
        conclusion: run.conclusion,
        created_at: run.created_at,
        html_url: run.html_url,
      })),
    });
  } catch (error) {
    return json({ error: error.message || 'خواندن وضعیت ناموفق بود.' }, 502);
  }
}
