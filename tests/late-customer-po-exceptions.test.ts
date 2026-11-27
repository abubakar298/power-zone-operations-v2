import {test} from 'node:test';
import assert from 'node:assert/strict';
import {latePoAllowed} from '../server/project-workflow/late-customer-po.js';

test('received-later PO stays limited to email/WhatsApp approvals plus the one owner-approved site (UBL Kot Sarang, CHP-163 166/250)',()=>{
 const other='11111111-1111-4111-8111-111111111111',kotSarang='5aa91218-903a-45af-b382-652d4468f515';
 assert.equal(latePoAllowed('Email approval',other),true);
 assert.equal(latePoAllowed('WhatsApp approval',other),true);
 for(const type of ['Customer PO','Written approval','Verbal sale confirmation',null])assert.equal(latePoAllowed(type,other),false);
 assert.equal(latePoAllowed('Customer PO',kotSarang),true);
});
