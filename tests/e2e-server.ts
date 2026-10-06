import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { testDatabase } from './database.js';

const db = await testDatabase();
const env = {
  ...process.env, NODE_ENV: 'test', PORT: '3180', APP_ORIGIN: 'http://127.0.0.1:3180',
  DATABASE_URL: db.url, ADMIN_SETUP_TOKEN: 'browser-test-setup-key-isolated-only',
};
let app: ReturnType<typeof spawn>;
async function startApp() {
  app = spawn(process.execPath,['dist/server/main.js'],{env,stdio:'inherit'});
  for (let i = 0; i < 100; i++) {
    if (app.exitCode !== null) throw new Error('Test API process exited');
    try { if ((await fetch('http://127.0.0.1:3180/api/health')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve,100));
  }
  throw new Error('Test API did not become healthy');
}
await startApp();
let restarting = false;
let generation = 0;
process.on('SIGUSR2', () => {
  if (restarting) return;
  restarting = true;
  void (async () => {
    const exited = once(app,'exit'); app.kill('SIGTERM'); await exited;
    await startApp();
    generation++;
    await import('node:fs/promises').then(fs => fs.writeFile('.local/e2e-control.json',JSON.stringify({pid:process.pid,generation})));
    restarting = false;
  })().catch(() => { console.error('Test restart failed.'); process.exit(1); });
});
let closing = false;
async function stop() {
  if (closing) return; closing = true;
  if (app.exitCode === null) { const exited=once(app,'exit');app.kill('SIGTERM');await exited; }
  await db.close(); process.exit(0);
}
process.on('SIGTERM', () => {void stop();});
process.on('SIGINT', () => {void stop();});
// Browser test can request a restart without a production HTTP backdoor.
await import('node:fs/promises').then(fs => fs.writeFile('.local/e2e-control.json',JSON.stringify({pid:process.pid,generation})));
