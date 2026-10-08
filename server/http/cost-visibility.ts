import { Decimal } from "decimal.js";
import type { RequestHandler } from "express";

export const canSeeBessCost = (role?:string) => role === "Admin" || role === "Management";
export const isBessEquipment = (value:any) => value?.phase === "BESS" || /^(HYB-|BAT-|CH-BMS-|BMS-)/i.test(String(value?.key??value?.item_key??""));

/** Projection only: authoritative stored costing and financial engines stay intact. */
export function restrictedCostView(value:any, commercial=false):any {
  if(Array.isArray(value))return value.map(v=>restrictedCostView(v,commercial));
  if(!value||typeof value!=="object")return value;
  const result:any={};
  const boq=Array.isArray(value.lines)&&value.engineering&&value.survey;
  for(const [key,v] of Object.entries(value)){
    if(key==="budgeted_cost"){result[key]=null;continue;}
    if(commercial&&["profit","margin","marginOnSales"].includes(key))continue;
    if(commercial&&key==="cost"&&Array.isArray(value.rows))continue;
    if(key==="markups"&&v&&typeof v==="object"){const {bess,...safe}=v as any;result[key]=safe;continue;}
    if(key==="rates"&&Array.isArray(v)){result[key]=v.filter(x=>!isBessEquipment(x)).map(x=>restrictedCostView(x,commercial));continue;}
    
    result[key]=restrictedCostView(v,commercial);
    if(commercial&&key==="additionalItem"&&(value.additionalCategory==="bess"||value.category==="bess")&&result[key])delete result[key].cost;
  }
  if(commercial&&(value.key==="bess"||value.category==="bess"||isBessEquipment(value))){delete result.cost;delete result.markup;delete result.rate;delete result.unitCost;}
  if(commercial&&Array.isArray(result.rows)&&value.input?.additionalCategory==="bess")result.rows=result.rows.map((r:any)=>r.key==="additional"?{...r,cost:undefined,markup:undefined}:r);
  if(boq){
    result.costVisibility="Excluding BESS";
    result.lines=value.lines.map((l:any)=>isBessEquipment(l)?{...restrictedCostView(l),rate:null,total:null,costRestricted:true}:restrictedCostView(l));
    result.summary=value.summary.filter((r:any)=>r.name!=="BESS");
    result.total=value.lines.filter((l:any)=>!isBessEquipment(l)).reduce((n:Decimal,l:any)=>n.plus(l.total),new Decimal(0)).toString();
    result.perWatt=new Decimal(result.total).div(value.engineering.pvWatts).toFixed(2);
  }
  return result;
}

/** Central outbound boundary; evaluated at send time, after route authentication. */
export const financialVisibility:RequestHandler=(req,res,next)=>{
  const json=res.json.bind(res);
  res.json=((body:any)=>{
    if(canSeeBessCost(req.authSession?.user.role))return json(body);
    const path=req.originalUrl;
    if(req.authSession){
      body=restrictedCostView(body,path.startsWith("/api/commercial"));
      if(path.startsWith("/api/boqs"))for(const key of ["boqs","revisions","reviews"])if(Array.isArray(body?.[key]))body[key]=body[key].map((r:any)=>{if(r.snapshot)return r;const {total,perWatt,...safe}=r;return safe;});
    }
    return json(body);
  }) as typeof res.json;
  next();
};
