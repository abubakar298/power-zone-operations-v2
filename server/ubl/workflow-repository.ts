import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { transaction } from "../db/transaction.js";
import { HttpError } from "../http/errors.js";
import { Decimal } from "decimal.js";
import { ublIpoSample } from "./ipo-sample.js";
import {
  publicDocument,
  transition,
  ublStages,
  type WorkflowAction,
} from "./workflow-state.js";
type Db = Pool | PoolClient;
export class UblWorkflowRepository {
  constructor(private pool: Pool) {}
  async access(actor: string, c: Db = this.pool) {
    const u = (
      await c.query("SELECT id,role,active FROM users WHERE id=$1", [actor])
    ).rows[0];
    if (!u?.active) throw new HttpError(401, "Your access has ended.");
    if (
      ![
        "Admin",
        "Management",
        "Coordinator",
        "Design",
        "Operations",
        "Accounts",
      ].includes(u.role)
    )
      throw new HttpError(403, "UBL workflow department access required.");
    return u;
  }
  async sources(actor: string) {
    await this.access(actor);
    return (
      await this.pool.query(
        "SELECT s.sha256,s.filename,jsonb_array_length(s.records) AS site_count,b.id AS imported_batch,b.created_at,b.created_by FROM ubl_workflow_sources s LEFT JOIN ubl_workflow_batches b ON b.source_sha256=s.sha256 ORDER BY s.created_at",
      )
    ).rows;
  }
  async sourceFile(actor: string, sha: string) {
    await this.access(actor);
    const row = (
      await this.pool.query(
        "SELECT * FROM ubl_workflow_sources WHERE sha256=$1",
        [sha],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "Source workbook not found.");
    return row;
  }
  async import(actor: string, sha: string) {
    return transaction(this.pool, async (c) => {
      const u = await this.access(actor, c);
      if (!["Admin", "Management"].includes(u.role))
        throw new HttpError(
          403,
          "Administrator or Management imports the reviewed source.",
        );
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtext('ubl-workflow-import'))",
      );
      const old = (
        await c.query(
          "SELECT * FROM ubl_workflow_batches WHERE source_sha256=$1",
          [sha],
        )
      ).rows[0];
      if (old) return { batchId: old.id, repeated: true };
      const source = (
        await c.query("SELECT * FROM ubl_workflow_sources WHERE sha256=$1", [
          sha,
        ])
      ).rows[0];
      if (!source) throw new HttpError(404, "Reviewed source not found.");
      const customer = (
        await c.query(
          "SELECT id FROM customers WHERE lower(short_code)='ubl' AND status='Active'",
        )
      ).rows[0];
      if (!customer)
        throw new HttpError(422, "Active UBL customer is required.");
      const batch = randomUUID();
      await c.query(
        "INSERT INTO ubl_workflow_batches(id,source_sha256,created_by) VALUES($1,$2,$3)",
        [batch, sha, actor],
      );
      // Coordinate with other master creation routes before choosing manually allocated IDs.
      await c.query("LOCK TABLE sites IN SHARE ROW EXCLUSIVE MODE");
      const sajid = (
        await c.query(
          "SELECT id FROM users WHERE active AND role='Design' AND lower(email)='sajidkasrana@powerzone.com.pk'",
        )
      ).rows[0]?.id;
      for (const r of source.records) {
        let siteId: number | null = null;
        if (r.branch) {
          const matches = (
            await c.query(
              "SELECT id FROM sites WHERE customer_id=$1 AND (code=$2 OR (code ~ '^[0-9]+$' AND $2 ~ '^[0-9]+$' AND ltrim(code,'0')=ltrim($2,'0')))",
              [customer.id, r.branch],
            )
          ).rows;
          if (matches.length > 1)
            throw new HttpError(
              409,
              `Multiple sites match branch ${r.branch}. Review before import.`,
            );
          if (matches.length) siteId = matches[0].id;
          else {
            siteId = (
              await c.query("SELECT COALESCE(max(id),0)+1 AS id FROM sites")
            ).rows[0].id;
            await c.query(
              "INSERT INTO sites(id,customer_id,name,code,location,status) VALUES($1,$2,$3,$4,$5,$6)",
              [
                siteId,
                customer.id,
                r.name.replace(/^UBL\s+/i, ""),
                r.branch,
                [r.source.branch.Region, r.source.branch.Cluster]
                  .filter(Boolean)
                  .join(" · "),
                "Active",
              ],
            );
          }
        }
        const already = (
          await c.query(
            "SELECT id FROM ubl_workflow_requests WHERE customer_id=$1 AND branch_code=$2 AND stage NOT IN($3,$4)",
            [customer.id, r.branch, "Declined", "Confirmed BOQ issued"],
          )
        ).rows[0];
        if (already)
          throw new HttpError(
            409,
            `Branch ${r.branch} already has an active request; reconcile it before another import.`,
          );
        const legacy = siteId
          ? (
              await c.query(
                "SELECT legacy_ipo_number FROM ubl_site_orders WHERE site_id=$1",
                [siteId],
              )
            ).rows[0]
          : null;
        const data = {
          ipoNumber: legacy?.legacy_ipo_number ?? null,
          configuration: r.configuration,
          pricingStage: r.configuration ? "Revised" : null,
          technicalVerified: false,
          surveyStatus: r.source.register["Survey Status"],
          planningOwnerId: sajid ?? null,
          operationsOwnerId: null,
          operationsTeam: r.operations,
          technicalOwnerId: null,
          flags: r.flags,
          documentsPending: r.documents_pending,
          reportedRecommendation: r.reported_recommendation,
          reportedSubmission:
            r.source.dates["Revised Report Sent to UBL"] ??
            r.source.dates["Initial Report Sent to UBL"] ??
            null,
          reportedHeadsUp: r.source.dates["PO Heads-up Date"] ?? null,
          expectedWatts: r.source.register["Expected System Size"],
          notes:
            r.branch === "2756"
              ? "Abu Bakar reports installation nearing completion (12 October 2026); revised PO pending."
              : (r.source.register["Operational Notes"] ?? ""),
          originalOrderPreserved: r.branch === "2756",
        };
        const id = randomUUID();
        await c.query(
          "INSERT INTO ubl_workflow_requests(id,batch_id,source_key,source_row,customer_id,site_id,branch_code,site_name,stage,data,source,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [
            id,
            batch,
            r.key,
            r.source_row,
            customer.id,
            siteId,
            r.branch,
            r.name.replace(/^UBL\s+/i, ""),
            r.stage,
            data,
            r.source,
            actor,
          ],
        );
        await c.query(
          "INSERT INTO ubl_workflow_events(id,request_id,version,action,snapshot,created_by) VALUES($1,$2,1,$3,$4,$5)",
          [
            randomUUID(),
            id,
            "Imported historical status",
            {
              stage: r.stage,
              data,
              sourceKey: r.key,
              sourceRow: r.source_row,
              historicalDates: r.source.dates,
            },
            actor,
          ],
        );
        await this.makeDocument(
          c,
          actor,
          {
            id,
            customer_id: customer.id,
            site_id: siteId,
            site_name: r.name.replace(/^UBL\s+/i, ""),
            branch_code: r.branch,
            source_row: r.source_row,
          },
          "Survey intake",
          {
            label: "Prepared from imported data - verification pending",
            findings: r.source.findings,
            dates: r.source.dates,
          },
          data,
        );
        if (r.reported_recommendation)
          await this.makeDocument(
            c,
            actor,
            {
              id,
              customer_id: customer.id,
              site_id: siteId,
              site_name: r.name.replace(/^UBL\s+/i, ""),
              branch_code: r.branch,
              source_row: r.source_row,
            },
            "Recommendation draft",
            {
              label: "Prepared from imported data - verification pending",
              reportedRecommendation: r.reported_recommendation,
              findings: r.source.findings,
            },
            data,
          );
      }
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `ubl.bulk.${batch}.imported.${source.records.length}`,
      ]);
      return { batchId: batch, repeated: false };
    });
  }
  async list(actor: string) {
    await this.access(actor);
    const rows = (
      await this.pool.query(
        `SELECT r.*,p.display_name AS planning_owner,o.display_name AS operations_owner,t.display_name AS technical_owner,s.code AS canonical_branch_code FROM ubl_workflow_requests r LEFT JOIN users p ON p.id::text=r.data->>'planningOwnerId' LEFT JOIN users o ON o.id::text=r.data->>'operationsOwnerId' LEFT JOIN users t ON t.id::text=r.data->>'technicalOwnerId' LEFT JOIN sites s ON s.id=r.site_id ORDER BY r.source_row`,
      )
    ).rows;
    return {
      requests: rows,
      stages: ublStages,
      people: (
        await this.pool.query(
          "SELECT id,display_name,role FROM users WHERE active AND role IN('Design','Coordinator','Operations') ORDER BY display_name",
        )
      ).rows,
    };
  }
  async detail(actor: string, id: string) {
    const u = await this.access(actor),
      r = (
        await this.pool.query(
          "SELECT * FROM ubl_workflow_requests WHERE id=$1",
          [id],
        )
      ).rows[0];
    if (!r) throw new HttpError(404, "UBL request not found.");
    const docs = (
      await this.pool.query(
        "SELECT id,kind,version,snapshot,created_at FROM ubl_workflow_documents WHERE request_id=$1 ORDER BY created_at DESC",
        [id],
      )
    ).rows.map((d) => ({ ...d, snapshot: publicDocument(d.snapshot, u.role) }));
    const events = (
      await this.pool.query(
        "SELECT e.id,e.version,e.action,e.snapshot,e.created_at,u.display_name AS actor FROM ubl_workflow_events e JOIN users u ON u.id=e.created_by WHERE request_id=$1 ORDER BY version DESC",
        [id],
      )
    ).rows.map((e) => ({ ...e, snapshot: publicDocument(e.snapshot, u.role) }));
    const attachments = (
      await this.pool.query(
        "SELECT id,kind,filename,created_at FROM ubl_workflow_attachments WHERE request_id=$1 ORDER BY created_at",
        [id],
      )
    ).rows;
    return { request: r, documents: docs, events, attachments };
  }
  async document(actor: string, id: string) {
    const u = await this.access(actor),
      d = (
        await this.pool.query(
          "SELECT * FROM ubl_workflow_documents WHERE id=$1",
          [id],
        )
      ).rows[0];
    if (!d) throw new HttpError(404, "UBL document not found.");
    const customerMaster=(await this.pool.query('SELECT c.name,c.contact_person,c.phone,c.address FROM customers c JOIN ubl_workflow_requests r ON r.customer_id=c.id WHERE r.id=$1',[d.request_id])).rows[0];
    const snapshot=publicDocument(d.snapshot,u.role);
    return { ...d, snapshot: snapshot.sample?{...snapshot,sample:{...snapshot.sample,customerMaster}}:snapshot };
  }
  async attach(
    actor: string,
    id: string,
    kind: string,
    filename: string,
    mime: string,
    content: Buffer,
  ) {
    return transaction(this.pool, async (c) => {
      const u = await this.access(actor, c);
      if (
        u.role === "Operations" &&
        !["Operations evidence", "Heads-up evidence"].includes(kind)
      )
        throw new HttpError(
          403,
          "Operations can attach preparation evidence only.",
        );
      if (
        !(
          await c.query("SELECT id FROM ubl_workflow_requests WHERE id=$1", [
            id,
          ])
        ).rowCount
      )
        throw new HttpError(404, "UBL request not found.");
      const sha = createHash("sha256").update(content).digest("hex"),
        old = (
          await c.query(
            "SELECT id FROM ubl_workflow_attachments WHERE request_id=$1 AND sha256=$2 AND kind=$3",
            [id, sha, kind],
          )
        ).rows[0];
      if (old) return old;
      return (
        await c.query(
          "INSERT INTO ubl_workflow_attachments(id,request_id,kind,filename,mime,sha256,content,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
          [randomUUID(), id, kind, filename, mime, sha, content, actor],
        )
      ).rows[0];
    });
  }
  async attachment(actor: string, id: string) {
    await this.access(actor);
    const a = (
      await this.pool.query(
        "SELECT * FROM ubl_workflow_attachments WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!a) throw new HttpError(404, "Attachment not found.");
    return a;
  }
  async action(
    actor: string,
    id: string,
    version: number,
    action: WorkflowAction,
    input: any,
  ) {
    return transaction(this.pool, async (c) => {
      const u = await this.access(actor, c),
        r = (
          await c.query(
            "SELECT * FROM ubl_workflow_requests WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
      if (!r) throw new HttpError(404, "UBL request not found.");
      if (r.version !== version)
        throw new HttpError(
          409,
          "This request changed. Reload before continuing.",
        );
      const d = { ...r.data };
      if (action === "identity") {
        transition(r.stage, action, u.role, d);
        if (r.site_id || !input.branchCode)
          throw new HttpError(
            422,
            "Only unresolved sites can receive a confirmed branch code.",
          );
        await c.query("LOCK TABLE sites IN SHARE ROW EXCLUSIVE MODE");
        const matches = (
          await c.query(
            "SELECT id FROM sites WHERE customer_id=$1 AND (code=$2 OR (code ~ '^[0-9]+$' AND $2 ~ '^[0-9]+$' AND ltrim(code,'0')=ltrim($2,'0')))",
            [r.customer_id, input.branchCode],
          )
        ).rows;
        if (matches.length > 1)
          throw new HttpError(
            409,
            "More than one existing site matches this branch.",
          );
        const siteId =
          matches[0]?.id ??
          (await c.query("SELECT COALESCE(max(id),0)+1 AS id FROM sites"))
            .rows[0].id;
        if (!matches.length)
          await c.query(
            "INSERT INTO sites(id,customer_id,name,code,location,status) VALUES($1,$2,$3,$4,$5,$6)",
            [
              siteId,
              r.customer_id,
              r.site_name,
              input.branchCode,
              r.source.branch?.Region ?? "",
              "Active",
            ],
          );
        await c.query(
          "UPDATE ubl_workflow_requests SET site_id=$2,branch_code=$3,version=version+1,updated_at=now() WHERE id=$1",
          [id, siteId, input.branchCode],
        );
        await c.query(
          "INSERT INTO ubl_workflow_events(id,request_id,version,action,snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            id,
            version + 1,
            "Site identity confirmed",
            {
              siteId,
              branchCode: input.branchCode,
              originalSource: r.source_key,
            },
            actor,
          ],
        );
        return { id, version: version + 1, stage: r.stage };
      }
      if (!r.site_id)
        throw new HttpError(
          422,
          "Resolve the missing branch code and canonical site before releasing this request.",
        );
      if(action==='historical-po'){
        if(!['Admin','Management'].includes(u.role)||!r.data.originalOrderPreserved||r.stage!=='Existing job—Revised PO pending'||!input.verified||!input.notes?.trim()||!input.poNumber||!input.date||!input.configuration||!input.pricingStage)throw new HttpError(422,'Confirm the original approved configuration, revised PO and historical source reference.');
        const proof=(await c.query("SELECT kind,filename,id FROM ubl_workflow_attachments WHERE request_id=$1",[id])).rows;
        if(!proof.some(f=>f.kind==='Customer PO')||!proof.some(f=>f.kind==='Operations evidence'&&/IPO/i.test(f.filename)))throw new HttpError(422,'Attach the original revised Customer PO and original IPO as Operations evidence.');
        const original=(await c.query('SELECT legacy_ipo_number FROM ubl_site_orders WHERE site_id=$1',[r.site_id])).rows[0];
        if(!original||String(original.legacy_ipo_number)!==String(r.data.ipoNumber))throw new HttpError(409,'The preserved historical job identity must match the original IPO.');
        if((await c.query('SELECT 1 FROM customer_purchase_orders WHERE customer_id=$1 AND po_number=$2',[r.customer_id,input.poNumber])).rowCount)throw new HttpError(409,'The revised PO already has a registered order; link that existing source.');
        if((await c.query('SELECT 1 FROM ubl_site_orders WHERE po_number=$1 AND site_id<>$2',[input.poNumber,r.site_id])).rowCount||(await c.query("SELECT 1 FROM ubl_workflow_requests WHERE id<>$1 AND data->>'poNumber'=$2",[id,input.poNumber])).rowCount)throw new HttpError(409,'This PO is already linked to another site.');
        const agreed=(await c.query('SELECT snapshot FROM ubl_commercial_history WHERE configuration_id=$1 AND stage=$2',[input.configuration,input.pricingStage])).rows[0]?.snapshot;
        if(!input.approvedTotal||!agreed||!new Decimal(input.approvedTotal).eq(agreed.totalIncludingGst))throw new HttpError(422,'The original revised PO total must match this approved configuration and price version.');
        d.configuration=input.configuration;d.pricingStage=input.pricingStage;d.poNumber=input.poNumber;d.poDate=input.date;d.revisedPoPending=false;d.historicalOrderVerified=true;d.historicalOrderVerifiedBy=actor;d.historicalOrderEvidence=proof.map(f=>f.id);d.notes=input.notes;
      }
      if (action === "save" || action === "verify") {
        if (
          ![
            ...ublStages.slice(0, 5),
            "Deferred",
            "Existing job—Revised PO pending",
          ].includes(r.stage) &&
          !(r.stage === ublStages[5] && r.data.returnReason)
        )
          throw new HttpError(
            409,
            "PO received or documents issued; return for a controlled revision.",
          );
        if (
          input.configuration !== d.configuration ||
          input.pricingStage !== d.pricingStage
        )
          d.technicalVerified = false;
        for (const k of [
          "configuration",
          "pricingStage",
          "surveyStatus",
          "notes",
          "planningOwnerId",
          "operationsOwnerId",
          "technicalOwnerId",
          "scheduledSurveyDate",
          "actualSurveyDate",
        ])
          if (input[k] !== undefined) d[k] = input[k];
        if (
          d.surveyStatus === "Scheduled" &&
          (!d.scheduledSurveyDate || !d.planningOwnerId)
        )
          throw new HttpError(
            422,
            "Enter the scheduled survey date and survey planning owner.",
          );
        for (const [key, role] of [
          ["planningOwnerId", "Design"],
          ["operationsOwnerId", "Operations"],
          ["technicalOwnerId", "Design"],
        ])
          if (
            d[key] &&
            !(
              await c.query(
                "SELECT 1 FROM users WHERE id=$1 AND active AND role=$2",
                [d[key], role],
              )
            ).rowCount
          )
            throw new HttpError(
              422,
              "Choose an active person in the responsible department.",
            );
        if (
          u.role === "Coordinator" &&
          action === "save" &&
          ["planningOwnerId", "technicalOwnerId"].some(
            (k) => input[k] !== undefined && input[k] !== r.data[k],
          )
        )
          throw new HttpError(
            403,
            "Design manages survey and technical assignments.",
          );
      }
      if (action === "verify") {
        if (input.verified !== true)
          throw new HttpError(
            422,
            "Confirm the surveyed inputs and configuration were reviewed.",
          );
        if (!d.pricingStage)
          throw new HttpError(422, "Select the agreed price version.");
        const findings = r.source.findings ?? {};
        const attached = (
          await c.query(
            "SELECT 1 FROM ubl_workflow_attachments WHERE request_id=$1 AND kind='Survey report'",
            [id],
          )
        ).rowCount;
        if (!attached && !findings["Vendor Recommendation"])
          throw new HttpError(
            422,
            "Upload the survey report before technical verification.",
          );
        d.technicalVerified = true;
        d.technicalVerifiedBy = actor;
        d.surveyStatus = "Completed";
      }
      const next = transition(r.stage, action, u.role, d);
      const has = async (kind: string) =>
        (
          await c.query(
            "SELECT 1 FROM ubl_workflow_attachments WHERE request_id=$1 AND kind=$2",
            [id, kind],
          )
        ).rowCount;
      if (
        [
          "submit",
          "headsup",
          "sample-accept",
          "sample-return",
          "revision-pending",
          "defer",
          "decline",
          "return",
          "acknowledge",
        ].includes(action) &&
        !input.notes?.trim()
      )
        throw new HttpError(422, "Enter the action reference or remarks.");
      if (action === "submit" && !(await has("Sending evidence")))
        throw new HttpError(
          422,
          "Attach recommendation sending evidence before recording a new submission.",
        );
      if (action === "revision-pending") {
        const demand = await c.query(
          "SELECT 1 FROM ubl_workflow_demand WHERE request_id=$1",
          [id],
        );
        if (demand.rowCount)
          throw new HttpError(
            409,
            "Resolve the existing material demand before reclassification.",
          );
        d.materialPlanningRequired = false;
        d.revisedPoPending = true;
        d.notes = input.notes;
      }
      if (action === "headsup") d.reportedHeadsUp = input.date ?? null;
      if (["advance", "confirmed"].includes(action)) {
        if (
          !input.recipientId ||
          !(
            await c.query(
              "SELECT 1 FROM users WHERE id=$1 AND active AND role='Operations'",
              [input.recipientId],
            )
          ).rowCount
        )
          throw new HttpError(422, "Choose an active Operations recipient.");
      }
      if (action === "po") {
        if (!input.poNumber || !input.date || !(await has("Customer PO")))
          throw new HttpError(
            422,
            "Enter the actual PO number/date and attach its original document.",
          );
        if (
          input.configuration !== d.configuration ||
          input.pricingStage !== d.pricingStage
        )
          throw new HttpError(
            422,
            "The PO differs from the recommendation. Reconcile the configuration and price through Design before recording it.",
          );
        if (
          (
            await c.query(
              "SELECT 1 FROM ubl_site_orders WHERE po_number=$1 AND site_id<>$2",
              [input.poNumber, r.site_id],
            )
          ).rowCount
        )
          throw new HttpError(
            409,
            "That PO is already linked to another site.",
          );
        if (
          (
            await c.query(
              "SELECT 1 FROM customer_purchase_orders WHERE customer_id=$1 AND po_number=$2",
              [r.customer_id, input.poNumber],
            )
          ).rowCount
        )
          throw new HttpError(
            409,
            "That PO already exists in the customer PO register. Link and reconcile the existing record.",
          );
        d.poNumber = input.poNumber;
        d.poDate = input.date;
      }
      if (action === "ipo") {
        if (!input.ipoNumber || !/^\d{1,8}$/.test(input.ipoNumber))
          throw new HttpError(
            422,
            "Enter the assigned numeric IPO / CHP job number.",
          );
        const existing = (
          await c.query(
            "SELECT legacy_ipo_number FROM ubl_site_orders WHERE legacy_ipo_number=$1 AND site_id<>$2",
            [input.ipoNumber, r.site_id],
          )
        ).rows[0];
        if (existing)
          throw new HttpError(
            409,
            "That CHP job number already belongs to another site.",
          );
        if (
          (
            await c.query(
              "SELECT 1 FROM internal_purchase_orders WHERE number=$1 OR snapshot->>'jobId'=$1",
              [`CHP-${input.ipoNumber}`],
            )
          ).rowCount
        )
          throw new HttpError(
            409,
            "That job ID already exists in the issued IPO register.",
          );
        if (d.originalOrderPreserved) {
          const legacy = (
            await c.query(
              "SELECT legacy_ipo_number FROM ubl_site_orders WHERE site_id=$1",
              [r.site_id],
            )
          ).rows[0];
          if (input.ipoNumber !== legacy?.legacy_ipo_number)
            throw new HttpError(422, "Use the existing Sukho Road IPO number.");
        }
        d.ipoNumber = input.ipoNumber;
      }
      if (["verify", "ipo", "sample", "historical-po"].includes(action)) {
        const h = (
          await c.query(
            "SELECT snapshot FROM ubl_commercial_history WHERE configuration_id=$1 AND stage=$2",
            [d.configuration, d.pricingStage],
          )
        ).rows[0];
        const b = (
          await c.query(
            "SELECT snapshot FROM ubl_cost_revisions WHERE configuration_id=$1 AND stage=$2 ORDER BY version DESC LIMIT 1",
            [d.configuration, d.pricingStage],
          )
        ).rows[0];
        if (!h || !b)
          throw new HttpError(
            422,
            "Approved pricing and budget snapshots are unavailable.",
          );
        const base = {
          ...b.snapshot,
          commercialEvidence: {
            ...h.snapshot,
            panelSellingExcludingGst: new Decimal(d.configuration.split("-")[0])
              .mul(1000)
              .mul(d.pricingStage === "Revised" ? 44 : 33)
              .toString(),
          },
          sellingIncludingGst: h.snapshot.totalIncludingGst,
        };
        const approved = (
          await c.query(
            "SELECT snapshot FROM ubl_site_document_versions WHERE snapshot->>'configuration_id'=$1 ORDER BY (snapshot->>'pricing_stage'=$2) DESC,version DESC LIMIT 1",
            [d.configuration, d.pricingStage],
          )
        ).rows[0]?.snapshot;
        // Retain approved PT allocation proportions. A refreshed budget cannot move selling between phases.
        const allocationBase = approved
          ? {
              ...approved.baseline,
              commercialEvidence: base.commercialEvidence,
              sellingIncludingGst: base.sellingIncludingGst,
            }
          : base;
        const site = {
          status: "Active",
          configuration_id: d.configuration,
          pricing_stage: d.pricingStage,
          site_name: r.site_name,
          branch_code: r.branch_code,
          region: r.source.branch?.Region ?? "",
          main_city: r.source.branch?.Cluster ?? "",
          legacy_ipo_number:
            action === "sample"
              ? "SAMPLE - NOT ASSIGNED"
              : (d.ipoNumber ?? "Pending"),
          po_number:
            action === "sample"
              ? "Not received - review sample"
              : (d.poNumber ?? "Pending"),
          po_issued_date: d.poDate ?? "Pending",
          agreedWatts: Number(d.configuration.split("-")[0]) * 1000,
          panelSellingRate: d.pricingStage === "Revised" ? 44 : 33,
          documentStatus:
            action === "ipo"
              ? "Submitted to Accounts"
              : "Verified recommendation - sending evidence remains separate",
        };
        const sample = ublIpoSample({ ...site, baseline: allocationBase }),
          budget = ublIpoSample({ ...site, baseline: base });
        sample.phases = sample.phases.map((p, i) => ({
          ...p,
          budgetedCost: budget.phases[i].budgetedCost,
          markup: new Decimal(p.sellingExcludingGst)
            .sub(budget.phases[i].budgetedCost)
            .toFixed(2),
        }));
        sample.budgetedCost = budget.budgetedCost;
        sample.markupAmount = new Decimal(sample.totalSellingExcludingGst)
          .sub(sample.budgetedCost)
          .toFixed(2);
        sample.markupPercent = new Decimal(sample.markupAmount)
          .div(sample.budgetedCost)
          .mul(100)
          .toFixed(2);
        if(action==='historical-po')await this.makeDocument(c,actor,r,'Historical approved order',{site,baseline:{...base,sellingExcludingGst:sample.totalSellingExcludingGst},sample,source:'Original revised PO and existing issued IPO; no new order, technical survey, stock or financial posting'},d);
        if (action !== "sample" && action !== 'historical-po')
          await this.makeDocument(
            c,
            actor,
            r,
            "Recommendation",
            {
              sample,
              baseline: base,
              label:
                "Verified technical recommendation - customer sending evidence remains separate",
            },
            d,
          );
        if (["ipo", "sample"].includes(action)) {
          await this.makeDocument(
            c,
            actor,
            r,
            action === "sample" ? "IPO / PT review sample" : "IPO / PT",
            { sample, baseline: base, reviewOnly: action === "sample" },
            d,
          );
          if (action === "sample") d.accountsReviewSample = true;
        }
      }
      if (["advance", "confirmed"].includes(action)) {
        const t = (
          await c.query(
            "SELECT snapshot FROM ubl_technical_versions WHERE configuration_id=$1 ORDER BY version DESC LIMIT 1",
            [d.configuration],
          )
        ).rows[0];
        if (!t) throw new HttpError(422, "Technical BOQ is unavailable.");
        const previous = (
          await c.query(
            "SELECT snapshot FROM ubl_workflow_documents WHERE request_id=$1 AND kind='Advance BOQ' ORDER BY version DESC LIMIT 1",
            [id],
          )
        ).rows[0];
        const current = t.snapshot.currentBoq ?? t.snapshot.rows;
        if (!Array.isArray(current) || !current.length)
          throw new HttpError(
            422,
            "A material BOQ is required before this release.",
          );
        const before = previous?.snapshot?.rows ?? [];
        const differences = current
          .filter(
            (x: any) =>
              JSON.stringify(before.find((p: any) => p.id === x.id)) !==
              JSON.stringify(x),
          )
          .map((x: any) => ({
            id: x.id,
            description: x.description,
            previousQuantity:
              before.find((p: any) => p.id === x.id)?.quantity ??
              "Not in advance BOQ",
            confirmedQuantity: x.quantity,
          }));
        const snapshot = {
          rows: current,
          recipientId: input.recipientId,
          expectedDate: input.date ?? null,
          label:
            action === "advance"
              ? "ADVANCE PREPARATION — PO NOT RECEIVED"
              : "CONFIRMED EXECUTION BOQ",
          previousAdvance: before.length ? before : null,
          differences: before.length ? differences : [],
          authorization:
            action === "advance"
              ? "Preparation only. Purchasing, stock commitment, physical dispatch and installation require separate applicable authorization."
              : "Confirmed BOQ after Accounts acceptance. Warehouse issuance and physical dispatch retain their separate authorization and gate evidence controls.",
        };
        const doc = await this.makeDocument(
          c,
          actor,
          r,
          action === "advance" ? "Advance BOQ" : "Confirmed BOQ",
          snapshot,
          d,
        );
        await c.query(
          "INSERT INTO ubl_workflow_demand(request_id,mode,document_id) VALUES($1,$2,$3) ON CONFLICT(request_id) DO UPDATE SET mode=excluded.mode,document_id=excluded.document_id",
          [id, action === "advance" ? "Provisional" : "Confirmed", doc.id],
        );
        d.recipientId = input.recipientId;
      }
      if (["sample-accept", "sample-return"].includes(action)) {
        d.sampleReviewDecision =
          action === "sample-accept"
            ? "Approved sample"
            : "Returned sample for revision";
        d.sampleReviewNotes = input.notes;
        d.sampleReviewedBy = actor;
      }
      if (action === "return") {
        d.returnReason = input.notes;
        d.technicalVerified = false;
      }
      if (action === "accept") d.accountsAcceptedBy = actor;
      if (action === "acknowledge") {
        if (u.role === "Operations" && d.recipientId !== actor)
          throw new HttpError(
            403,
            "Only the assigned Operations recipient can acknowledge this BOQ.",
          );
        d.operationsAcknowledged = true;
        d.preparationNotes = input.notes;
      }
      await c.query(
        "UPDATE ubl_workflow_requests SET stage=$2,version=version+1,data=$3,updated_at=now() WHERE id=$1",
        [id, next, d],
      );
      await c.query(
        "INSERT INTO ubl_workflow_events(id,request_id,version,action,snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          id,
          version + 1,
          action,
          {
            from: r.stage,
            stage: next,
            data: d,
            notes: input.notes ?? "",
            historicalDate: input.date ?? null,
          },
          actor,
        ],
      );
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `ubl.request.${id}.v${version + 1}.${action}`,
      ]);
      return { id, version: version + 1, stage: next };
    }).catch((e) => {
      if (e.code === "23505")
        throw new HttpError(
          409,
          "That PO or IPO is already registered. Refresh and reconcile the existing record.",
        );
      throw e;
    });
  }
  private async makeDocument(
    c: PoolClient,
    actor: string,
    r: any,
    kind: string,
    snapshot: any,
    d: any,
  ) {
    const v = Number(
        (
          await c.query(
            "SELECT COALESCE(max(version),0)+1 AS v FROM ubl_workflow_documents WHERE request_id=$1 AND kind=$2",
            [r.id, kind],
          )
        ).rows[0].v,
      ),
      id = randomUUID();
    await c.query(
      "INSERT INTO ubl_workflow_documents(id,request_id,kind,version,snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6)",
      [
        id,
        r.id,
        kind,
        v,
        {
          ...snapshot,
          customerId: r.customer_id,
          siteId: r.site_id,
          siteName: r.site_name,
          branchCode: r.branch_code,
          configuration: d.configuration,
          pricingStage: d.pricingStage,
          jobId: d.ipoNumber ? `CHP-${d.ipoNumber}` : null,
          poNumber: d.poNumber ?? null,
          sourceRow: r.source_row,
          version: v,
          kind,
        },
        actor,
      ],
    );
    return { id };
  }
}
