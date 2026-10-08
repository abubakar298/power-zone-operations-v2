import { test } from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../server/config.js";
import { accountMessage } from '../server/email/templates.js';
import { ResendDelivery, seal, unseal } from "../server/email/delivery.js";
const env = {
  NODE_ENV: "test",
  APP_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgres://localhost/test",
  ADMIN_SETUP_TOKEN: "test-setup-token-with-32-characters",
  RESEND_API_KEY: "test-provider-key",
  EMAIL_FROM: "e-desk@powerzone.systems",
  EMAIL_REPLY_TO: "support@example.test",
  EMAIL_FROM_NAME: "Rafiq · Power Zone Systems",
  EMAIL_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
};
test("email delivery uses the selected sender name and address without changing recipients", async () => {
  const previous = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({ id: "test-email" }), { status: 200 });
  };
  try {
    await new ResendDelivery(readConfig(env)).send(
      { to: "recipient@example.test", subject: "Test", text: "Test" },
      "test-id",
    );
    assert.equal(
      body.from,
      "Rafiq · Power Zone Systems <e-desk@powerzone.systems>",
    );
    assert.deepEqual(body.to, ["recipient@example.test"]);
    assert.equal(body.reply_to,"support@example.test");
    assert.throws(() =>
      readConfig({
        ...env,
        EMAIL_FROM_NAME: "Rafiq\r\nBcc: other@example.test",
      }),
    );
  } finally {
    globalThis.fetch = previous;
  }
});

test("branded account emails preserve private fragment links through encryption",()=>{
 for(const purpose of ['invite','reset','verify'] as const){
  const url=`https://app.powerzone.systems/account-link#${purpose}/isolated-token`;
  const message=accountMessage(purpose,'recipient@example.test',url,1);
  assert.ok(message.html!.includes(url));assert.ok(message.text.includes(url));assert.ok(message.html!.includes('1 hour and can be used once'));
  const encrypted=seal(message,env.EMAIL_TOKEN_ENCRYPTION_KEY);assert.ok(!encrypted.includes('isolated-token'));assert.deepEqual(unseal(encrypted,env.EMAIL_TOKEN_ENCRYPTION_KEY),message);
  assert.throws(()=>unseal(encrypted,'b'.repeat(64)));
 }
});
test("email delivery refuses disabled sending and sanitizes provider failure details",async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('private provider response',{status:403});};
 try{
  const disabled=new ResendDelivery(readConfig({...env,EMAIL_DELIVERY_ENABLED:'false'}));assert.equal(disabled.configured,false);
  await assert.rejects(disabled.send({to:'recipient@example.test',subject:'Test',text:'Test'},'isolated-id'),/not configured/);assert.equal(calls,0);
  await assert.rejects(new ResendDelivery(readConfig(env)).send(accountMessage('verify','recipient@example.test','https://app.powerzone.systems/account-link#verify/token',24),'isolated-id'),/^Error: Email provider rejected delivery$/);assert.equal(calls,1);
  assert.throws(()=>readConfig({...env,EMAIL_REPLY_TO:'bad\r\nBcc: other@example.test'}));
 }finally{globalThis.fetch=previous;}
});
