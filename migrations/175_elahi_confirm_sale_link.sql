-- Repair the untouched adoption for Elahi Energy, Faisalabad. Both quotations
-- and the original workflow event remain in history.
DO $$
DECLARE
  workflow project_workflow_records%ROWTYPE;
  old_quote constant uuid := 'ed4b8b31-03ed-4b9a-b92d-2edae381fd50';
  accepted_quote constant uuid := '845dc02c-f726-412a-9776-3ca80363bb37';
  accepted_revision uuid;
  accepted_draft uuid;
  repair_actor uuid;
  next_data jsonb;
BEGIN
  SELECT * INTO workflow FROM project_workflow_records
  WHERE id = 'f768048c-110e-4609-9c23-6e533e2820db' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF workflow.customer_id <> 158 OR workflow.site_id IS DISTINCT FROM 134
     OR workflow.route <> 'quick-quote' OR workflow.stage <> 'design_handed_off'
     OR workflow.version <> 1
     OR workflow.data->>'linkedBoqRevisionId' IS DISTINCT FROM '5a36e835-a930-472b-ad3f-90531fe114e0'
     OR workflow.data->>'draftId' IS DISTINCT FROM '003090ee-b41f-4603-bc43-8c6c851c8877'
     OR workflow.data - ARRAY['notes', 'draftId', 'linkedBoqRevisionId'] <> '{}'::jsonb
     OR NOT EXISTS (SELECT 1 FROM project_workflow_events WHERE record_id = workflow.id
       AND version = 1 AND action = 'Adopted existing workflow')
     OR EXISTS (SELECT 1 FROM project_po_receipts WHERE record_id = workflow.id)
     OR EXISTS (SELECT 1 FROM project_workflow_issuances WHERE record_id = workflow.id)
     OR EXISTS (SELECT 1 FROM project_workflow_documents WHERE record_id = workflow.id)
     OR EXISTS (SELECT 1 FROM project_workflow_files WHERE record_id = workflow.id)
     OR EXISTS (SELECT 1 FROM active_headsup_received_sites WHERE record_id = workflow.id)
     OR EXISTS (SELECT 1 FROM project_advance_planning WHERE record_id = workflow.id)
     OR NOT EXISTS (SELECT 1 FROM quotation_versions WHERE id = old_quote
       AND boq_revision_id::text = workflow.data->>'linkedBoqRevisionId')
     OR EXISTS (SELECT 1 FROM customer_purchase_orders WHERE quotation_id IN (old_quote, accepted_quote)
       OR boq_revision_id IN (SELECT boq_revision_id FROM quotation_versions WHERE id IN (old_quote, accepted_quote)))
     OR EXISTS (SELECT 1 FROM ipo_submissions WHERE input->>'quotationId' IN (old_quote::text, accepted_quote::text))
     OR EXISTS (SELECT 1 FROM internal_purchase_orders WHERE snapshot->>'quotationId' IN (old_quote::text, accepted_quote::text))
  THEN
    RAISE NOTICE 'Elahi quotation repair skipped because the original workflow or order links changed';
    RETURN;
  END IF;

  SELECT q.boq_revision_id, f.draft_id INTO accepted_revision, accepted_draft
  FROM quotation_versions q
  JOIN boq_revisions br ON br.id = q.boq_revision_id
  JOIN boqs b ON b.id = br.boq_id
  JOIN boq_draft_finalizations f ON f.revision_id = br.id
  JOIN survey_drafts draft ON draft.id = f.draft_id
  WHERE q.id = accepted_quote AND b.customer_id = workflow.customer_id
    AND b.site_id = workflow.site_id AND draft.owner_id = workflow.coordinator_id
    AND (SELECT kind FROM coordination_events WHERE quotation_id = q.id
      ORDER BY created_at DESC, id DESC LIMIT 1) = 'Approved'
    AND EXISTS (SELECT 1 FROM quotation_dispatch_records WHERE quotation_id = q.id)
    AND NOT EXISTS (SELECT 1 FROM quotation_archives_current WHERE quotation_id = q.id AND archived)
    AND NOT EXISTS (SELECT 1 FROM quotation_versions newer
      JOIN boq_revisions revision ON revision.id = newer.boq_revision_id
      WHERE revision.boq_id = br.boq_id AND newer.id <> q.id
        AND (newer.created_at, newer.version) >= (q.created_at, q.version));
  SELECT id INTO repair_actor FROM users WHERE active AND role = 'Admin' ORDER BY created_at, id LIMIT 1;
  IF accepted_revision IS NULL OR repair_actor IS NULL THEN
    RAISE NOTICE 'Elahi quotation repair skipped because the approved quotation or audit actor could not be verified';
    RETURN;
  END IF;

  next_data := workflow.data || jsonb_build_object(
    'draftId', accepted_draft, 'linkedBoqRevisionId', accepted_revision,
    'latestQuotationId', accepted_quote
  );
  UPDATE project_workflow_records SET data = next_data, version = workflow.version + 1, updated_at = now()
  WHERE id = workflow.id;
  INSERT INTO project_workflow_events(id, record_id, version, action, snapshot, request_key, input_fingerprint, created_by)
  VALUES (gen_random_uuid(), workflow.id, workflow.version + 1, 'Corrected adopted quotation link',
    jsonb_build_object('stage', workflow.stage, 'data', next_data, 'previousQuotationId', old_quote,
      'reason', 'Management confirmed the approved November quotation as the customer-accepted version.'),
    gen_random_uuid(), md5(next_data::text), repair_actor);

  IF NOT EXISTS (SELECT 1 FROM quotation_archives_current WHERE quotation_id = old_quote AND archived) THEN
    INSERT INTO quotation_archive_events(id, quotation_id, archived, created_by)
    VALUES (gen_random_uuid(), old_quote, true, repair_actor);
    INSERT INTO audit_log(user_id, action)
    SELECT repair_actor, 'quotation.' || number || '.archived' FROM quotation_versions WHERE id = old_quote;
  END IF;
END $$;
