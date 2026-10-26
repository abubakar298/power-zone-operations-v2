# Design surveys

Design accounts open their survey workspace after login. They can upload physical survey forms (PDF, PNG or JPEG, 8 MB per file, up to 10), save incomplete drafts, and send completed technical requirements to an active Coordinator. The form uses the existing survey fields and engineering configuration rules. It does not ask for brands, costs or commercial settings.

Sending requires a physical survey attachment, completed technical fields and confirmation that the entered data matches the source. The transaction freezes a handoff snapshot and creates exactly one coordinator-owned survey/BOQ draft. Repeat sends return the existing handoff. Sent Design surveys cannot be edited or deleted. The coordinator sees the document in Survey preparation, with the designer, handoff timestamp, notes and original attachment filenames. The coordinator reviews the source, selects brands, calculates costing and uses the existing costing review workflow.

Design can see only its own surveys and attachments. Admin and Management can inspect the Design workspace. Design access to costing, master rates, commercial pricing, quotations, IPOs and downstream departments is rejected at the API boundary. Brand and pricing fields are rejected by the Design input schema. Shared survey attachments are granted to the assigned coordinator; changing the coordinator's draft does not rewrite the submitted Design survey.

Administrators create a Design login using Team access and the Design role. Password creation follows the existing administrator confirmation flow; email delivery is not required for direct account creation.
