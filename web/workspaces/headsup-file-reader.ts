import {strFromU8,unzipSync} from 'fflate';
import {extractText} from '../ocr.js';
import {parseHeadsupRows,type HeadsupRow,headsupRowsFromTable} from './headsup-reader.js';
export const headsupFileTypes='.xlsx,image/jpeg,image/png,application/pdf';
export async function readHeadsupFile(file:File,progress:(message:string)=>void):Promise<{text:string;rows:HeadsupRow[]}>{
 if(/\.xlsx$/i.test(file.name)||file.type==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'){
  progress('Reading Excel worksheets…');const rows=readHeadsupXlsx(new Uint8Array(await file.arrayBuffer()));return{rows,text:rows.map(r=>[r.branchCode,r.branchName,r.solarKw].join('\t')).join('\n')};
 }
 const result=await extractText(file,progress,true);return{text:result.text,rows:parseHeadsupRows(result.text)};
}
export function readHeadsupXlsx(bytes:Uint8Array):HeadsupRow[]{
 let expanded=0;const files=unzipSync(bytes,{filter:f=>{const needed=/^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(f.name);if(needed){expanded+=f.originalSize;if(expanded>32000000)throw Error('Excel data is too large. Use a smaller workbook.');}return needed;}});
 const xml=(data:Uint8Array)=>{const text=strFromU8(data);if(/<!DOCTYPE/i.test(text))throw Error('Unsupported Excel XML.');const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw Error('Excel worksheet could not be read.');return doc;};
 const shared=files['xl/sharedStrings.xml']?[...xml(files['xl/sharedStrings.xml']).getElementsByTagName('si')].map(s=>[...s.getElementsByTagName('t')].map(t=>t.textContent??'').join('')):[];
 const rows:HeadsupRow[]=[];
 for(const [name,data] of Object.entries(files)){if(!name.startsWith('xl/worksheets/'))continue;const matrix=[...xml(data).getElementsByTagName('row')].map(row=>{const values:string[]=[];for(const cell of [...row.getElementsByTagName('c')]){const ref=cell.getAttribute('r')??'';let index=0;for(const letter of ref.replace(/\d/g,''))index=index*26+letter.charCodeAt(0)-64;if(!index)continue;const raw=cell.getElementsByTagName('v')[0]?.textContent??'';const type=cell.getAttribute('t');values[index-1]=type==='s'?shared[Number(raw)]??'':type==='inlineStr'?[...cell.getElementsByTagName('t')].map(t=>t.textContent??'').join(''):raw;}return values;});rows.push(...headsupRowsFromTable(matrix));}
 if(!rows.length)throw Error('No heads-up table found. Include Branch Code, Branch Name and System Size headers.');if(rows.length>300)throw Error('Use up to 300 received sites per heads-up.');return rows;
}
