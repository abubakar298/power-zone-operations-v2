# UBL bulk-site continuity workflow

## Reviewed source and import

The 36-row consolidated workbook is preserved byte-for-byte in `ubl_workflow_sources`, with its SHA-256 checksum. An Administrator or Management records the approved import through **UBL Site Workflow**. The actual actor and import timestamp are recorded separately from the workbook's historical dates.

This batch proposes 34 canonical site master records under the existing UBL customer, reuses Sukho Road, and retains Shadiwal in staging until its branch code is confirmed. Numeric branch matching tolerates leading zeros without changing source codes or existing canonical codes. A repeated checksum returns the existing batch; duplicate active canonical sites and PO/job references are rejected.

Sukho Road retains CHP-315 and its existing order history. Abu Bakar's 12 October clarification is recorded as reported installation nearing completion, with revised PO pending. It is not a verified completion or a newly received PO.

## Department pickup

Initial Atif counts are 10 Survey Requests & Tracking, 16 Recommendations Submitted—Awaiting PO, and 10 Heads-up Received—Preparation Pending. Each request occupies one Atif bucket. Survey status is separate: pending recommendation can coexist with awaiting scheduling, scheduled, in progress, or completed/awaiting technical review.

Design sees 10 surveys in progress and 26 reported complete awaiting technical verification. Five nonstandard recommendations remain reported recommendations, with configuration/pricing unconfirmed; four heads-ups have no recommendation/findings. Sajid is the planning owner where his active Design account exists. Hassan and uncertain individual Operations assignments remain Unassigned. Regional responsibility is retained separately. Hamza Mir's account identity requires confirmation; Taha has no active account at import.

Operations sees heads-up forecasts, advance BOQs when sent, and later confirmed BOQs. Accounts sees IPOs awaiting acceptance and accepted IPOs pending Atif's confirmed BOQ release. Departments can open **UBL Site Workflow** from their sidebar; the original workspaces remain unchanged.

## Controlled progression

Survey/technical review → verified recommendation → recorded customer submission → awaiting PO. The optional branch is customer heads-up → Atif sends advance BOQ → Operations acknowledges preparation → still awaiting PO.

An advance BOQ is labelled **ADVANCE PREPARATION — PO NOT RECEIVED**. Purchasing, stock commitment, physical dispatch and installation retain their separately applicable authorization requirements. This module does not issue stock or dispatch materials.

Actual PO recording requires the original attachment, PO number/date, and reconciled verified configuration and price version. Atif prepares the IPO/PT using the assigned job number. Accounts accepts or returns it with remarks. Atif can issue the confirmed BOQ only after acceptance. Returned IPOs require Design re-verification before resubmission. The confirmed BOQ identifies changes from the advance version. One demand record changes from Provisional to Confirmed, preventing double counting.

Deferred/declined outcomes must be explicitly recorded, not inferred from PO absence. Missing source attachments retain the reported historical stage; they do not authorize a new controlled release. No imported survey is represented as an application verification or a customer submission action by staff.

## Pricing and documents

Standard matching recommendations use Final/Revised unless a documented exception is selected. Nonstandard recommendations remain unconfirmed. Original commercial history, accepted historical IPOs/PT allocations and issued financial records are never overwritten.

IPO panels remain nominal agreed capacity × the agreed rate, with the existing tax rules. Approved PT allocation proportions remain frozen; refreshed cost snapshots do not reallocate selling between phases. Current saved approved budgets accompany the internal record separately. Accounts, Administrator and Management retain full cost access. Other departments receive projected records without BESS costs or aggregate cost/markup amounts. IPO/PT PDFs contain selling amounts only, using the existing branded templates.

Each generated document carries a customer/site link, kind, immutable version, preparer and current timestamp. Imported intake and recommendation drafts are labelled **Prepared from imported data—verification pending**. Source documents, later attachments, generated versions and actual workflow events remain separate.

## Verification

Focused tests cover duplicate-safe import, canonical matching, held identity, source provenance, protected history and PT proportions, permissions/cost projection, both PO paths, partial site progression, deferred handling, changed PO rejection, Accounts return/re-verification, and provisional demand conversion. Browser verification covers import, search, action-adjacent validation, saved PDF download, refresh persistence and responsive layout.
