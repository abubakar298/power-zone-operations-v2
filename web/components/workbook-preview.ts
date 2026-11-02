import {strFromU8,unzipSync} from 'fflate';
/** Render cached worksheet values as text only. Never evaluate formulas or external links. */
export function workbookPreview(bytes:Uint8Array){
 let expanded=0;const files=unzipSync(bytes,{filter:file=>{const needed=/^xl\/(sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml.rels|worksheets\/sheet\d+\.xml)$/.test(file.name);if(needed){expanded+=file.originalSize;if(expanded>32_000_000)throw Error('This workbook is too large to preview. Download the original instead.');}return needed;}});
 const xml=(bytes:Uint8Array)=>{const value=strFromU8(bytes);if(/<!DOCTYPE/i.test(value))throw Error('Unsupported workbook XML.');const doc=new DOMParser().parseFromString(value,'application/xml');if(doc.querySelector('parsererror'))throw Error('Unable to read this worksheet.');return doc;};
 const shared=files['xl/sharedStrings.xml']?[...xml(files['xl/sharedStrings.xml']).getElementsByTagName('si')].map(s=>[...s.getElementsByTagName('t')].map(t=>t.textContent??'').join('')):[];
 const names=new Map<string,string>();
 if(files['xl/workbook.xml']&&files['xl/_rels/workbook.xml.rels']){const rels=[...xml(files['xl/_rels/workbook.xml.rels']).getElementsByTagName('Relationship')];for(const sheet of [...xml(files['xl/workbook.xml']).getElementsByTagName('sheet')]){const target=rels.find(r=>r.getAttribute('Id')===sheet.getAttribute('r:id'))?.getAttribute('Target');if(target)names.set(target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,''),sheet.getAttribute('name')??'Worksheet');}}
 const host=document.createElement('div');host.className='pz-stack';let count=0;
 for(const [path,data] of Object.entries(files)){if(!path.startsWith('xl/worksheets/'))continue;if(++count>20)throw Error('Preview supports up to 20 worksheets. Download the original for the full workbook.');
 const section=document.createElement('section'),heading=document.createElement('h4');heading.textContent=names.get(path)??'Worksheet '+count;section.append(heading);
 const table=document.createElement('table');table.className='master-table';table.setAttribute('aria-label',heading.textContent);const body=document.createElement('tbody');const rows=[...xml(data).getElementsByTagName('row')];
 for(const row of rows.slice(0,1000)){const cells=[...row.getElementsByTagName('c')],values=new Map<number,string>();let max=0;for(const cell of cells){let column=0;for(const c of (cell.getAttribute('r')??'').replace(/\d/g,''))column=column*26+c.charCodeAt(0)-64;if(column<1||column>80)continue;const raw=cell.getElementsByTagName('v')[0]?.textContent??'',kind=cell.getAttribute('t');values.set(column,kind==='s'?shared[Number(raw)]??'':kind==='inlineStr'?[...cell.getElementsByTagName('t')].map(t=>t.textContent??'').join(''):raw||(cell.getElementsByTagName('f').length?'[Formula value not cached]':''));max=Math.max(max,column);}
 if(![...values.values()].some(Boolean))continue;const tr=document.createElement('tr');for(let column=1;column<=max;column++){const td=document.createElement('td');td.textContent=values.get(column)??'';td.style.verticalAlign='top';tr.append(td);}body.append(tr);}
 table.append(body);const scroll=document.createElement('div');scroll.className='pz-table-scroll';scroll.append(table);section.append(scroll);if(rows.length>1000){const note=document.createElement('p');note.textContent='Showing the first 1,000 worksheet rows. Download the original for the complete workbook.';section.append(note);}host.append(section);
 }
 if(!count)throw Error('No worksheet found in this workbook.');return host;
}
