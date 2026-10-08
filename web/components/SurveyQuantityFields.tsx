import { useEffect, useState } from "react";
import { Decimal } from "decimal.js";
import { BessSelector } from "./BessSelector.js";

/** Display quantities without changing the established persisted cable basis. */
export function SurveyQuantityFields({initial, patch, inverter, quick, onInverter}: {initial:any; patch:Record<string,string>; inverter:string; quick:boolean; onInverter:(value:string)=>void}) {
  const [values,setValues]=useState<Record<string,string>>({
    ...initial,
    spLoadPanelTotalMetres: initial.spLoadPanelRunMetres == null ? "" : new Decimal(initial.spLoadPanelRunMetres).mul(2).toString(),
  });
  useEffect(()=>setValues(previous=>({...previous,...patch})),[patch]);
  const sp=inverter==="6 kW SP", dual=inverter.startsWith("2×");
  const number=(key:string)=>{try{return new Decimal(values[key]||0);}catch{return new Decimal(0);}};
  const metres=(value:Decimal)=>value.toDecimalPlaces(4).toString();
  const input=(key:string,label:string,hint?:string, required=true)=> <label key={key}>{label}<input name={key} aria-label={label} type="number" min={key==="panelQty"?1:key==="panelWattage"?0.0001:0} max={key==="panelQty"?1000000:99999999} step={key==="panelQty"?1:0.0001} required={required} value={values[key]??(["panelQty","panelWattage","spLoadPanelTotalMetres"].includes(key)?"":"0")} onChange={e=>setValues({...values,[key]:e.target.value})}/>{hint&&<small>{hint}</small>}</label>;
  const split=(key:string,core:string)=>`${metres(number(key).div(2))} m input + ${metres(number(key).div(2))} m output (${core}). Enter combined cable quantity.`;
  return <div className="survey-grid survey-quantities">
    {input("panelQty","Panel quantity")}
    {input("panelWattage","Panel wattage (W)")}
    <p className="pv-total" aria-live="polite">Total installed wattage: <strong>{number("panelQty").mul(number("panelWattage")).toNumber().toLocaleString("en-PK",{maximumFractionDigits:4})} W</strong> ({number("panelQty").mul(number("panelWattage")).div(1000).toString()} kW)</p>
    <BessSelector initial={initial} onChange={onInverter}/>
    {!quick && input("dcMetres","6mm² DC cable total (m)",`${metres(number("dcMetres").div(2))} m red + ${metres(number("dcMetres").div(2))} m black.`)}
    {!quick && <>
      <label>AC cable · inverter termination (automatic)<input aria-label="AC cable · inverter termination (automatic)" readOnly value={sp?"20 m · 10mm² 1-core":dual?"15 m · 16mm² 4-core + 20 m · 25mm² 4-core":"30 m · 16mm² 4-core"}/><small>{sp?"Fixed total conductor allowance: 20 m. Existing approved costing basis.":dual?"Combined allowance for both inverters: 7.5 m of 16mm² + 10 m of 25mm² per inverter.":"Fixed total cable allowance: 30 m for one inverter."}</small></label>
      {sp ? input("spLoadPanelTotalMetres","10mm² 1-core AC cable · load-panel termination (m)",`${metres(number("spLoadPanelTotalMetres").div(4))} m line + ${metres(number("spLoadPanelTotalMetres").div(4))} m neutral for input; the same for output. Total conductor quantity.`) : <div className="ac-panel-fields">
        <small>AC load-panel termination · {dual ? "25" : "16"}mm² 4-core for the selected BESS configuration.</small>
        {input(dual?"acPanel25":"acPanel16",`Panel termination · ${dual?"25":"16"} mm² 4-core (m)`,split(dual?"acPanel25":"acPanel16","4-core cable"))}
        {number(dual?"acPanel16":"acPanel25").gt(0) ? input(dual?"acPanel16":"acPanel25",`Panel termination · ${dual?"16":"25"} mm² 4-core (m)`,"Existing additional cable quantity retained from this survey. Review if the solution changes.") : <input type="hidden" name={dual?"acPanel16":"acPanel25"} value="0"/>}
      </div>}
      {input("earth25","2.5mm² earth cable (m)")}
      {input("earth6","6mm² earth cable (m)")}
      {input("earth10","10mm² earth cable (m)")}
    </>}
    <label>Structure<select aria-label="Structure" name="structure" defaultValue={initial.structure??"L1"}>{["L1","L2","L3","Elevated"].map(v=><option key={v}>{v}</option>)}</select></label>
    <label>Extra smart meter<select aria-label="Extra smart meter" name="smartMeter" defaultValue={initial.smartMeter?"yes":"no"}><option value="no">No</option><option value="yes">Yes</option></select></label>
    <label>Genset synchronisation<select aria-label="Genset synchronisation" name="genset" defaultValue={initial.genset?"yes":"no"}><option value="no">No</option><option value="yes">Yes</option></select></label>
  </div>;
}
