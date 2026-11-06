import{test}from'node:test';import assert from'node:assert/strict';
import{notificationWorker}from'../server/notifications/worker.js';
test('notification worker skips overlaps, backs off failures and resumes without replaying commands',async()=>{
 let now=0,calls=0,fail=true,release!:()=>void;const retries:number[]=[];
 const worker=notificationWorker(async()=>{calls++;if(calls===1)await new Promise<void>(r=>{release=r;});if(fail)throw Error('offline');},(_e,delay)=>retries.push(delay),()=>now);
 const first=worker();await worker();assert.equal(calls,1);release();await first;
 assert.deepEqual(retries,[60000]);now=59999;await worker();assert.equal(calls,1);
 now=60000;await worker();assert.deepEqual(retries,[60000,120000]);
 now=180000;fail=false;await worker();assert.equal(calls,3);
 now+=29999;await worker();assert.equal(calls,3);now++;await worker();assert.equal(calls,4);
 fail=true;now+=30000;await worker();assert.equal(retries.at(-1),60000);
 for(let i=0;i<8;i++){now+=300000;await worker();}assert.equal(retries.at(-1),300000);
});
