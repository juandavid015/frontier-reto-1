// Tests the deployed agent end to end with the practice desktop: reset, send a practice case to the public URL as the
// evaluator would, poll every 5 seconds, then ask the organizers' /__check about the app state.
// Usage: pnpm remote <agent base URL> <case id, e.g. E3> [more case ids]

import { setTimeout as sleep } from 'node:timers/promises';
import { runProbe } from './probe-support.ts';
import { checkApp, httpBaseUrl, loadCases, requireEnv, resetDesktop } from './practice-desktop.ts';

const POLL_MS = 5_000;
// The brief: the evaluator stops polling after 5 minutes.
const GIVE_UP_MS = 5 * 60 * 1000;

await runProbe(async () => {
  const [agentUrl, ...caseIds] = process.argv.slice(2);
  if (!agentUrl || caseIds.length === 0) throw new Error('Usage: pnpm remote <agent base URL> <case id> [...]');
  const env = requireEnv(['DESKTOP_WS_URL', 'DESKTOP_PASSWORD', 'DESKTOP_TOKEN', 'TEAM_TOKEN']);
  const desktopAdmin = httpBaseUrl(env.DESKTOP_WS_URL);
  const cases = (await loadCases('pruebas')).filter((evalCase) => caseIds.includes(evalCase.id));
  const headers = { Authorization: `Bearer ${env.TEAM_TOKEN}`, 'Content-Type': 'application/json' };

  for (const evalCase of cases) {
    await resetDesktop(desktopAdmin, env.DESKTOP_TOKEN);
    const startedAt = performance.now();
    const posted = await fetch(`${agentUrl}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tarea: evalCase.instruccion,
        escritorio: { url: env.DESKTOP_WS_URL, password: env.DESKTOP_PASSWORD },
      }),
    });
    const postMs = Math.round(performance.now() - startedAt);
    if (!posted.ok) throw new Error(`POST /tasks answered ${posted.status}`);
    const { task_id: taskId } = (await posted.json()) as { task_id: string };
    console.log(`${evalCase.id}: POST /tasks answered in ${postMs} ms (limit 2000), task ${taskId}`);

    let state = { estado: 'en_curso', resumen: '' };
    while (state.estado === 'en_curso' && performance.now() - startedAt < GIVE_UP_MS) {
      await sleep(POLL_MS);
      state = (await (await fetch(`${agentUrl}/tasks/${taskId}`, { headers })).json()) as typeof state;
    }
    const seconds = Math.round((performance.now() - startedAt) / 1000);
    const appCheck = await checkApp(desktopAdmin, env.DESKTOP_TOKEN, evalCase);
    console.log(`${evalCase.id}: estado=${state.estado} (expected ${evalCase.estado_esperado}) after ${seconds} s`);
    console.log(`  resumen: ${state.resumen.replaceAll('\n', ' | ')}`);
    console.log(`  app check: ${JSON.stringify(appCheck)}`);
  }
});
