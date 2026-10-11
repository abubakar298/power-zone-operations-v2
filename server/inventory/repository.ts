import { fingerprint } from "../boq/repository.js";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { transaction } from "../db/transaction.js";
import { HttpError } from "../http/errors.js";
import {
  reconcile,
  validateSubmission,
  type InventoryLine,
  type ReportEntry,
} from "./reconciliation.js";
import { bulkEntry, verifiedGroups, BULK_IRR_ID } from "./bulk-irr.js";
export class InventoryRepository {
  constructor(private pool: Pool) {}
  async access(actor: string, write = false) {
    const u = (
      await this.pool.query("SELECT role,active FROM users WHERE id=$1", [
        actor,
      ])
    ).rows[0];
    if (!u?.active) throw new HttpError(401, "Your access has ended.");
    if (
      !(
        write
          ? ["Admin", "Management", "Inventory", "Operations"]
          : ["Admin", "Management", "Inventory", "Operations", "Accounts"]
      ).includes(u.role)
    )
      throw new HttpError(403, "Inventory or Accounts access required.");
    return u.role as string;
  }
  async jobs(actor: string) {
    await this.access(actor);
    const ubl = (
      await this.pool.query(
        "SELECT 'ubl:'||site_id AS key,'CHP-'||legacy_ipo_number AS job_id,'UBL' AS customer_code,site_name,configuration_id,branch_code FROM ubl_site_orders WHERE status='Active'",
      )
    ).rows;
    const regular = (
      await this.pool.query(
        "SELECT 'ipo:'||id AS key,CASE WHEN number ~ '^CPZ-IPO-[0-9]{2}-[0-9]+' THEN 'CHP-'||split_part(number,'-',4) ELSE number END AS job_id,snapshot->'customer'->>'shortCode' AS customer_code,snapshot->>'siteName' AS site_name,snapshot->>'solutionId' AS configuration_id,snapshot->>'siteCode' AS branch_code FROM internal_purchase_orders ORDER BY created_at DESC LIMIT 500",
      )
    ).rows;
    return [...ubl, ...regular];
  }
  async job(actor: string, key: string) {
    await this.access(actor);
    let lines: InventoryLine[], title: string, jobId: string, source: any;
    let bulk: ReturnType<typeof bulkEntry> = null;
    if (/^ubl:\d+$/.test(key)) {
      const s = (
        await this.pool.query(
          "SELECT * FROM ubl_site_orders WHERE site_id=$1 AND status='Active'",
          [key.slice(4)],
        )
      ).rows[0];
      if (!s?.baseline)
        throw new HttpError(404, "Active job with an approved BOQ not found.");
      jobId = "CHP-" + s.legacy_ipo_number;
      title = s.site_name;
      source = {
        kind: "UBL saved baseline",
        configuration: s.configuration_id,
        customerCode: "UBL",
        branchCode: s.branch_code,
        po: s.po_number,
        pricingStage: s.pricing_stage,
      };
      lines = s.baseline.items.map((l: any) => {
        const group = /cable|earth panel|DC earth|AC earth/i.test(l.item)
          ? "cable"
          : /Solar panels|Elevated structure|Installation including delivery/.test(
                l.item,
              )
            ? "watt"
            : "material";
        let rate: string | null = null;
        let tax = "18";
        if (l.item === "Solar panels") {
          tax = "10";
          rate = s.pricing_stage === "Revised" ? "44" : "33";
        }
        {
          if (l.item === "Elevated structure") rate = "26";
          if (l.item === "Installation including delivery" && s.legacy_ipo_number === "320") rate = "5.75";
          // Fixed original proposal selling rates by cable SKU; do not infer unit rates from rounded invoice totals.
          const refs: Record<string, string> = {
            "DC cable red 6mm²": "443", "DC cable black 6mm²": "443",
            "16mm² 4C inverter cable": "3220", "16mm² 4C load cable": "3220",
            "25mm² 4C load cable": "5003", "2.5mm² earth panel to panel": "154",
            "6mm² DC earth": "330", "10mm² AC earth": "575",
          };
          if (refs[l.item] !== undefined) rate = String(refs[l.item]);
        }
        return {
          key: l.item,
          description: l.item,
          approved: String(l.quantity),
          unit: group === "watt" ? "W" : l.unit,
          brand: "",
          specification: "",
          sellingRate: rate,
          gstRate: tax,
          group,
        };
      });
      const progress=(await this.pool.query("SELECT snapshot FROM project_source_links WHERE job_key=$1",[key])).rows[0]?.snapshot?.site;
      bulk=bulkEntry(String(s.legacy_ipo_number),lines,{start:progress?.project_start_date,end:progress?.completion_date});
      if(bulk) source.bulkIrr=bulk.provenance;
    } else if (/^ipo:[0-9a-f-]{36}$/.test(key)) {
      const i = (
        await this.pool.query(
          "SELECT * FROM internal_purchase_orders WHERE id=$1",
          [key.slice(4)],
        )
      ).rows[0];
      if (!i) throw new HttpError(404, "Job not found.");
      const b = (
        await this.pool.query(
          "SELECT snapshot FROM boq_revisions WHERE id=$1",
          [i.snapshot.boqRevisionId],
        )
      ).rows[0];
      if (!b) throw new HttpError(422, "The approved BOQ is unavailable.");
      jobId = /^CPZ-IPO-\d{2}-(\d+)/.test(i.number)
        ? "CHP-" + i.number.split("-")[3]
        : i.number;
      title = i.snapshot.siteName;
      source = {
        kind: "Approved IPO / BOQ",
        customerCode: i.snapshot.customer?.shortCode,
        branchCode: i.snapshot.siteCode,
        configuration: i.snapshot.solutionId,
        ipoId: i.id,
        quotation: i.snapshot.quotationNumber,
      };
      lines = b.snapshot.lines.map((l: any) => ({
        key: l.key,
        description: l.description || l.key,
        unit: l.unit,
        approved: String(l.qty),
        brand: l.brand || "",
        specification: l.specification || "",
        sellingRate: null,
        gstRate: l.key === "Solar PV Modules" ? "10" : "18",
        group: /cable/i.test(l.key) ? "cable" : "material",
      }));
    } else throw new HttpError(400, "Select a valid job.");
    return {
      key,
      jobId,
      title,
      source,
      lines,
      bulkEntry: bulk?.entry,
      rateBasis:
        "Original proposal reference; potential adjustments are not approved invoice values",
    };
  }
  async receiveBulk(actor:string) {
    const role=await this.access(actor,true);
    if(!['Admin','Management'].includes(role))throw new HttpError(403,'Management access required for the bulk source import.');
    const result=[];
    for(const group of verifiedGroups){
      const site=(await this.pool.query("SELECT site_id FROM ubl_site_orders WHERE legacy_ipo_number=$1 AND status='Active'",[group.ipo])).rows[0];
      if(!site)throw new HttpError(422,`Active job CHP-${group.ipo} not found.`);
      const key='ubl:'+site.site_id,job=await this.job(actor,key);
      const existing=(await this.pool.query("SELECT r.id,v.version,v.stage,v.snapshot FROM inventory_reports r JOIN LATERAL(SELECT * FROM inventory_report_versions WHERE report_id=r.id ORDER BY version DESC LIMIT 1)v ON true WHERE r.job_key=$1",[key])).rows[0];
      if(existing){
        if(existing.snapshot.source?.bulkIrr?.importId!==BULK_IRR_ID)throw new HttpError(409,`CHP-${group.ipo} already has an Inventory report; review it before importing.`);
        if(existing.stage!=='IRR Received'){result.push({jobId:job.jobId,stage:existing.stage,unchanged:true});continue;}
      }
      let version=existing?.version??0;
      if(!existing){await this.save(actor,{jobKey:key,version:0,stage:'IRR Received',entry:job.bulkEntry!,requestKey:randomUUID()});version=1;}
      const saved=await this.save(actor,{jobKey:key,version,stage:'Draft Reconciliation',entry:job.bulkEntry!,requestKey:randomUUID()});
      result.push({jobId:job.jobId,...saved});
    }
    return {reports:result,reference:'Given in bulk by Abu Bakar — 11 October 2026',sentToAccounts:false};
  }
  async confirmBulkEquipment(actor:string) {
    const role=await this.access(actor,true);
    if(!['Admin','Management'].includes(role))throw new HttpError(403,'Management access required to record this confirmation.');
    const received=(await this.list(actor)).filter(r=>r.has_bulk_source);
    if(received.length!==22)throw new HttpError(409,'Receive all 22 bulk IRRs before recording this confirmation.');
    const results=[];
    for(const r of received){
      const d=await this.detail(actor,r.id),latest=d.versions[0];
      if(latest.snapshot.source.bulkIrr.equipmentConfirmation==='abu-bakar-equipment-panels-2026-10-11'){results.push({jobId:r.job_id,unchanged:true});continue;}
      if(latest.stage!=='Draft Reconciliation')throw new HttpError(409,`${r.job_id} is not an Inventory draft; review its workflow before changing it.`);
      const job=await this.job(actor,r.job_key),entry:ReportEntry=structuredClone(latest.snapshot.entry);
      for(const l of job.lines)if(/^(HYB-|HV 5kWh battery$|HV BMS$|UBL genset synchronization$)/.test(l.key))entry.usage[l.key]=l.approved;
      entry.panelCount=job.bulkEntry!.panelCount;entry.panelWattage=job.bulkEntry!.panelWattage;
      entry.remarks=entry.remarks.split('\n').filter((line:string)=>!line.startsWith('Unconfirmed items / IRR evidence needed:')).join('\n')+'\n'+job.source.bulkIrr.flags.filter((f:string)=>f.startsWith('Panel count and watts')||f.startsWith('Inverter, battery')||f.startsWith('Unconfirmed items / IRR evidence needed:')).join('\n');
      results.push({jobId:r.job_id,...await this.save(actor,{jobKey:r.job_key,version:latest.version,stage:'Draft Reconciliation',entry,requestKey:randomUUID()})});
    }
    return {reports:results,sentToAccounts:false};
  }
  async list(actor: string) {
    await this.access(actor);
    const identities = await this.jobs(actor);
    return (
      await this.pool.query(
        "SELECT r.id,r.job_key,v.version,v.stage,EXISTS(SELECT 1 FROM inventory_report_files f WHERE f.report_id=r.id) AS has_files,(v.snapshot->'source'->'bulkIrr' IS NOT NULL) AS has_bulk_source,v.snapshot->'source'->'bulkIrr'->'flags' AS review_flags,v.snapshot->'source'->'bulkIrr'->>'reference' AS bulk_reference,(SELECT x->>'net' FROM jsonb_array_elements(v.snapshot->'reconciliation'->'sections') x WHERE x->>'group'='cable') AS cable_net,v.created_at,v.snapshot->>'jobId' AS job_id,v.snapshot->>'title' AS site_name,u.display_name AS recorded_by FROM inventory_reports r JOIN LATERAL(SELECT * FROM inventory_report_versions WHERE report_id=r.id ORDER BY version DESC LIMIT 1)v ON true JOIN users u ON u.id=v.created_by WHERE r.job_key NOT LIKE 'archived-sample:%' ORDER BY v.created_at DESC",
      )
    ).rows.map(r => ({ ...r, ...identities.find(j => j.key === r.job_key) }));
  }
  async detail(actor: string, id: string) {
    await this.access(actor);
    const versions = (
      await this.pool.query(
        "SELECT v.*,u.display_name AS recorded_by FROM inventory_report_versions v JOIN users u ON u.id=v.created_by WHERE report_id=$1 ORDER BY version DESC",
        [id],
      )
    ).rows;
    if (!versions.length)
      throw new HttpError(404, "Installation report not found.");
    const files = (
      await this.pool.query(
        "SELECT id,filename,created_at FROM inventory_report_files WHERE report_id=$1 ORDER BY created_at",
        [id],
      )
    ).rows;
    return { versions, files };
  }
  async save(
    actor: string,
    input: {
      jobKey: string;
      version: number;
      stage: string;
      entry: ReportEntry;
      requestKey: string;
      reason?: string;
    },
  ) {
    const role = await this.access(actor, true);
    if (role === "Operations" && input.stage !== "IRR Received")
      throw new HttpError(
        403,
        "Operations can upload an IRR; Inventory prepares the reconciliation.",
      );
    const job = await this.job(actor, input.jobKey);
    if (input.stage === "Sent to Accounts")
      validateSubmission(input.entry, job.lines);
    return transaction(this.pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "irr:" + input.jobKey,
      ]);
      const replay = (
        await c.query(
          "SELECT * FROM inventory_report_versions WHERE request_key=$1",
          [input.requestKey],
        )
      ).rows[0];
      if (replay) {
        const previous = replay.snapshot.request;
        if (
          replay.created_by !== actor ||
          fingerprint(previous) !== fingerprint(input)
        )
          throw new HttpError(409, "Request key already used.");
        return {
          reportId: replay.report_id,
          version: replay.version,
          stage: replay.stage,
        };
      }
      let report = (
        await c.query(
          "SELECT * FROM inventory_reports WHERE job_key=$1 FOR UPDATE",
          [input.jobKey],
        )
      ).rows[0];
      if (!report) {
        report = (
          await c.query(
            "INSERT INTO inventory_reports(id,job_key,created_by) VALUES($1,$2,$3) RETURNING *",
            [randomUUID(), input.jobKey, actor],
          )
        ).rows[0];
      }
      const latest = (
        await c.query(
          "SELECT * FROM inventory_report_versions WHERE report_id=$1 ORDER BY version DESC LIMIT 1",
          [report.id],
        )
      ).rows[0];
      if ((latest?.version ?? 0) !== input.version)
        throw new HttpError(
          409,
          "A newer report exists. Reload before saving.",
        );
      if (role === "Operations" && latest && latest.stage !== "IRR Received")
        throw new HttpError(403, "Inventory is already reviewing this report.");
      if (latest?.stage === "Sent to Accounts")
        throw new HttpError(
          409,
          "Submitted report is read-only until Accounts returns it.",
        );
      if (
        input.stage === "Sent to Accounts" &&
        !(
          await c.query(
            "SELECT 1 FROM inventory_report_files WHERE report_id=$1",
            [report.id],
          )
        ).rowCount
      )
        throw new HttpError(
          400,
          "Attach the installation report before sending to Accounts.",
        );
      const snapshot = {
        ...job,
        entry: input.entry,
        reconciliation: reconcile(job.lines, input.entry),
        request: input,
      };
      await c.query(
        "INSERT INTO inventory_report_versions(id,report_id,version,stage,snapshot,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          randomUUID(),
          report.id,
          input.version + 1,
          input.stage,
          snapshot,
          input.requestKey,
          actor,
        ],
      );
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `inventory.irr.${input.stage}:${report.id}`,
      ]);
      return {
        reportId: report.id,
        version: input.version + 1,
        stage: input.stage,
      };
    });
  }
  async upload(
    actor: string,
    id: string,
    filename: string,
    mime: string,
    base64: string,
  ) {
    const role = await this.access(actor, true);
    const content = Buffer.from(base64, "base64");
    const signature =
      mime === "application/pdf"
        ? content.subarray(0, 5).toString() === "%PDF-"
        : mime === "image/png"
          ? content.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
          : mime === "image/jpeg"
            ? content.subarray(0, 3).toString("hex") === "ffd8ff"
            : false;
    if (!signature || content.length < 1 || content.length > 8388608)
      throw new HttpError(400, "Upload a PDF, PNG or JPEG up to 8 MB.");
    return transaction(this.pool, async (c) => {
      const report = (
        await c.query(
          "SELECT * FROM inventory_reports WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!report) throw new HttpError(404, "Report not found.");
      const latest = (
        await c.query(
          "SELECT stage FROM inventory_report_versions WHERE report_id=$1 ORDER BY version DESC LIMIT 1",
          [id],
        )
      ).rows[0];
      if (latest?.stage === "Sent to Accounts")
        throw new HttpError(409, "Submitted report attachments are read-only.");
      if (role === "Operations" && latest?.stage !== "IRR Received")
        throw new HttpError(403, "Inventory is already reviewing this report.");
      const uuid = randomUUID();
      await c.query(
        "INSERT INTO inventory_report_files(id,report_id,filename,media_type,content,created_by) VALUES($1,$2,$3,$4,$5,$6)",
        [uuid, id, filename, mime, content, actor],
      );
      return { id: uuid };
    });
  }
  async file(actor: string, id: string) {
    await this.access(actor);
    const file = (
      await this.pool.query(
        "SELECT filename,media_type,content FROM inventory_report_files WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!file) throw new HttpError(404, "Attachment not found.");
    return file;
  }
}
