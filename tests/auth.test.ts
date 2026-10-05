import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { readConfig, type Config } from '../server/config.js';
import { migrate } from '../server/db/migrate.js';
import { testDatabase } from './database.js';
import { digest, hashPassword } from '../server/auth/crypto.js';

const origin = 'http://localhost:3000';
const setupToken = 'test-setup-key-for-isolated-tests-only';
const password = 'long test passphrase 298!';
const admin = { displayName: 'Abu Bakar', email: 'admin@example.test', password, setupToken };
let db: Awaited<ReturnType<typeof testDatabase>>;
let config: Config;
let app: ReturnType<typeof createApp>;
before(async () => {
  db = await testDatabase();
  config = readConfig({NODE_ENV: 'test', APP_ORIGIN: origin, DATABASE_URL: db.url, ADMIN_SETUP_TOKEN: setupToken});
  app = createApp(db.pool, config);
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.pool.query('TRUNCATE auth_sessions, auth_rate_limits, audit_log, users');
  await db.pool.query('UPDATE admin_bootstrap SET completed_at = NULL');
});
function post(path: string, body: object) { return request(app).post(path).set('Origin', origin).send(body); }
async function setup() { await post('/api/auth/setup', admin).expect(201); }
async function login(email = admin.email, secret = password) {
  const r = await post('/api/auth/login', {email, password: secret}).expect(200);
  return { cookie: r.headers['set-cookie'][0].split(';')[0] as string, csrf: r.body.csrfToken as string, result: r };
}

test('setup → login → authenticated dashboard → logout → login again', async () => {
  await request(app).get('/api/auth/status').expect(200, {setupRequired: true});
  await setup();
  await request(app).get('/api/auth/status').expect(200, {setupRequired: false});
  const s = await login('ADMIN@EXAMPLE.TEST');
  assert.match(s.result.headers['set-cookie'][0], /HttpOnly/);
  assert.match(s.result.headers['set-cookie'][0], /SameSite=Strict/);
  assert.equal(s.result.headers['cache-control'], 'no-store');
  assert.equal(s.result.body.user.role, 'Admin');
  assert.equal(s.result.body.user.password_hash, undefined);
  await request(app).get('/api/dashboard').set('Cookie', s.cookie).expect(200);
  await post('/api/auth/logout', {}).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).expect(204);
  await request(app).get('/api/dashboard').set('Cookie', s.cookie).expect(401);
  const next = await login();
  assert.notEqual(next.cookie, s.cookie);
  await request(app).get('/api/dashboard').set('Cookie', next.cookie).expect(200);
  const audit = await db.pool.query('SELECT action FROM audit_log ORDER BY id');
  assert.deepEqual(audit.rows.map(r => r.action), ['admin.setup','auth.login','auth.logout','auth.login']);
});

test('admin setup requires a secret and cannot be repeated or reopened by deleting users', async () => {
  await post('/api/auth/setup', {...admin, setupToken: 'bad'}).expect(403);
  await post('/api/auth/setup', {...admin, password: 'short'}).expect(400);
  assert.equal((await db.pool.query('SELECT count(*) FROM users')).rows[0].count, '0');
  await setup();
  await post('/api/auth/setup', {...admin, email: 'second@example.test'}).expect(409);
  await db.pool.query('DELETE FROM audit_log'); await db.pool.query('DELETE FROM users');
  await post('/api/auth/setup', admin).expect(409);
});

test('concurrent setup creates exactly one administrator', async () => {
  const results = await Promise.all([post('/api/auth/setup', admin), post('/api/auth/setup', {...admin,email:'other@example.test'})]);
  assert.deepEqual(results.map(r => r.status).sort(), [201,409]);
  assert.equal((await db.pool.query('SELECT count(*) FROM users')).rows[0].count, '1');
});

test('anonymous, forged and expired sessions cannot access the dashboard', async () => {
  await request(app).get('/api/dashboard').expect(401);
  await request(app).get('/api/dashboard').set('Cookie', `pz_session=${'x'.repeat(43)}`).expect(401);
  await setup(); const s = await login();
  await db.pool.query("UPDATE auth_sessions SET expires_at=now()-interval '1 second'");
  await request(app).get('/api/dashboard').set('Cookie', s.cookie).expect(401);
});

test('invalid and unknown credentials use the same message; disabled users are denied', async () => {
  await setup();
  const wrong = await post('/api/auth/login', {email: admin.email, password: 'bad'}).expect(401);
  const unknown = await post('/api/auth/login', {email: 'missing@example.test', password}).expect(401);
  assert.deepEqual(wrong.body, unknown.body);
  await db.pool.query('UPDATE users SET active=false');
  await post('/api/auth/login', {email: admin.email, password}).expect(401);
});

