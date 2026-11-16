import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Pool} from 'pg';
import request from 'supertest';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';

// Static files are served without touching the database, so no pool is needed.
async function webApp(){
  const directory=await mkdtemp(join(tmpdir(),'pz-static-cache-'));
  await mkdir(join(directory,'assets'));await mkdir(join(directory,'brand'));
  await writeFile(join(directory,'index.html'),'<!doctype html><title>Power Zone</title>');
  await writeFile(join(directory,'assets','App-DRZ4ujdI.js'),'console.log("app")');
  await writeFile(join(directory,'brand','logo.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');
  const app=createApp({} as Pool,readConfig({NODE_ENV:'test',APP_ORIGIN:'http://127.0.0.1:3199',DATABASE_URL:'postgresql://postgres@127.0.0.1:5432/postgres',ADMIN_SETUP_TOKEN:'isolated-static-cache-test-only-00000000'}),directory);
  return {app,close:()=>rm(directory,{recursive:true,force:true})};
}

test('fingerprinted build files in /assets are cached for a year as immutable',async()=>{
  const {app,close}=await webApp();
  try{
    const response=await request(app).get('/assets/App-DRZ4ujdI.js').expect(200);
    assert.equal(response.headers['cache-control'],'public, max-age=31536000, immutable');
    assert.match(response.text,/console\.log/);
  }finally{await close();}
});

test('other web files keep the one-hour cache and the page itself is never cached',async()=>{
  const {app,close}=await webApp();
  try{
    const logo=await request(app).get('/brand/logo.svg').expect(200);
    assert.equal(logo.headers['cache-control'],'public, max-age=3600');
    for(const path of ['/','/dashboard']){
      const page=await request(app).get(path).expect(200);
      assert.equal(page.headers['cache-control'],'no-store',path);
      assert.match(page.text,/<title>Power Zone<\/title>/,path);
    }
  }finally{await close();}
});

// After a release the previous build's files are gone. An open tab asking for one must get
// "not found", not the page itself, so the browser reports a failed load the app can recover from.
test('a missing build file in /assets is not found and never answered with the page',async()=>{
  const {app,close}=await webApp();
  try{
    for(const path of ['/assets/missing-file.js','/assets/App-oldbuild.css','/assets/nested/missing.js']){
      const response=await request(app).get(path).expect(404);
      assert.equal(response.headers['cache-control'],'no-store',path);
      assert.doesNotMatch(response.text,/<title>Power Zone<\/title>/,path);
    }
  }finally{await close();}
});
