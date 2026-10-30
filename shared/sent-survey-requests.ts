const designStages=['survey_requested','survey_scheduled','report_received','technical_review','technical_revision'];
export function sentSurveyAwaitingDesign(r:any):boolean{
 return String(r.route??'').startsWith('survey')&&designStages.includes(r.stage)&&!r.data?.designHandoffAt&&(!!r.data?.sentToDesignAt||r.stage!=='survey_requested');
}
export const surveyRequestInCoordination=(r:any)=>r.stage==='request_review'||sentSurveyAwaitingDesign(r)||r.stage==='survey_requested'&&!r.data?.sentToDesignAt;
