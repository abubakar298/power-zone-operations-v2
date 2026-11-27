import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildName,newReleaseLive,releaseReloadDecision,releaseReloadGapMs,releaseReloadMessage} from '../web/navigation/release-reload.js';

const page=(build:string)=>`<!doctype html><html><head><script type="module" crossorigin src="/assets/${build}"></script><link rel="stylesheet" href="/assets/index-D3Gfq-T_.css"></head></html>`;

test('only a different live build counts as a new release',()=>{
  assert.equal(buildName(page('index-C8nt2Oos.js')),'index-C8nt2Oos.js');
  assert.equal(buildName('/assets/index-C8nt2Oos.js'),'index-C8nt2Oos.js');
  assert.equal(newReleaseLive('index-C8nt2Oos.js',page('index-NewBuild1.js')),true);
  // Same build: the failure was something else (for example a network hiccup); nothing reloads.
  assert.equal(newReleaseLive('index-C8nt2Oos.js',page('index-C8nt2Oos.js')),false);
  // Anything unexpected never reloads.
  assert.equal(newReleaseLive(undefined,page('index-NewBuild1.js')),false);
  assert.equal(newReleaseLive('index-C8nt2Oos.js','<html>maintenance</html>'),false);
});

test('a screen that fails to load after a release reloads the page once',()=>{
  const now=10_000_000;
  assert.equal(releaseReloadGapMs,5*60_000);
  assert.equal(releaseReloadDecision({now,lastReloadAt:undefined,unsaved:false}),'reload');
  // A reload long ago does not block the next one (a later release).
  assert.equal(releaseReloadDecision({now,lastReloadAt:now-releaseReloadGapMs,unsaved:false}),'reload');
});

test('the page never reloads by itself twice within five minutes',()=>{
  const now=10_000_000;
  assert.equal(releaseReloadDecision({now,lastReloadAt:now-1_000,unsaved:false}),'skip');
  assert.equal(releaseReloadDecision({now,lastReloadAt:now-releaseReloadGapMs+1,unsaved:false}),'skip');
});

test('unsaved typing is never thrown away: the user is asked to save and reload',()=>{
  const now=10_000_000;
  assert.equal(releaseReloadDecision({now,lastReloadAt:undefined,unsaved:true}),'ask');
  assert.equal(releaseReloadDecision({now,lastReloadAt:now-1_000,unsaved:true}),'ask');
  assert.match(releaseReloadMessage,/new version/i);
  assert.match(releaseReloadMessage,/save/i);
});
