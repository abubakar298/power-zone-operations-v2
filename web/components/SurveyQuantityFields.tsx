import {panelEarthMetres,roundedSurveyCableMetres} from "../../shared/survey-cables.js";
import {generalAllowances} from "../../server/boq/general.js";
import { useEffect, useState } from "react";
import { Decimal } from "decimal.js";
import { singlePhaseCableDescription } from "../../server/boq/ac-cable.js";
import { BessSelector } from "./BessSelector.js";

/** Display quantities without changing the established persisted cable basis. */
export function SurveyQuantityFields({initial, patch, inverter, quick, bessOnly=false, manual=false, onInverter}: {initial:any; patch:Record<string,string>; inverter:string; quick:boolean; bessOnly?:boolean; manual?:boolean; onInverter:(value:string)=>void}) {
  const withEarthDefault=(v:any)=>({...v,...(manual&&!bessOnly&&(v.earth25==null||v.earth25===''||String(v.earth25)==='0')?{earth25:panelEarthMetres(v.panelQty||0)}:{})});
  const [values,setValues]=useState<Record<string,string>>({
    ...withEarthDefault(initial),
    spLoadPanelTotalMetres: initial.spLoadPanelRunMetres == null ? "" : new Decimal(initial.spLoadPanelRunMetres).mul(2).toString(),
  });
  useEffect(()=>setValues({...withEarthDefault(initial), spLoadPanelTotalMetres: initial.spLoadPanelRunMetres == null ? "" : new Decimal(initial.spLoadPanelRunMetres).mul(2).toString()}),[initial]);
  useEffect(()=>setValues(previous=>({...previous,...patch})),[patch]);
  const sp=inverter==="6 kW SP", dual=inverter.startsWith("2×");
  useEffect(()=>{if(quick||manual)return;setValues(v=>({...v,acInverter16:initial.acTerminationMode === "Measured" ? initial.acInverter16??(dual?"15":"10") : dual?"15":"10",acInverter25:initial.acTerminationMode === "Measured" ? initial.acInverter25??"0" : "0",acPanel16:initial.acPanel16??(dual?"0":"20"),acPanel25:initial.acPanel25??(dual?"20":"0"),spLoadPanelTotalMetres:initial.spLoadPanelRunMetres == null ? "40" : new Decimal(initial.spLoadPanelRunMetres).mul(2).toString(),spInverterTerminationMetres:initial.spInverterTerminationMetres??"20"}));},[inverter,quick,manual]);
  const allowances=quick?generalAllowances(Number(values.panelQty)||0,String(values.panelWattage||'0'),dual?2:1):null;
  const shown:Record<string,string>=quick?{...values,dcMetres:bessOnly?'0':allowances!.dcMetres,acInverter16:dual?'15':'10',acInverter25:'0',acPanel16:dual?'0':'20',acPanel25:dual?'20':'0',spInverterTerminationMetres:'20',spLoadPanelTotalMetres:'40',earth25:bessOnly?'0':allowances!.earth25,earth6:bessOnly?String(values.earth6||'0'):allowances!.earth6,earth10:bessOnly?String(values.earth10||'0'):allowances!.earth10}:values;
  const number=(key:string)=>{try{return new Decimal(shown[key]||0);}catch{return new Decimal(0);}};
  const metres=(value:Decimal)=>value.toDecimalPlaces(4).toString();
  const input=(key:string,label:string,hint?:string, required=true)=> <label key={key}>{label}<input name={key} aria-label={label} type="number" min={key==="panelQty"?1:key==="panelWattage"?0.0001:0} max={key==="panelQty"?1000000:99999999} step={key==="panelQty"?1:0.0001} required={required} readOnly={quick && !["panelQty","panelWattage"].includes(key)} value={shown[key]??(manual||["panelQty","panelWattage","spLoadPanelTotalMetres"].includes(key)?"":"0")} onBlur={e=>{if(manual&&!["panelQty","panelWattage"].includes(key)&&e.target.value!=="")setValues(v=>({...v,[key]:roundedSurveyCableMetres(key,e.target.value)}));}} onChange={e=>setValues({...values,[key]:e.target.value,...(manual&&!bessOnly&&key==="panelQty"?{earth25:panelEarthMetres(e.target.value)}:{})})}/>{hint&&<small>{hint}</small>}</label>;
  const split=(key:string,core:string)=>`${metres(number(key).div(2))} m input + ${metres(number(key).div(2))} m output (${core}). Enter combined cable quantity.`;
  return <div className="survey-grid survey-quantities">
    {!bessOnly && input("panelQty","Panel quantity")}
    {!bessOnly && input("panelWattage","Panel wattage (W)")}
    {!bessOnly && <p className="pv-total" aria-live="polite">Total installed wattage: <strong>{number("panelQty").mul(number("panelWattage")).toNumber().toLocaleString("en-PK",{maximumFractionDigits:4})} W</strong> ({number("panelQty").mul(number("panelWattage")).div(1000).toString()} kW)</p>}
    <BessSelector initial={initial} onChange={onInverter}/>
    {!bessOnly && input("dcMetres","6mm² DC cable total (m)",`${metres(number("dcMetres").div(2))} m red + ${metres(number("dcMetres").div(2))} m black.`)}
    {<>
      {sp ? input("spInverterTerminationMetres","AC cable · inverter termination · 10mm² 1-core (m)",singlePhaseCableDescription(number("spInverterTerminationMetres").toString())) : <div>{input("acInverter16","AC cable · inverter termination · 16mm² 4-core (m)",quick?"Fixed quantity from approved rules.":manual?"Enter the measured site requirement.":"Automatically suggested; editable for the measured site requirement.")}<input type="hidden" name="acInverter25" value={initial.acInverter25??"0"}/></div>}
      {sp ? input("spLoadPanelTotalMetres","10mm² 1-core AC cable · load-panel termination (m)",singlePhaseCableDescription(number("spLoadPanelTotalMetres").toString()) + (quick?" Fixed quantity from approved rules.":" Adjust to the measured site quantity if a survey has been completed.")) : <div className="ac-panel-fields">
        <small>AC load-panel termination · {dual ? "25" : "16"}mm² 4-core for the selected BESS configuration.</small>
        {input(dual?"acPanel25":"acPanel16",`Panel termination · ${dual?"25":"16"} mm² 4-core (m)`,split(dual?"acPanel25":"acPanel16","4-core cable") + (quick?" Fixed quantity from approved rules.":" Adjust to the measured site quantity if a survey has been completed."))}
        {number(dual?"acPanel16":"acPanel25").gt(0) ? input(dual?"acPanel16":"acPanel25",`Panel termination · ${dual?"16":"25"} mm² 4-core (m)`,"Existing additional cable quantity retained from this survey. Review if the solution changes.") : <input type="hidden" name={dual?"acPanel16":"acPanel25"} value="0"/>}
      </div>}
      {!bessOnly && input("earth25","2.5mm² earth cable (m)",manual?"Autofilled at 1 ft per panel; adjust if the measured requirement differs.":undefined)}
      {(!bessOnly || sp) && input("earth6","6mm² earth cable (m)")}
      {(!bessOnly || !sp) && input("earth10","10mm² earth cable (m)")}
    </>}
    {<label>Include Earthing Bore?<input type="checkbox" aria-label="Include Earthing Bore?" style={{width:20,height:20,minHeight:20,alignSelf:"start",accentColor:"#6658e8"}} name="spIncludeEarthingBore" defaultChecked={manual?initial.spIncludeEarthingBore===true:initial.spIncludeEarthingBore !== false}/><small>Type and quantity follow the approved engineering rules. Uncheck if earthing bore is not required at this site.</small></label>}
    {!bessOnly && <label>Structure<select aria-label="Structure" name="structure" defaultValue={initial.structure??(manual?"":"L1")} required>{manual&&<option value="">Select structure</option>}{["L1","L2","L3","Elevated"].map(v=><option key={v}>{v}</option>)}</select></label>}
    <label>Extra smart meter<select aria-label="Extra smart meter" name="smartMeter" defaultValue={initial.smartMeter==null&&manual?"":initial.smartMeter?"yes":"no"} required>{manual&&<option value="">Select Yes / No</option>}<option value="no">No</option><option value="yes">Yes</option></select></label>
    <label>Genset synchronisation<select aria-label="Genset synchronisation" name="genset" defaultValue={initial.genset==null&&manual?"":initial.genset?"yes":"no"} required>{manual&&<option value="">Select Yes / No</option>}<option value="no">No</option><option value="yes">Yes</option></select></label>
  </div>;
}
