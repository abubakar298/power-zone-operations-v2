import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';

const escapeXml=value=>String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const attribute=(tag,name)=>tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
const column=index=>String.fromCharCode(65+index);

/** Fill approved OOXML without the desktop-only artifact runtime. Every ZIP
 * part except the input worksheet is retained byte for byte, including styles,
 * branding and printer settings. No financial formulas are calculated here. */
export function exportSurveyWorkbook(template,rows){
  if(!Array.isArray(rows)||rows.length>10000||rows.some(r=>!Array.isArray(r)||r.length!==22))throw new Error('UBL export requires 22 columns per site.');
  const archive=unzipSync(template);
  const read=name=>{if(!archive[name])throw new Error(`UBL template part missing: ${name}`);return strFromU8(archive[name]);};
  const sheet=read('xl/workbook.xml').match(/<(?:\w+:)?sheet\b[^>]*name="11 Sites \(Punjab\) \(2\)"[^>]*>/)?.[0];
  const id=sheet?.match(/\br:id="([^"]+)"/)?.[1];
  const rel=read('xl/_rels/workbook.xml.rels').match(/<(?:\w+:)?Relationship\b[^>]*>/g)?.find(t=>attribute(t,'Id')===id);
  const target=rel&&attribute(rel,'Target');
  if(!target)throw new Error('Approved UBL worksheet unavailable.');
  const sheetPath=target.startsWith('/')?target.slice(1):path.posix.normalize('xl/'+target);
  let xml=read(sheetPath);
  const prefix=xml.match(/<((?:\w+:)?)worksheet\b/)?.[1]??'';
  const rowPattern=/<(?:\w+:)?row\b[^>]*>[\s\S]*?<\/(?:\w+:)?row>/g;
  const originalRows=[...xml.matchAll(rowPattern)].map(m=>m[0]);
  const number=row=>Number(attribute(row.slice(0,row.indexOf('>')+1),'r'));
  const first=originalRows.find(r=>number(r)===8);
  if(!first)throw new Error('Approved UBL data row unavailable.');
  const cellPattern=/<(?:\w+:)?c\b[^>]*(?:\/>|>[\s\S]*?<\/(?:\w+:)?c>)/g;
  const cells=row=>[...row.matchAll(cellPattern)].map(m=>m[0]);
  const makeCell=(original,reference,value)=>{
    const style=attribute(original?.slice(0,original.indexOf('>')+1)??'','s');
    const attrs=` r="${reference}"${style===undefined?'':` s="${style}"`}`;
    if(value===null||value===undefined||value==='')return `<${prefix}c${attrs}/>`;
    if(typeof value==='number'){
      if(!Number.isFinite(value))throw new Error('Invalid numeric survey value.');
      return `<${prefix}c${attrs}><${prefix}v>${value}</${prefix}v></${prefix}c>`;
    }
    // Identifiers keep leading zeros, and text never becomes an Excel formula.
    return `<${prefix}c${attrs} t="inlineStr"><${prefix}is><${prefix}t xml:space="preserve">${escapeXml(value)}</${prefix}t></${prefix}is></${prefix}c>`;
  };
  const outputRows=[];
  for(const original of originalRows){
    const n=number(original);
    if(n>=8&&n<=Math.max(23,7+rows.length))continue;
    if(n===5){
      outputRows.push(original.replace(cellPattern,cell=>{
        const ref=attribute(cell.slice(0,cell.indexOf('>')+1),'r');
        if(!ref||!/^([A-U])5$/.test(ref))return cell;
        return makeCell(cell,ref,ref==='A5'?'Surveyed By: Power Zone Engineering & Services':'');
      }));
    }else outputRows.push(original);
  }
  for(let index=0;index<Math.max(16,rows.length);index++){
    const n=index+8;
    const original=originalRows.find(r=>number(r)===n)??first;
    const oldCells=cells(original);
    const tag=original.slice(0,original.indexOf('>')+1).replace(/\br="\d+"/,`r="${n}"`).replace(/\s+hidden="[^"]*"/g,'');
    outputRows.push(tag+Array.from({length:22},(_,c)=>makeCell(oldCells.find(cell=>attribute(cell.slice(0,cell.indexOf('>')+1),'r')?.replace(/\d+$/,'')===column(c)),`${column(c)}${n}`,rows[index]?.[c]??'')).join('')+`</${prefix}row>`);
  }
  outputRows.sort((a,b)=>number(a)-number(b));
  xml=xml.replace(/<(?:\w+:)?sheetData\b[^>]*>[\s\S]*?<\/(?:\w+:)?sheetData>/,`<${prefix}sheetData>${outputRows.join('')}</${prefix}sheetData>`);
  xml=xml.replace(/<(?:\w+:)?dimension\b[^>]*\/>/,`<${prefix}dimension ref="A1:V${Math.max(23,7+rows.length)}"/>`);
  archive[sheetPath]=strToU8(xml);
  return zipSync(archive,{level:6});
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const input=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  await fs.writeFile(input.output,exportSurveyWorkbook(await fs.readFile(input.template),input.rows??[]));
  console.log('Workbook exported');
}
