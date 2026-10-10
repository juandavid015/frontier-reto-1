// Starts the agent's HTTP server. Reads TEAM_TOKEN and OPENROUTER_API_KEY from the environment; PORT is set by the host.

import path from 'node:path';
import { createAgentServer } from './http-server.ts';

const DEFAULT_PORT = 3000;

function requireVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const server = createAgentServer({
  teamToken: requireVariable('TEAM_TOKEN'),
  apiKey: requireVariable('OPENROUTER_API_KEY'),
  traceRoot: path.join('artifacts', 'runs'),
});
server.listen(port, () => console.log(`Agent listening on port ${port}`));
