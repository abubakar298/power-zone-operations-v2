import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {slowRequestLog,slowRequestThresholdMs} from '../server/http/slow-request-log.js';

type Entry=Parameters<NonNullable<Parameters<typeof slowRequestLog>[0]>['log']&{}>[0];

// A fake clock: every request "takes" the given number of milliseconds.
function appTaking(ms:number,entries:Entry[]){
  let clock=0;
  const app=express();
  app.use('/api',(_req,res,next)=>{res.locals.requestId='req-1';next();});
  app.use('/api',slowRequestLog({thresholdMs:2000,now:()=>clock,log:e=>{entries.push(e);}}));
  const router=express.Router();
  router.get('/records/:id',(_req,res)=>{clock+=ms;res.json({ok:true});});
  router.get('/',(_req,res)=>{clock+=ms;res.json({ok:true});});
  router.get('/broken',()=>{clock+=ms;throw new Error('boom');});
  app.use('/api/project-workflow',router);
  app.use('/api',(_req,res)=>{clock+=ms;res.status(404).json({message:'Not found'});});
  app.use(((_err,_req,res,_next)=>{res.status(503).json({message:'unavailable'});}) as express.ErrorRequestHandler);
  return app;
}

test('slow-request threshold is 2 seconds',()=>{
  assert.equal(slowRequestThresholdMs,2000);
});

test('fast requests are not logged',async()=>{
  const entries:Entry[]=[];
  await request(appTaking(1999,entries)).get('/api/project-workflow?department=design').expect(200);
  assert.deepEqual(entries,[]);
});

test('slow requests log only the route pattern, never IDs or query values',async()=>{
  const entries:Entry[]=[];
  const app=appTaking(2500,entries);
  await request(app).get('/api/project-workflow/records/customer-secret-42?search=Elahi').expect(200);
  await request(app).get('/api/project-workflow?department=design&scope=mine').expect(200);
  await request(app).get('/api/unknown/customer-secret-42').expect(404);
  assert.deepEqual(entries,[
    {event:'request.slow',requestId:'req-1',method:'GET',route:'/api/project-workflow/records/:id',status:200,durationMs:2500,aborted:false},
    {event:'request.slow',requestId:'req-1',method:'GET',route:'/api/project-workflow',status:200,durationMs:2500,aborted:false},
    {event:'request.slow',requestId:'req-1',method:'GET',route:'unmatched',status:404,durationMs:2500,aborted:false},
  ]);
  assert.ok(!JSON.stringify(entries).includes('secret'));
  assert.ok(!JSON.stringify(entries).includes('Elahi'));
});

test('slow failed requests are logged with their status',async()=>{
  const entries:Entry[]=[];
  await request(appTaking(3000,entries)).get('/api/project-workflow/broken').expect(503);
  assert.equal(entries.length,1);
  assert.equal(entries[0].status,503);
  assert.equal(entries[0].durationMs,3000);
});

test('a logging failure never breaks the response',async()=>{
  let clock=0;
  const app=express();
  app.use(slowRequestLog({thresholdMs:1,now:()=>clock,log:()=>{throw new Error('log down');}}));
  app.get('/x',(_req,res)=>{clock+=10;res.json({ok:true});});
  const response=await request(app).get('/x').expect(200);
  assert.deepEqual(response.body,{ok:true});
});
