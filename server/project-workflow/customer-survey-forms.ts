import {surveySharedValues} from './survey-shared-values.js';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {HttpError} from '../http/errors.js';
export async function customerSurveyTemplates(c:Pool|PoolClient){return(await c.query('SELECT DISTINCT ON(key) key,version,customer_code AS "customerCode",payload FROM customer_survey_form_templates ORDER BY key,version DESC')).rows;}
export async function saveCustomerSurveyForm(c:PoolClient,r:any,actor:string,raw:unknown,draft=false){
 const input=z.object({templateKey:z.string().min(1).max(100),templateVersion:z.number().int().positive(),values:z.record(z.string(),z.unknown())}).strict().parse(raw);
 const template=(await c.query('SELECT * FROM customer_survey_form_templates WHERE key=$1 ORDER BY version DESC LIMIT 1',[input.templateKey])).rows[0];
 if(!template||template.version!==input.templateVersion)throw new HttpError(409,'Reload the latest customer survey form before saving.');
 const customer=(await c.query('SELECT * FROM customers WHERE id=$1 FOR SHARE',[r.customer_id])).rows[0];
 const site=(await c.query('SELECT * FROM sites WHERE id=$1 FOR SHARE',[r.site_id])).rows[0];
 if(customer.short_code.toUpperCase()!==template.customer_code.toUpperCase())throw new HttpError(422,'This survey form belongs to another customer.');
 const data=r.data??{};
 if(r.route!=='survey-framework')throw new HttpError(422,'The customer-specific survey form applies to the pre-agreed survey route.');
 if(!draft&&(!data.surveyInputsSavedAt||!data.surveyInputs))throw new HttpError(422,'Save the standard BOQ inputs before entering the UBL survey details.');
 const standard=data.surveyInputs??{};
 const team:string[]=data.surveyTeam??[];
 const people=(await c.query('SELECT id,display_name FROM users WHERE id=ANY($1::uuid[]) UNION ALL SELECT id,display_name FROM survey_team_members WHERE id=ANY($1::uuid[])',[team])).rows;
 const shared:any=surveySharedValues(standard,customer,site,team.map(id=>people.find(p=>p.id===id)?.display_name??'Unconfirmed surveyor').join(', '));
 const fields=template.payload.fields;
 for(const key of Object.keys(input.values))if(!fields.some((f:any)=>f.key===key))throw new HttpError(422,'Unexpected survey field. Reload the form.');
 const values:any={};
 const text=(value:unknown)=>z.string().trim().max(4000).parse(value??'');
 const numeric=(value:unknown,integer=false)=>{const result=text(value);if(result&&!new RegExp(integer?'^\\d{1,8}$':'^\\d{1,8}(\\.\\d{1,4})?$').test(result))throw new HttpError(422,'Enter a non-negative number with up to four decimal places.');return result;};
 for(const field of fields){
  if(field.shared){values[field.key]=shared[field.shared]==null?'':String(shared[field.shared]);continue;}
  if(field.type==='load-table'){
   const rows=z.array(z.object({quantity:z.string(),estimatedKw:z.string(),totalKw:z.string()}).strict()).max(field.items.length).parse(input.values[field.key]??[]);
   values[field.key]=field.items.map((equipment:string,index:number)=>({equipment,quantity:numeric(rows[index]?.quantity??'',true),estimatedKw:numeric(rows[index]?.estimatedKw??''),totalKw:numeric(rows[index]?.totalKw??'')}));continue;
  }
  const value=text(input.values[field.key]);
  if(!draft&&!value)throw new HttpError(422,`Enter ${field.label} before saving the UBL survey details. Use None where applicable.`);
  if(['number','integer'].includes(field.type)){values[field.key]=numeric(value,field.type==='integer');continue;}
  if(field.type==='date'&&value)z.iso.date().parse(value);
  if(field.type==='select'&&value&&!field.options.includes(value))throw new HttpError(422,`Choose a listed value for ${field.label}.`);
  values[field.key]=value;
 }
 return{templateKey:template.key,templateVersion:template.version,values,savedAt:new Date().toISOString(),savedBy:actor,standardInputsSavedAt:data.surveyInputsSavedAt??null,sourceReference:template.source_reference,connectedLoadMode:template.payload.connectedLoadMode};
}
