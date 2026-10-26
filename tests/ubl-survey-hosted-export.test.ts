import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {unzipSync,strFromU8} from 'fflate';

test('hosted combined survey export keeps approved styling, leading zeros and every visible site without desktop dependencies',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'pz-hosted-export-'));
  try{
    const template=await readFile('assets/ubl-survey-template.xlsx');
    const original=unzipSync(template);
    for(const count of [1,20,25]){
      const rows=Array.from({length:count},(_,i)=>Array.from({length:22},(_,c)=>c===0?i+1:c===1?String(208+i).padStart(4,'0'):c===2?`UBL Branch & Site ${i+1}`:c===21?'=literal evidence text':''));
      const input=join(directory,'input.json'),output=join(directory,`sites-${count}.xlsx`);
      await writeFile(input,JSON.stringify({template:resolve('assets/ubl-survey-template.xlsx'),rows,output}));
      await promisify(execFile)(process.execPath,['scripts/ubl-survey-xlsx.mjs',input],{env:{...process.env,PZ_ARTIFACT_RUNTIME:'/nonexistent-render-runtime'}});
      const exported=unzipSync(await readFile(output));
      assert.deepEqual(Object.keys(exported).sort(),Object.keys(original).sort());
      for(const [name,bytes] of Object.entries(original))if(name!=='xl/worksheets/sheet1.xml')assert.deepEqual(exported[name],bytes,`Preserve ${name}`);
      const xml=strFromU8(exported['xl/worksheets/sheet1.xml']);
      for(let i=0;i<count;i++){
        const row=xml.match(new RegExp(`<x:row\\b[^>]*r="${i+8}"[^>]*>[\\s\\S]*?</x:row>`))?.[0];
        assert.ok(row,`Site ${i+1} exists`);
        assert.doesNotMatch(row,/\bhidden=/);
        assert.match(row,new RegExp(`<x:c r="A${i+8}"[^>]*><x:v>${i+1}</x:v>`));
        assert.ok(row.includes(String(i+208).padStart(4,'0')),'Leading-zero code retained');
        assert.ok(row.includes(`UBL Branch &amp; Site ${i+1}`));
        assert.match(row,/t="inlineStr"/);
        assert.doesNotMatch(row,/<x:f\b/,'User text cannot become a formula');
      }
      for(const tag of ['cols','mergeCells','sheetViews','pageMargins','pageSetup']){
        const pattern=new RegExp(`<x:${tag}\\b[^>]*(?:/>|>[\\s\\S]*?</x:${tag}>)`);
        assert.equal(xml.match(pattern)?.[0],strFromU8(original['xl/worksheets/sheet1.xml']).match(pattern)?.[0],`Approved ${tag}`);
      }
      assert.match(xml,/Surveyed By: Power Zone Engineering &amp; Services/);
      assert.equal((xml.match(/<x:row\b/g)??[]).length,new Set([...xml.matchAll(/<x:row\b[^>]*r="(\d+)"/g)].map(m=>m[1])).size,'No duplicate row addresses');
    }
    assert.deepEqual(await readFile('assets/ubl-survey-template.xlsx'),template,'Source template never changes');
  }finally{await rm(directory,{recursive:true,force:true});}
});
