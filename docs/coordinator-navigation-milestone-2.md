# Coordinator navigation — Product milestone 2

Six primary destinations: My Workspace, Projects, New BOQ, Documents, Customers & Sites, Rate Master. Account menu/global notifications remain; other roles keep existing navigation.

Projects/Documents reuse owner-authorized survey-draft, BOQ, quotation, C&I and IPO lists, with search and customer/site/type filters. Reference selectors include existing masters before their first document. No new permissions, calculations, database writes, migrations or PDF changes.

Project actions retain Surveys & BOQs, Quotations, IPOs and BOQs to Operations. Saved records open existing screens; pending tasks continue their current workflow. New BOQ opens the existing form directly. Search/customer/site filters and Workspace stage/overdue filters survive opening/returning from a workflow. Back returns to the originating list. Existing notification deep-link handler remains.

Customers & Sites scopes existing Master Data to two tabs. Rate Master starts on Rates and retains Items & specifications, Brands and Engineering rules as supporting tabs. Server edit permissions unchanged.

Verification: application typecheck PASS; server compilation PASS; Vite production build PASS. Focused local built-browser fixture check PASS: six destinations; four existing module entry points; customer/site and stage retention; scoped master tabs; direct New BOQ; mobile menu; no runtime errors or unexpected API requests. Run `node scripts/coordinator-navigation-check.mjs` against local Vite preview on 127.0.0.1:5178. No full regression suites rerun.

Limits: existing endpoint limits apply (latest 200 saved records per list, latest C&I versions, latest 100 drafts), not an unlimited archive. IPO sites rely on an accessible quotation reference; unavailable sites labeled. Project actions open existing lists; a specific document supplies exact project context. Existing transition and unsaved-form behavior unchanged. Library pagination/project-detail refinements remain later scope.

The retained Workspace refreshes immediately when reopened, preserving filters while showing newly saved/submitted work. Library filter labels are distinct from BOQ customer fields. Existing browser tests follow the role-specific sidebar through a shared navigation helper; business and security assertions remain intact. The first candidate inherited three failing legacy sidebar selectors from the deployed baseline; these are corrected before final release.

Focused native-PostgreSQL browser verification: auth.spec.ts 8/8 PASS (1.1 minutes). Includes setup/session/restart/mobile; Management bucket; Coordinator external approval/BESS privacy; department queues; full Atif quotation→IPO→Operations; quotation discount revision; Design survey intake; encrypted backup download. Disposable test database only. These checks cover the failed legacy cases without changing their business/security assertions.