test('all mutation requests require the configured origin and JSON; logout also requires CSRF', async () => {
  await request(app).post('/api/auth/setup').send(admin).expect(403);
  await request(app).post('/api/auth/setup').set('Origin','https://evil.example').send(admin).expect(403);
  await request(app).post('/api/auth/setup').set('Origin',origin).type('form').send(admin).expect(415);
  await setup(); const s = await login();
  await post('/api/auth/logout', {}).set('Cookie',s.cookie).expect(403);
  await post('/api/auth/logout', {}).set('Cookie',s.cookie).set('X-CSRF-Token','bad').expect(403);
  await request(app).get('/api/dashboard').set('Cookie',s.cookie).expect(200);
});

test('login rotates and revokes an existing session and stores only the token digest', async () => {
  await setup(); const s = await login();
  const next = await post('/api/auth/login',{email:admin.email,password}).set('Cookie',s.cookie).expect(200);
  assert.notEqual(next.headers['set-cookie'][0].split(';')[0],s.cookie);
  await request(app).get('/api/dashboard').set('Cookie',s.cookie).expect(401);
  const sessions = await db.pool.query('SELECT token_hash FROM auth_sessions');
  assert.equal(sessions.rowCount,1);
  assert.equal(sessions.rows[0].token_hash,digest(next.headers['set-cookie'][0].split(';')[0].split('=')[1]));
});

test('sessions and rate limits survive a new application instance', async () => {
  await setup(); const s = await login();
  const restarted = createApp(db.pool, config);
  await request(restarted).get('/api/auth/session').set('Cookie',s.cookie).expect(200);
  assert.equal((await db.pool.query('SELECT count(*) FROM auth_rate_limits')).rows[0].count,'3');
});

test('persisted login throttling blocks repeated requests', async () => {
  await setup();
  await db.pool.query(`INSERT INTO auth_rate_limits (bucket_hash, attempts, reset_at) VALUES ($1,10,now()+interval '15 minutes')`,[digest(`login-email:${admin.email}`)]);
  const r = await post('/api/auth/login',{email:admin.email,password}).expect(429);
  assert.equal(r.headers['retry-after'],'900');
  assert.equal((await db.pool.query('SELECT count(*) FROM auth_sessions')).rows[0].count,'0');
});

test('migrations are repeatable without changing an existing password or display name', async () => {
  await setup(); await db.pool.query("UPDATE users SET display_name='Manually edited'");
  const before = (await db.pool.query('SELECT password_hash FROM users')).rows[0].password_hash;
  await Promise.all([migrate(db.pool), migrate(db.pool)]);
  const after = (await db.pool.query('SELECT display_name,password_hash FROM users')).rows[0];
  assert.equal(after.password_hash,before); assert.equal(after.display_name,'Manually edited');
  assert.equal((await db.pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count,'1');
});

test('production cookies use the host prefix and Secure', async () => {
  await setup();
  const production = createApp(db.pool,{...config,production:true,origin:'https://pz.example'});
  const r = await request(production).post('/api/auth/login').set('Origin','https://pz.example').send({email:admin.email,password}).expect(200);
  assert.match(r.headers['set-cookie'][0],/^__Host-pz_session=/);
  assert.match(r.headers['set-cookie'][0],/; Secure/);
  assert.match(r.headers['strict-transport-security'],/max-age=/);
});

test('all three initial roles are persisted and returned; role cannot be supplied through login', async () => {
  await setup();
  const hashed = await hashPassword(password);
  for (const role of ['Management','Employee']) {
    const email = `${role.toLowerCase()}@example.test`;
    await db.pool.query(`INSERT INTO users (id,email,display_name,password_hash,role) VALUES (gen_random_uuid(),$1,$2,$3,$2)`,[email,role,hashed]);
    assert.equal((await login(email)).result.body.user.role,role);
  }
  await post('/api/auth/login',{email:admin.email,password,role:'Admin'}).expect(400);
});

test('invalid JSON and oversized requests return clean errors', async () => {
  await request(app).post('/api/auth/login').set('Origin',origin).set('Content-Type','application/json').send('{bad').expect(400);
  await post('/api/auth/login',{email:admin.email,password:'a'.repeat(9000)}).expect(413);
});

test('production rejects HTTP and invalid origin/configuration', () => {
  assert.throws(() => readConfig({NODE_ENV:'production',APP_ORIGIN:origin,DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:setupToken}),/HTTPS/);
  assert.throws(() => readConfig({APP_ORIGIN:origin+'/',DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:setupToken}),/origin/);
  assert.throws(() => readConfig({APP_ORIGIN:origin,DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'short'}),/ADMIN_SETUP_TOKEN/);
});
