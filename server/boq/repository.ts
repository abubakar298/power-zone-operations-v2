import {sentSurveyAwaitingDesign} from '../../shared/sent-survey-requests.js';
import {frameworkCosting} from './framework-costing.js';
import { allocateReference } from "../documents/references.js";
import { ownedCondition } from "../http/permissions.js";
import { ReviewRepository } from "./reviews.js";
import type { Pool, PoolClient } from "pg";
import { randomUUID, createHash } from "node:crypto";
import { transaction } from "../db/transaction.js";
import { MastersRepository } from "../masters/repository.js";
import { calculate, type BoqSnapshot } from "./engine.js";
import { surveySchema, type Survey, type SurveyDraft } from "./schema.js";
import { HttpError } from "../http/errors.js";
import {solutionDifferences,solutionValues} from './solution-identity.js';
export function fingerprint(value: unknown) {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(JSON.parse(JSON.stringify(value)))))
    .digest("hex");
}
export class BoqRepository {
  constructor(private pool: Pool) {}
  reviews() {
    return new ReviewRepository(this.pool, this);
  }
  async history(id: string) {
    const base = await this.get(id);
    return (
      await this.pool.query(
        "SELECT id,number,revision,revision_reason,created_at,snapshot->>\'total\' AS total FROM boq_revisions WHERE boq_id=$1 ORDER BY revision DESC",
        [base.boq_id],
      )
    ).rows;
  }
  async drafts(owner: string) {
    return (
      await this.pool.query(
        `SELECT d.*,(SELECT jsonb_build_object('designer',u.display_name,'sent_at',h.created_at,'notes',h.inputs->>'notes','attachments',(SELECT jsonb_agg(jsonb_build_object('id',a.id,'filename',a.filename)) FROM survey_uploads a WHERE h.inputs->'uploadIds' ? a.id::text)) FROM design_survey_handoffs h JOIN users u ON u.id=h.created_by WHERE h.draft_id=d.id) AS design_source,s.id AS review_id,s.draft_version AS submitted_version,COALESCE(v.outcome,'Awaiting review') AS review_status,v.comments FROM survey_drafts d LEFT JOIN LATERAL(SELECT * FROM boq_review_submissions WHERE draft_id=d.id ORDER BY draft_version DESC LIMIT 1) s ON true LEFT JOIN boq_review_decisions v ON v.submission_id=s.id WHERE d.owner_id=$1 AND NOT EXISTS(SELECT 1 FROM test_workflow_archives archived WHERE archived.key LIKE 'LOCAL-REVIEW-SAMPLES-%' AND archived.records->'localPreviewDocumentIds' ? d.id::text) AND d.id NOT IN(SELECT draft_id FROM boq_draft_finalizations) ORDER BY d.updated_at DESC LIMIT 100`,
        [owner],
      )
    ).rows;
  }
  async draftForReport(owner: string, id: string) {
    const row = (
      await this.pool.query(
        "SELECT inputs FROM survey_drafts WHERE id=$1 AND owner_id=$2 AND id NOT IN (SELECT draft_id FROM boq_draft_finalizations)",
        [id, owner],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "Survey draft not found.");
    return row.inputs;
  }
  async draft(
    owner: string,
    id: string | undefined,
    version: number,
    inputs: SurveyDraft,
    baseRevisionId?: string,
    reason = "",
    revisionOrigin?: string,
    workflowId?:string,
    surveyDeviationConfirmed=false,
  ) {
    return transaction(this.pool, async (c) => {
      await this.actor(c, owner);
      const existingDraft = id
        ? (
            await c.query(
              "SELECT * FROM survey_drafts WHERE id=$1 AND owner_id=$2 FOR UPDATE",
              [id, owner],
            )
          ).rows[0]
        : undefined;
      if (id && !existingDraft) throw new HttpError(404, "Draft not found.");
      const inferredWorkflow=id?(await c.query("SELECT id FROM project_workflow_records WHERE data->>'coordinationQuotationDraftId'=$1",[id])).rows[0]?.id:null;
      if(workflowId&&inferredWorkflow&&workflowId!==inferredWorkflow)throw new HttpError(409,'This draft is linked to a different reviewed survey.');
      const reviewWorkflow=workflowId??inferredWorkflow;
      let solutionReview:any;
      if(reviewWorkflow){
        const actor=(await c.query('SELECT role,display_name FROM users WHERE id=$1 AND active',[owner])).rows[0];
        const workflow=(await c.query('SELECT * FROM project_workflow_records WHERE id=$1 FOR SHARE',[reviewWorkflow])).rows[0];
        const ownSentDraft=!!workflow&&workflow.data.sentQuotationDraftId===id&&workflow.data.coordinationPreparedBeforeDesign===true&&(sentSurveyAwaitingDesign(workflow)||!!workflow.data.designHandoffAt);
        if(!workflow||(!ownSentDraft&&(workflow.stage!=='design_handed_off'||workflow.route!=='survey-quote'))||workflow.data.noFeasibleSolution||(workflow.coordinator_id!==owner&&!['Admin','Management'].includes(actor?.role)))throw new HttpError(403,'Choose your reviewed survey or own sent-request draft before preparing this quotation.');
        if(ownSentDraft){
          if(Number(inputs.customerId)!==workflow.customer_id||String(inputs.siteCode).toLowerCase()!==String(workflow.site_code).toLowerCase())throw new HttpError(422,'Use the customer and site linked to this survey request.');
        }else{
        const review=(await c.query("SELECT snapshot FROM project_workflow_documents WHERE record_id=$1 AND kind='Technical review' ORDER BY created_at DESC LIMIT 1",[reviewWorkflow])).rows[0];
        const baseline=review?.snapshot.boq?.survey??workflow.data.surveyInputs;
        if(!baseline||inputs.family!==baseline.family||Number(inputs.customerId)!==workflow.customer_id||String(inputs.siteCode).toLowerCase()!==String(workflow.site_code).toLowerCase())throw new HttpError(422,'Use the linked customer, site and technically reviewed project type.');
        const before=existingDraft?.inputs??baseline,differences=solutionDifferences(before,inputs);
        if(differences.length&&surveyDeviationConfirmed!==true)throw new HttpError(422,'PV, inverter or battery values differ from the reviewed survey or saved preliminary BOQ. Confirm the changes before saving.');
        solutionReview={workflowId:reviewWorkflow,baseline,before,differences,actorName:actor.display_name};
        }
      }
      const recordSolutionChange=async(draftId:string,draftVersion:number)=>{
        if(!solutionReview?.differences.length)return null;
        const reference=`PBQR-${draftId.slice(0,8).toUpperCase()}-R${draftVersion}`;
        await c.query('INSERT INTO preliminary_boq_solution_history(id,reference,workflow_id,draft_id,draft_version,created_by,actor_name,baseline,before_inputs,after_inputs,differences) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[randomUUID(),reference,solutionReview.workflowId,draftId,draftVersion,owner,solutionReview.actorName,solutionValues(solutionReview.baseline),solutionValues(solutionReview.before),solutionValues(inputs),JSON.stringify(solutionReview.differences)]);
        return{reference,actorName:solutionReview.actorName};
      };
      const base = existingDraft?.base_revision_id ?? baseRevisionId;
      if (
        baseRevisionId &&
        existingDraft &&
        baseRevisionId !== existingDraft.base_revision_id
      )
        throw new HttpError(409, "Revision identity cannot change.");
      if (
        id &&
        (
          await c.query(
            "SELECT 1 FROM boq_review_submissions s LEFT JOIN boq_review_decisions v ON v.submission_id=s.id WHERE s.draft_id=$1 AND v.submission_id IS NULL",
            [id],
          )
        ).rowCount
      )
        throw new HttpError(
          409,
          "This draft is awaiting review. A reviewer must request changes before it can be edited.",
        );
      if (base) {
        const original = (
          await c.query("SELECT * FROM boq_revisions WHERE id=$1", [base])
        ).rows[0];
        if (!original)
          throw new HttpError(404, "Original BOQ revision not found.");
        if (
          inputs.customerId !== original.snapshot.survey.customerId ||
          inputs.siteCode !== original.snapshot.survey.siteCode
        )
          throw new HttpError(
            400,
            "A revision must retain the original customer and site code.",
          );
      }
      await this.uploads(c, owner, inputs.uploadIds, base);
      if (id) {
        const row = (
          await c.query(
            "UPDATE survey_drafts SET inputs=$1,version=version+1,updated_at=now(),revision_reason=$5,revision_origin=COALESCE(revision_origin,$6) WHERE id=$2 AND owner_id=$3 AND version=$4 AND id NOT IN (SELECT draft_id FROM boq_draft_finalizations) RETURNING id,version",
            [
              inputs,
              id,
              owner,
              version,
              reason,
              base ? (revisionOrigin ?? null) : null,
            ],
          )
        ).rows[0];
        if (!row)
          throw new HttpError(
            409,
            "This draft changed or was saved. Reload the latest draft.",
          );
        return {...row,solutionRevision:await recordSolutionChange(row.id,row.version)};
      }
      const next = randomUUID();
      await c.query(
        "INSERT INTO survey_drafts(id,owner_id,inputs,base_revision_id,revision_reason,revision_origin) VALUES($1,$2,$3,$4,$5,$6)",
        [
          next,
          owner,
          inputs,
          base ?? null,
          reason,
          base ? (revisionOrigin ?? null) : null,
        ],
      );
      return { id: next, version: 1,solutionRevision:await recordSolutionChange(next,1) };
    });
  }
  async preview(s: Survey,baseRevisionId?:string) {
    const base=baseRevisionId?(await this.get(baseRevisionId)).snapshot:undefined;
    const result = base?.frameworkRevisionBasis?frameworkCosting(base,s):calculate(s, await new MastersRepository(this.pool).list());
    return { snapshot: result, fingerprint: fingerprint(result) };
  }
  private async actor(c: PoolClient, id: string) {
    const u = (
      await c.query("SELECT active FROM users WHERE id=$1 FOR SHARE", [id])
    ).rows[0];
    if (!u?.active) throw new HttpError(401, "Your access has ended.");
  }
  async uploads(c: PoolClient, owner: string, ids: string[], base?: string) {
    if (!ids.length) return;
    if (new Set(ids).size !== ids.length)
      throw new HttpError(400, "Duplicate attachment.");
    const n = (
      await c.query(
        "SELECT count(*) FROM survey_uploads WHERE id=ANY($1::uuid[]) AND (owner_id=$2 OR EXISTS(SELECT 1 FROM design_survey_handoffs h WHERE h.assigned_to=$2 AND h.inputs->'uploadIds' ? survey_uploads.id::text) OR id IN(SELECT upload_id FROM boq_uploads WHERE revision_id=$3))",
        [ids, owner, base ?? null],
      )
    ).rows[0].count;
    if (Number(n) !== ids.length)
      throw new HttpError(403, "One or more attachments are unavailable.");
  }
  async save(owner: string, id: string, version: number, expected: string) {
    return transaction(this.pool, async c => {
      await c.query("SELECT pg_advisory_xact_lock(742019002)");
      const user=(await c.query("SELECT active,role FROM users WHERE id=$1 FOR SHARE",[owner])).rows[0];
      if(!user?.active)throw new HttpError(401,"Your access has ended.");
      if(!["Coordinator","Admin","Management"].includes(user.role))throw new HttpError(403,"Commercial preparation access required.");
      const d=(await c.query("SELECT * FROM survey_drafts WHERE id=$1 AND owner_id=$2 FOR UPDATE",[id,owner])).rows[0];
      if(!d)throw new HttpError(404,"Draft not found.");
      const existing=(await c.query("SELECT r.* FROM boq_draft_finalizations f JOIN boq_revisions r ON r.id=f.revision_id WHERE f.draft_id=$1",[id])).rows[0];
      if(existing)return existing;
      if(d.version!==version)throw new HttpError(409,"Draft changed. Save and recalculate before creating a quotation.");
      const survey=surveySchema.parse(d.inputs);
      if(survey.uploadIds.length&&!survey.ocrReviewed)throw new HttpError(400,"Review source documents first.");
      await this.uploads(c,owner,survey.uploadIds,d.base_revision_id);
      const source=d.base_revision_id?(await c.query("SELECT snapshot FROM boq_revisions WHERE id=$1",[d.base_revision_id])).rows[0]?.snapshot:null;
      const snapshot=source?.frameworkRevisionBasis?frameworkCosting(source,survey):calculate(survey,await new MastersRepository(c,true).list());
      // Owner deferred electrical certification on 9 October 2026; retain pending
      // snapshot status and calculation checks without blocking commercial preparation.
      if(fingerprint(snapshot)!==expected)throw new HttpError(409,"Reference data changed. Recalculate the costing.");
      return this.finalize(c,owner,d,snapshot,false);
    });
  }
  async finalize(c: PoolClient, actor: string, d: any, snapshot: BoqSnapshot, managementApproved = true) {
    const s = snapshot.survey;
    let boq: string, revision: number, number: string;
    if (d.base_revision_id) {
      const base = (
        await c.query("SELECT * FROM boq_revisions WHERE id=$1", [
          d.base_revision_id,
        ])
      ).rows[0];
      const latest = (
        await c.query(
          "SELECT * FROM boq_revisions WHERE boq_id=$1 ORDER BY revision DESC LIMIT 1",
          [base.boq_id],
        )
      ).rows[0];
      if (latest.id !== base.id)
        throw new HttpError(
          409,
          "A newer BOQ revision exists. Start from the latest revision.",
        );
      if (!d.revision_reason.trim())
        throw new HttpError(400, "Enter a revision reason.");
      if (
        s.customerId !== base.snapshot.survey.customerId ||
        s.siteCode !== base.snapshot.survey.siteCode
      )
        throw new HttpError(400, "Revision identity cannot change.");
      boq = base.boq_id;
      revision = base.revision + 1;
      number = await allocateReference(c,'PBQ',randomUUID(),s.customerId,s.siteCode);
    } else {
      const existingSite = (
        await c.query(
          "SELECT id,status FROM sites WHERE customer_id=$1 AND lower(code)=lower($2) FOR UPDATE",
          [s.customerId, s.siteCode],
        )
      ).rows[0];
      if (existingSite && existingSite.status !== "Active")
        throw new HttpError(
          409,
          "This site is inactive. Select an active site.",
        );
      const site =
        existingSite?.id ??
        (await c.query("SELECT COALESCE(max(id),0)+1 AS id FROM sites")).rows[0]
          .id;
      if (!existingSite)
        await c.query(
          "INSERT INTO sites(id,customer_id,name,code,location,status) VALUES($1,$2,$3,$4,$5,'Active')",
          [site, s.customerId, s.siteName, s.siteCode, s.location],
        );
      boq = randomUUID();
      revision = 0;
      number = await allocateReference(c,"PBQ",boq,s.customerId,s.siteCode);
      await c.query(
        "INSERT INTO boqs(id,draft_id,site_id,customer_id,sequence,created_by) SELECT $1,$2,$3,$4,COALESCE(max(sequence),0)+1,$5 FROM boqs WHERE customer_id=$4 AND site_id=$3",
        [boq, d.id, site, s.customerId, actor],
      );
    }
    const saved = (
      await c.query(
        "INSERT INTO boq_revisions(id,boq_id,revision,number,snapshot,created_by,revision_reason,revision_origin) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [
          randomUUID(),
          boq,
          revision,
          number,
          snapshot,
          actor,
          d.base_revision_id ? d.revision_reason : "Initial BOQ",
          d.revision_origin,
        ],
      )
    ).rows[0];
    await c.query('INSERT INTO boq_preliminary_references(revision_id,number) VALUES($1,$2)',[saved.id,number]);
    for (const upload of s.uploadIds)
      await c.query(
        "INSERT INTO boq_uploads(revision_id,upload_id) VALUES($1,$2)",
        [saved.id, upload],
      );
    await c.query(
      "INSERT INTO boq_draft_finalizations(draft_id,revision_id) VALUES($1,$2)",
      [d.id, saved.id],
    );
    await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
      actor,
      `boq.${number}.${managementApproved ? "approved" : "saved-for-quotation"}`,
    ]);
    return saved;
  }
  async list(actor?: string) {
    return (
      await this.pool.query(
        `SELECT r.id,COALESCE(f.number,p.number,r.number) AS number,(p.revision_id IS NULL OR f.revision_id IS NOT NULL) AS is_final,CASE WHEN p.revision_id IS NOT NULL AND f.revision_id IS NULL THEN 'Preliminary' ELSE 'Final' END AS document_state,r.revision,r.revision_reason,r.boq_id,r.created_at,r.snapshot->'customer'->>'id' AS customer_id,r.snapshot->'customer'->>'name' AS customer,r.snapshot->'survey'->>'siteName' AS site,r.snapshot->'survey'->>'family' AS family,r.snapshot->>'total' AS total,EXISTS(SELECT 1 FROM boqs source_b JOIN project_workflow_records source_w ON (source_w.data->>'coordinationQuotationDraftId'=source_b.draft_id::text OR source_w.data->>'linkedBoqRevisionId'=r.id::text) WHERE source_b.id=r.boq_id AND source_w.route='survey-quote') AS from_technical_report FROM boq_revisions r LEFT JOIN boq_preliminary_references p ON p.revision_id=r.id LEFT JOIN boq_customer_final_references f ON f.revision_id=r.id ${actor ? `WHERE ${ownedCondition("boq", "r.id", "$1")}` : "WHERE true"} AND NOT EXISTS(SELECT 1 FROM test_workflow_archives archived WHERE archived.key LIKE 'LOCAL-REVIEW-SAMPLES-%' AND archived.records->'localPreviewDocumentIds' ? r.id::text) ORDER BY created_at DESC LIMIT 200`,
        actor ? [actor] : [],
      )
    ).rows;
  }
  async get(id: string) {
    const r = (
      await this.pool.query("SELECT r.*,COALESCE(f.number,p.number,r.number) AS number,(p.revision_id IS NULL OR f.revision_id IS NOT NULL) AS is_final FROM boq_revisions r LEFT JOIN boq_preliminary_references p ON p.revision_id=r.id LEFT JOIN boq_customer_final_references f ON f.revision_id=r.id WHERE r.id=$1", [id])
    ).rows[0];
    if (!r) throw new HttpError(404, "BOQ not found.");
    return r;
  }
  async upload(owner: string, name: string, mime: string, bytes: Buffer) {
    return transaction(this.pool, async (c) => {
      await this.actor(c, owner);
      const quota = (
        await c.query(
          "SELECT count(*) FROM survey_uploads WHERE owner_id=$1 AND created_at>now()-interval '1 hour'",
          [owner],
        )
      ).rows[0].count;
      if (Number(quota) >= 20)
        throw new HttpError(429, "Upload limit reached. Try again later.");
      const id = randomUUID();
      await c.query(
        "INSERT INTO survey_uploads(id,owner_id,filename,mime,size,sha256,content) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          owner,
          name,
          mime,
          bytes.length,
          createHash("sha256").update(bytes).digest("hex"),
          bytes,
        ],
      );
      return { id, filename: name, mime, size: bytes.length };
    });
  }
  async attachment(owner: string, id: string) {
    const r = (
      await this.pool.query(
        "SELECT * FROM survey_uploads WHERE id=$1 AND (owner_id=$2 OR EXISTS(SELECT 1 FROM commercial_pricing_versions cp WHERE cp.snapshot->'input'->'discountApprovalEvidence' @> jsonb_build_array(jsonb_build_object('id',$1::text)) AND (cp.created_by=$2 OR EXISTS(SELECT 1 FROM users WHERE id=$2 AND active AND role IN('Admin','Management')))) OR EXISTS(SELECT 1 FROM design_survey_handoffs h WHERE h.assigned_to=$2 AND h.inputs->'uploadIds' ? $1::text) OR EXISTS(SELECT 1 FROM boq_uploads bu JOIN boq_revisions br ON br.id=bu.revision_id JOIN boqs b ON b.id=br.boq_id JOIN survey_drafts sd ON sd.id=b.draft_id WHERE bu.upload_id=$1 AND (b.created_by=$2 OR sd.owner_id=$2 OR br.created_by=$2 OR EXISTS(SELECT 1 FROM users WHERE id=$2 AND active AND role IN('Admin','Management')))) OR EXISTS(SELECT 1 FROM external_document_approval_files ef JOIN external_document_approvals ea ON ea.id=ef.approval_id WHERE ef.upload_id=$1 AND (ea.recorded_by=$2 OR EXISTS(SELECT 1 FROM users WHERE id=$2 AND active AND role IN('Admin','Management')))) OR EXISTS(SELECT 1 FROM costing_approval_evidence e JOIN costing_approval_instructions a ON a.submission_id=e.submission_id WHERE e.upload_id=$1 AND (a.recorded_by=$2 OR EXISTS(SELECT 1 FROM users WHERE id=$2 AND active AND role IN('Admin','Management')))) OR EXISTS(SELECT 1 FROM boq_review_submissions s JOIN survey_drafts d ON d.id=s.draft_id WHERE (s.snapshot->'survey'->'uploadIds') ? $1::text AND (d.owner_id=$2 OR EXISTS(SELECT 1 FROM users WHERE id=$2 AND active AND role IN('Admin','Management')))))",
        [id, owner],
      )
    ).rows[0];
    if (!r) throw new HttpError(404, "Attachment not found.");
    return r;
  }
}
