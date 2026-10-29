-- Owner requested source-backed invoice submission corrections,30-Oct-2026.
-- Analytical source metadata only: no stock, receipt, invoice amount or journal posting.
DO $review$
DECLARE current_source accounts_source_registers%ROWTYPE; next_snapshot jsonb; reg jsonb; item jsonb; patch jsonb; regs jsonb:='[]'; items jsonb; actor uuid; matched integer:=0;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('accounts.source-register',0));
 SELECT * INTO current_source FROM accounts_source_registers ORDER BY version DESC LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 IF current_source.version<>2 THEN RAISE EXCEPTION 'Invoice review expects Accounts source v2; preserve newer source and re-review'; END IF;
 next_snapshot:=current_source.snapshot;
 FOR reg IN SELECT value FROM jsonb_array_elements(next_snapshot->'registers') LOOP
  items:='[]';
  FOR item IN SELECT value FROM jsonb_array_elements(reg->'rows') LOOP
   FOR patch IN SELECT value FROM jsonb_array_elements($payload$[{"key":"UBL:SOLAR:292","po":"POF262702135","stage":"completion","submitted":true,"date":"2026-10-26","source":"Accounts UBL Chint x 70 Sites!L45: 26 Oct 26"},{"key":"UBL:SOLAR:293","po":"POF262702137","stage":"completion","submitted":true,"date":"2026-10-26","source":"Accounts UBL Chint x 70 Sites!L46: 26 Oct 26"},{"key":"UBL:SOLAR:294","po":"POF262702166","stage":"completion","submitted":true,"date":"2026-10-26","source":"Accounts UBL Chint x 70 Sites!L47: 26 Oct 26"},{"key":"UBL:SOLAR:295","po":"POF262702167","stage":"completion","submitted":true,"date":"2026-10-26","source":"Accounts UBL Chint x 70 Sites!L48: 26 Oct 26"},{"key":"UBL:SOLAR:297","po":"POF262702457","stage":"completion","submitted":true,"date":"2026-10-26","source":"Accounts UBL Chint x 70 Sites!L50: 26 Oct 26"},{"key":"UBL:SOLAR:299","po":"POF262703984","stage":"completion","submitted":true,"date":"2026-10-27","source":"Accounts UBL Chint x 70 Sites!L52: 27 Oct 26"},{"key":"UBL:SOLAR:302","po":"POF262704014","stage":"completion","submitted":true,"date":"2026-10-26","source":"Accounts UBL Chint x 70 Sites!L55: 26 Oct 26"},{"key":"UBL:SOLAR:306","po":"POF262704052","stage":"completion","submitted":true,"date":"2026-10-26","source":"Accounts UBL Chint x 70 Sites!L59: 26 Oct 26"},{"key":"UBL:SOLAR:308","po":"POF262704067","stage":"completion","submitted":true,"date":"2026-10-28","source":"Accounts UBL Chint x 70 Sites!L61: 28 Oct 26"},{"key":"UBL:SOLAR:309","po":"POF262704077","stage":"completion","submitted":true,"date":"2026-10-28","source":"Accounts UBL Chint x 70 Sites!L62: 28 Oct 26"},{"key":"UBL:SOLAR:310","po":"POF262704078","stage":"completion","submitted":true,"date":"2026-10-27","source":"Accounts UBL Chint x 70 Sites!L63: 27 Oct 26"},{"key":"UBL:SOLAR:312","po":"POF262704194","stage":"completion","submitted":true,"date":"2026-10-27","source":"Accounts UBL Chint x 70 Sites!L65: 27 Oct 26"},{"key":"UBL:SOLAR:314","po":"POF262704199","stage":"completion","submitted":true,"date":"2026-10-28","source":"Accounts UBL Chint x 70 Sites!L67: 28 Oct 26"},{"key":"UBL:SOLAR:316","po":"POF262705046","stage":"completion","submitted":true,"date":"2026-10-28","source":"Accounts UBL Chint x 70 Sites!L69: 28 Oct 26"},{"key":"UBL:SOLAR:317","po":"POF262705047","stage":"completion","submitted":true,"date":"2026-10-28","source":"Accounts UBL Chint x 70 Sites!L70: 28 Oct 26"},{"key":"UBL:SOLAR:318","po":"POF262705048","stage":"completion","submitted":true,"date":"2026-10-28","source":"Accounts UBL Chint x 70 Sites!L71: 28 Oct 26"},{"key":"UBL:SOLAR:319","po":"POF262705049","stage":"completion","submitted":true,"date":"2026-10-28","source":"Accounts UBL Chint x 70 Sites!L72: 28 Oct 26"},{"key":"UBL:SOLAR:320","po":"POF262705050","stage":"completion","submitted":true,"date":"2026-10-28","source":"Accounts UBL Chint x 70 Sites!L73: 28 Oct 26"},{"key":"UBL:SOLAR:345","po":"POF262710526","stage":"advance","submitted":true,"date":"2026-10-28","source":"Accounts UBL Chint x 70 Sites!K75: Inv Summitted 28 Oct 26"},{"key":"UBL:SOLAR:346","po":"POF262710525","stage":"advance","submitted":true,"date":"2026-10-26","source":"Accounts UBL Chint x 70 Sites!K76: Inv Summitted 26 Oct 26"},{"key":"UBL:SOLAR:349","po":"POF262710527","stage":"advance","submitted":true,"date":"2026-10-28","source":"Accounts UBL Chint x 70 Sites!K79: Inv Summitted 28 Oct 26"},{"key":"MBL:CHP-338:60-site order:15/60","po":"1210037986","references":["27-20163"],"source":"Accounts MZN Chint x80+20+60 Site row19: document dispatched to Karachi 28-Oct-2026; bank submission unconfirmed."},{"key":"UBL:UPS:165/250","po":"POF262705356","references":["27-10620"],"source":"Accounts UBL Chint 6KW x250 row146: DC dispatched to Karachi 28-Oct-2026; bank submission unconfirmed."},{"key":"UBL:UPS:114/250","po":"POF252638916","references":["27-10125"],"source":"Accounts UBL Chint 6KW x250 row81: invoice submitted29-Jul-2026; payment received17-Aug-2026; existing paid flag retained."}]$payload$::jsonb) WHERE value->>'key'=item->>'key' LOOP
    IF item->>'po' IS DISTINCT FROM patch->>'po' THEN RAISE EXCEPTION 'Invoice review PO identity changed for %',item->>'key'; END IF;
    IF patch ? 'stage' THEN
     IF jsonb_typeof(item->(patch->>'stage'))<>'object' THEN RAISE EXCEPTION 'Invoice milestone missing for %',item->>'key'; END IF;
     item:=jsonb_set(item,ARRAY[patch->>'stage','submitted'],'true');
     item:=jsonb_set(item,ARRAY[patch->>'stage','submissionEvidence'],to_jsonb(patch->>'date'));
    END IF;
    IF patch ? 'references' THEN item:=jsonb_set(item,'{verifiedInvoiceReferences}',patch->'references'); END IF;
    item:=jsonb_set(item,'{sources}',COALESCE(item->'sources','[]')||jsonb_build_array(jsonb_build_object('name','Owner-authorized invoice reconciliation,30-Oct-2026','url','https://docs.google.com/spreadsheets/d/1bPz3JdEcdrIDYr1db65AEkiepeaRKUGJOx_dDxE3oWA/edit','evidence',patch->>'source')));
    matched:=matched+1;
   END LOOP;
   items:=items||jsonb_build_array(item);
  END LOOP;
  regs:=regs||jsonb_build_array(jsonb_set(reg,'{rows}',items));
 END LOOP;
 IF matched<>24 THEN RAISE EXCEPTION 'Invoice review matched % corrections, expected 24',matched; END IF;
 next_snapshot:=jsonb_set(next_snapshot,'{registers}',regs);
 next_snapshot:=jsonb_set(next_snapshot,'{manifest}',next_snapshot->'manifest'||jsonb_build_array(jsonb_build_object('name','Reviewed invoice-submission cell evidence,30-Oct-2026','sha256','faab279d41460e1036d80e8ee9edce5ec44a2db7bdea5cad93ec3afbcccba5ea')));
 SELECT id INTO actor FROM users WHERE active AND role='Accounts' ORDER BY display_name,id LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'Active Accounts owner required for invoice reconciliation audit'; END IF;
 INSERT INTO accounts_source_registers(id,version,source_sha256,source_date,snapshot,created_by) VALUES(gen_random_uuid(),3,encode(sha256(convert_to(next_snapshot::text,'UTF8')),'hex'),'2026-10-30',next_snapshot,actor);
 INSERT INTO audit_log(user_id,action) VALUES(actor,'accounts.source-register.invoice-reconciliation:3:owner-authorized-20261030');
END $review$;
