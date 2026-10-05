## Plan: GRC Evidence Collection Desktop App

An Electron desktop app that turns `800-53.json` into a navigable control catalog and layers an **evidence capture** workspace on top of it. Reference data stays strictly read-only; everything you author lives in a separate evidence record keyed by control/enhancement ID. Backend and AI are mocked behind a real HTTP shape (MSW) so they can be swapped for live services without touching UI code.

**Confirmed decisions**
- Electron shell, Vite + React 19 + TS renderer
- Remote API mocked (MSW + localStorage-backed store), swappable later
- Fake AI endpoint — deterministic heuristic evaluator, no real LLM
- Single flat evidence set (no multi-system scoping)
- Baseline filter toggles between **NIST 800-53B** `baselines[]` and **VA overlay** `va_baseline_allocation`

---

### Phase 1 — Scaffold
1. Vite React-TS renderer + `electron/main.ts` / `electron/preload.ts` (contextIsolation on), electron-builder config.
2. Deps: `@mui/material`, `@mui/icons-material`, `@mui/x-data-grid`, `@mui/x-date-pickers` (AdapterLuxon), `luxon`, `@tanstack/react-query`, `@tanstack/react-form`, `arktype`, `msw`, `react-router`.
3. MUI theme (light/dark), global `LocalizationProvider`, path aliases, ESLint/Prettier.
4. Relocate the catalog to `src/data/catalog/800-53.json`.

### Phase 2 — Domain layer *(depends on 1)*
5. `src/domain/catalog.types.ts` — ArkType schemas mirroring the JSON; validate once at boot and fail loudly.
6. `src/domain/evidence.types.ts` — the new editable record (schema below).
7. `src/domain/baseline.ts` — **critical**: `va_baseline_allocation` values are strings like `"AC-2 (1)(2)(3)(4)"` or `"Not Selected"`. Needs `parseVaAllocation()` to answer both *"is this control in baseline?"* and *"which enhancement numbers are selected?"*. Paired with `isControlInBaseline(control, baseline, mode)`.
8. `src/domain/catalogIndex.ts` — flatten families → `Map<controlId, ControlNode>`, build search index, resolve `related_controls` and `cross_reference_controls` into clickable links.

### Phase 3 — Mock API + query layer *(parallel with 4)*
9. MSW handlers: `GET/PUT /api/evidence`, `/api/evidence/:controlId`, `/api/attachments`, `/api/settings/prompt`, `POST /api/ai/evaluate`. In-memory store mirrored to `localStorage` so restarts keep data.
10. Fake AI: artificial latency + heuristic scoring against `assessment_objectives`, `evidence_required[].evidence_type`, and VA ODP values. Returns `{ score, verdict, strengths[], gaps[], objectiveCoverage[], suggestedRewrite, renderedPrompt }`.
11. Query hooks: `useEvidence`, `useSaveEvidence` (optimistic), `useAiEvaluate`, `usePromptTemplate`.

### Phase 4 — App shell & navigation *(organization is the priority here)*
12. **AppBar**: baseline selector (Low / Moderate / High / All), framework toggle (NIST | VA Overlay), `Ctrl+K` command palette (fuzzy over control ID, name, plain-English text), overall completion meter, dark mode, Settings.
13. **Left rail**: family list (AC…SR) with per-family chips `{inBaseline} • {complete}/{total}` and a progress bar. Secondary filters: evidence status, `control_type`, `priority_code`, `control_designation`, "has gaps", "not started".
14. Routes: `/dashboard`, `/family/:familyId`, `/control/:controlId`, `/gaps`, `/export`, `/settings`.
15. **Family view** = DataGrid — ID, name, type chips, baseline, priority, designation, evidence status, last reviewed, next review due, AI score. Column visibility, quick filter, bulk status edit, row click → detail.

### Phase 5 — Control detail: visual vs. editable separation *(depends on 2, 4)*
16. Two-pane layout.
    - **Left — reference, read-only, collapsible**: Plain English, Control Statement, Discussion, Assessment Objectives (as a checklist), ODP Parameters, VA Overlay block (implementation guidance, ODP values, VA-specific requirements, mapping notes, priority, designation), Related + Cross-Reference control chips, Required Evidence type list.
    - **Right — editable form** (TanStack Form + ArkType resolver): the evidence record.
17. Enhancements as a nested accordion; each in-baseline enhancement gets **its own evidence record** keyed `AC-2(1)`. Out-of-baseline enhancements collapsed/greyed behind a "show all" toggle.
18. Sticky footer: dirty indicator, debounced autosave (~1.5s), Save, Revert, Mark Complete.

### Phase 6 — Evidence capture *(depends on 5)*
19. Narrative fields with word/char counts and a per-field "Evaluate with AI" button.
20. **Artifacts sub-grid**: type, title, description, kind (`file | url | diagram | text`), collected date (X Date Picker + Luxon), collected by, and a mapping to which `evidence_required[]` entries it satisfies — this is what drives gap detection.
21. **File attachments** via Electron IPC: `dialog.showOpenDialog` → copy into `app.getPath('userData')/attachments` → store relative path + sha256 + size + mime. Thumbnails for images/PDF.
22. **Diagrams**: Mermaid source editor with live preview, plus image-upload alternative.
23. **Process descriptions**: repeatable ordered step list (actor, action, system, frequency, evidence ref).

