// Experiment: can we see the remote desktop? Connects, prints the screen size, saves one PNG, disconnects.
// Usage: npm run probe:screenshot   (reads DESKTOP_WS_URL and DESKTOP_PASSWORD from .env)

import { VncClient } from '../src/vnc/vnc-client.ts';
import { createRunDirectory, desktopSettings, elapsedMs, runProbe, saveFrame } from './probe-support.ts';

await runProbe(async () => {
  const { url, password, host } = desktopSettings();
  console.log(`Connecting to ${host} ...`);
  const startedAt = performance.now();
  const client = await VncClient.connect({ url, password });
  try {
    console.log(`Logged in and received the first full screen after ${elapsedMs(startedAt)} ms`);
    console.log(`Desktop name: "${client.serverName}"`);
    console.log(`Screen: ${client.width}x${client.height}`);
    console.log(`Saved ${await saveFrame(await createRunDirectory(), 'screenshot', client.screenshot())}`);
  } finally {
    client.close();
    console.log('Connection closed');
  }
});
