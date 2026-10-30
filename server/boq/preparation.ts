import type{Pool,PoolClient}from'pg';import{HttpError}from'../http/errors.js';
/** Shared family lock serializes preparation editing with quotation creation. */
export async function lockBoqPreparation(c:PoolClient,revisionId:string){
 const r=(await c.query('SELECT id,boq_id FROM boq_revisions WHERE id=$1',[revisionId])).rows[0];
 if(!r)throw new HttpError(404,'BOQ preparation not found.');
 await c.query('SELECT id FROM boqs WHERE id=$1 FOR UPDATE',[r.boq_id]);return r;
}
export async function preparationState(c:Pool|PoolClient,revisionId:string){
 const r=(await c.query(`SELECT r.boq_id,EXISTS(SELECT 1 FROM boq_preliminary_references p WHERE p.revision_id=r.id) AND NOT EXISTS(SELECT 1 FROM boq_customer_final_references f WHERE f.revision_id=r.id) AS preliminary,
 (SELECT id FROM boq_revisions latest WHERE latest.boq_id=r.boq_id ORDER BY revision DESC LIMIT 1) AS latest,
 EXISTS(SELECT 1 FROM quotation_versions q JOIN boq_revisions qr ON qr.id=q.boq_revision_id WHERE qr.boq_id=r.boq_id) AS quoted FROM boq_revisions r WHERE r.id=$1`,[revisionId])).rows[0];
 if(!r)throw new HttpError(404,'BOQ preparation not found.');
 return {...r,canEdit:r.preliminary&&!r.quoted&&r.latest===revisionId};
}
export async function assertPreparationEditable(c:PoolClient,draftId:string){
 const edit=(await c.query('SELECT source_revision_id FROM boq_preparation_edits WHERE draft_id=$1',[draftId])).rows[0];if(!edit)return;
 await lockBoqPreparation(c,edit.source_revision_id);const state=await preparationState(c,edit.source_revision_id);
 if(!state.canEdit)throw new HttpError(409,state.quoted?'A quotation has been created. Use the quotation revision flow to change this BOQ.':'This BOQ preparation changed. Open the latest preparation.');
}
