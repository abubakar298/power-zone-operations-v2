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

test('quotation PDF bytes are passed to Resend as a named Base64 attachment',async()=>{
 const previous=globalThis.fetch;let body:any,headers:any;
 globalThis.fetch=async(_url,options)=>{body=JSON.parse(String(options?.body));headers=options?.headers;return new Response(JSON.stringify({id:'attachment-test'}),{status:200});};
 try{
  const attachments=[{filename:'UBL - Walton Road 1236 - Quotation - Q123-R1.pdf',content:Buffer.from('%PDF-1.4\nfixture').toString('base64')}];
  await new ResendDelivery(readConfig(env)).send({to:'director@example.test',subject:'Quotation approval',text:'Exact saved quotation',attachments},'stable-notification-id');
  assert.deepEqual(body.attachments,attachments);assert.deepEqual(body.to,['director@example.test']);assert.equal(headers['Idempotency-Key'],'stable-notification-id');
  assert.equal(Buffer.from(body.attachments[0].content,'base64').subarray(0,5).toString(),'%PDF-');
 }finally{globalThis.fetch=previous;}
});

test('IPO emails preserve fixed CC and thread headers and retrieve the actual provider Message-ID',async()=>{
 const previous=globalThis.fetch;let body:any;const urls:string[]=[];
 globalThis.fetch=async(url,options)=>{urls.push(String(url));if(options?.method==='POST'){body=JSON.parse(String(options.body));return new Response(JSON.stringify({id:'provider-reference'}));}return new Response(JSON.stringify({message_id:'<actual-rfc@example.test>'}));};
 try{
  const delivery=new ResendDelivery(readConfig(env));
  await delivery.send({to:'recipient@example.test',cc:['cc@example.test'],subject:'Original IPO subject',text:'Signed document',headers:{'In-Reply-To':'<old@example.test>',References:'<root@example.test> <old@example.test>'}},'ipo-stable-id');
  assert.deepEqual(body.cc,['cc@example.test']);assert.equal(body.headers['In-Reply-To'],'<old@example.test>');assert.equal(body.headers['Message-ID'],undefined);
  assert.equal(await delivery.getMessageId('provider-reference'),'<actual-rfc@example.test>');assert.equal(urls[1],'https://api.resend.com/emails/provider-reference');
 }finally{globalThis.fetch=previous;}
});
