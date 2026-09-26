import { authorized, denied, github, json, workflowPath } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  if (!authorized(request, env)) return denied();
  try {
    const data = await github(env, `${workflowPath()}/runs?per_page=10`);
    const run = data.workflow_runs?.[0] || null;
    const jobs = run ? await github(env, `/actions/runs/${run.id}/jobs?per_page=20`) : { jobs: [] };
    return json({
      run: run && {
        id: run.id,
        run_number: run.run_number,
        status: run.status,
        conclusion: run.conclusion,
        created_at: run.created_at,
        updated_at: run.updated_at,
        html_url: run.html_url,
      },
      jobs: (jobs.jobs || []).map((job) => ({ name: job.name, status: job.status, conclusion: job.conclusion })),
    });
  } catch (error) {
    return json({ error: error.message || 'دریافت وضعیت انجام نشد.' }, 502);
  }
}