### Phase 7 — AI assessor *(depends on 3, 6)*
24. `AiAssessorPanel`: input = selected narrative; context = control statement, discussion, assessment objectives, VA ODP values, required evidence types, current artifact inventory.
25. Output: verdict badge, per-objective coverage table, gap list, suggested rewrite with copy / replace-narrative actions. Evaluation history kept per control (timestamped via Luxon).
26. **Editable prompt template** in Settings: multiline editor, `{{variable}}` palette with live-rendered preview, save / duplicate / restore default, version history. Evaluations record which prompt version produced them.

### Phase 8 — Additions I'd recommend
27. **Dashboard**: status donut, coverage by family, controls overdue for review, controls with zero artifacts, AI score trend.
28. **Gap report** `/gaps`: every in-baseline control missing a narrative or an unmapped `evidence_required` type.
29. **Export/Import** `/export`: JSON backup, CSV, and a Markdown "SSP-lite" (narratives + artifact manifest). Import with merge-or-replace.
30. **Change log**: append-only per-control audit entries (`field, from, to, at, by`).
31. Keyboard shortcuts (`Ctrl+K`, `Ctrl+S`, J/K row nav), unsaved-changes route guard, error boundary, toasts.

---

### New evidence record (the fields missing from the JSON schema)

```
EvidenceRecord {
  controlId, isEnhancement, parentControlId?
  implementationStatus: not_started | planned | partially_implemented | implemented
                      | inherited | not_applicable | alternative_implementation
  applicability:  { inScope, naJustification? }
  origination:    common | hybrid | system_specific | inherited   // seeded from va_overlay.control_designation
  narrative:      { implementation, processDescription, whyCompliant, limitations }
  odpResponses:   [{ parameterId|parameter, value, source: 'nist'|'va' }]
  objectiveResponses: [{ objectiveIndex, met, note }]
  artifacts:      [{ id, evidenceType, title, description, kind, filePath?, url?, mermaid?,
                     body?, collectedAt, collectedBy, satisfiesEvidenceRequiredIndexes[] }]
  ownership:      { responsibleRole, owner, poc }
  dates:          { implementedOn, lastReviewedOn, nextReviewDue, evidenceAsOf }
  poam:           { hasFinding, findingId, severity, remediationPlan, dueDate }
  aiEvaluations:  [{ id, at, promptVersion, inputHash, score, verdict, strengths[],
                     gaps[], objectiveCoverage[], suggestedRewrite }]
  tags[]
  changeLog:      [{ at, field, from, to, by }]
  completeness:   derived 0–100
}
```

### Relevant files
- `800-53.json` → move to `src/data/catalog/800-53.json`, read-only source of truth
- `src/domain/baseline.ts` — the `va_baseline_allocation` string parser; highest-risk logic in the app
- `src/domain/evidence.types.ts` — ArkType schema above, shared by form validation and the mock API
- `src/mocks/handlers.ts` — the API contract that a real backend must later satisfy
- `electron/main.ts` — attachment file IPC + userData storage

### Verification
1. `npm run dev` launches Electron; catalog passes ArkType validation with zero errors.
2. Baseline = Low + NIST hides AC-4/AC-5/AC-6; switching to VA Overlay surfaces AC-19(5) at Low (VA exceeds the NIST allocation there — a good parser test).
3. Moderate + VA on AC-2 shows exactly enhancements (1)(2)(3)(4).
4. Type a narrative → autosave → restart the app → value persists.
5. AI evaluate returns structured output; editing the prompt template changes `renderedPrompt` in the response.
6. Attach a PNG → file lands in userData → thumbnail still renders after restart.
7. Export JSON → clear store → import → all records restored.

### Scope boundaries
**In:** catalog browse/filter, evidence capture (text/diagram/file/process), mock AI assessor with editable prompt, dashboard/gap/export, single flat evidence set, Electron packaging config.
**Out:** real backend, real LLM, auth, multi-user or multi-system scoping, OSCAL import/export, automated evidence collectors, full POA&M workflow.

### Further considerations
1. **Withdrawn / not_selected controls** — hide entirely, or show greyed with the "incorporated into X" pointer? *Recommend: hidden by default, revealed via a "show withdrawn" filter, since the cross-reference is useful context.*
2. **Enhancement evidence granularity** — separate record per enhancement (as planned) vs. one rolled-up record per base control. *Recommend separate; assessors evaluate enhancements individually.*
3. **Rich text vs. plain text narratives** — plain Markdown textarea keeps AI submission and export clean; a WYSIWYG adds weight. *Recommend Markdown with preview toggle.*


### Additional Guidance
1. Use file storage to load the 800-53.json files, and also use json format to store the text evidence in a proper structure that reflects the 800-53 control families, controls and enhancements.
2. If file are upload as evidence, rename the file using the control family, control, and enhancement if applicable along with a datetime stamp. Store their reference in the supplemental file.
3. We can use lexical editor as the text editor since it is able to load and save data in json format natively.
4. Enhancement controls may need to be addressed individually since they may need for detailed explanations.
5. If possible, implement the oscal json format to store all the information that we can - all other information that is not in the oscal schema, can we create a supplemental file
6. integrate some data insights using mui charts to help quickly assess compliance with the number of control that have been completed and those missing. Include any other visual reports that you think may be of value.
7. perhaps let's collect the last ATO date - perhaps we can use that to provide some inapp alerts that some piece of information any need updating - since an assessor may want to see current and prior year evidence