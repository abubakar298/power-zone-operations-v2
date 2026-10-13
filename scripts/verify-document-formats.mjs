import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const archive=JSON.parse(await readFile('data/finalized-document-formats.json','utf8'));
for(const [path,expected] of Object.entries(archive.files)){
 const actual=createHash('sha256').update(await readFile(path)).digest('hex');
 if(actual!==expected)throw Error(`Finalized document format changed: ${path}. Explicit owner approval and a new immutable format version are required.`);
}
console.log(`Finalized document formats match archive v${archive.version}.`);
