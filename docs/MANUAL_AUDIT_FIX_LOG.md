# Manual audit fix log

Record new findings only in this file. Keep them open until implementation is explicitly requested.

Add each finding as it comes up during the manual audit. Record the workflow, observed behavior, expected behavior, and a retest. Mark a fix verified once the retest passes on the system under audit.

## 1. Internal sends to the Mayor lack a requested action

**Status** — Open. Confirmed in source. Manual reproduction pending.

**Observed behavior** — When Engineering sends a document to the Mayor’s Office without selecting a document type, the server assigns `DT-INTERNAL`. The destination alone does not tell DigiPath whether the document is for information or requires a signature. [Registration logic](../backend/routes/documents.js#L321)

**Proposed fix** — For internal sends to the Mayor’s Office, require a requested action at registration. Start with **For information** and **Signature required**. Add **Approval required** if approval without a signature is a distinct municipal outcome. Save the choice on the document and enforce it before onward routing or completion.

**Retest** — Send two documents from Engineering to the Mayor’s Office. After receipt, the informational document can proceed through the normal workflow. The signature request stays blocked from onward routing and completion until the Mayor’s signature is recorded, subject to any remaining receipt requirements.

## 2. Dashboard records open through a redundant preview

**Status** — Open. Reported during the manual audit with screenshots.

**Observed behavior** — Selecting a record under **Needs your action** opens a preview with the status, sender, attachments, and timeline. Clicking **Open record** then opens another view that repeats those details and adds the action buttons.

**Requested fix** — Remove the intermediate preview from record-opening paths on every account dashboard. Open the full record directly from the dashboard item, with its details, attachments, timeline, and actions available according to the account’s permissions.

**Retest** — In each account role, open a visible record from **Needs your action** and any other dashboard list that uses the same preview. Confirm that one click opens the correct full record and that the available actions match the account’s permissions.

## 3. Dashboard header action sits below the notification bell

**Status** — Open. The earlier dashboard code change was reversed in the local working tree.

**Observed behavior** — On the Receptionist Dashboard, Register sat lower than the notification bell.

**Requested fix** — Align Register with the notification bell. Check Admin, Mayor, and Office dashboards for the same offset. Preserve narrow-screen stacking.

**Retest** — With the bell at its default position, check Receptionist, Admin, Mayor, and Office dashboards. On desktop, the header actions should sit centered alongside the bell. At narrow widths, check that the controls stack and remain usable.

## 4. Mayor’s Archives button opens an empty document picker

**Status** — Open. Screenshots show an empty picker and a disabled submit button. The reason the list was empty in that session is unverified.

**Current behavior** — The Mayor and Admin roles can archive eligible documents. Archiving requires recorded completion, required receipts, no outstanding handoffs, and a readable attachment. The Archives page offers a separate picker, while the document record also offers an archive action when eligible. [Archive workflow](../backend/utils/archiveWorkflow.js#L33)

**Requested fix** — Review whether the Mayor needs the separate Archives-page shortcut. If archiving from the eligible document record covers the Mayor’s workflow, remove the duplicate shortcut and its dialog for that role. If staff use the shortcut, show an actionable empty state when there are no eligible documents. Verify whether the empty picker reflects eligibility or incomplete data loading.

**Retest** — Check the Mayor’s Archives page with zero eligible documents and with a completed document that has the required receipts and a readable attachment. Confirm the Mayor can browse existing archives and use the intended archive action for eligible records. Confirm incomplete documents still cannot be archived.

## 5. Receive action disappears and shifts the view icon

**Status** — Open. Reported during the manual audit with screenshots.

**Observed behavior** — In **My Documents**, the user reports that after confirming receipt, the **Receive** button disappears and the remaining eye icon shifts horizontally. Rows with and without the receipt action show the view icon in different positions.

**Requested fix** — After a successful receipt for the signed-in office, replace **Receive** in the same space with a muted, non-interactive **Received** label. Keep the eye icon aligned and usable. Use the text to communicate the receipt even without color.

**Retest** — Compare rows before and after a successful receipt. Confirm that **Received** stays in the same slot after refreshing, the view icon stays aligned and opens the record, and a cancelled or failed receipt leaves **Receive** available. Apply the label only where that office has a confirmed receipt.

## Audit and repair sequence — 2026-11-27

Reviewed the five open findings against the working tree on main at 8551223 and the supplied screenshots. The local reversal of the header change is part of the reviewed state. Assume staff in multiple offices can act on the same document. Runtime acceptance remains pending.

1. **Must fix — Mayor action intent (item 1).** The gap is confirmed, with a correction to the default-type explanation. The server uses DT-INTERNAL only when an Office request omits the type. The document form initializes the first configured type or DT-001 and includes its form data on save. Neither default expresses why Engineering sent this particular document. Record the requested action on new internal sends to the Mayor. Validate it on the server and apply the stricter of the document-type policy and the requested action at signing, onward routing and completion. Keep receipt independent. Preserve historical records with unknown intent and confirm the approval-only policy before offering that choice. Test information and signature requests through the form and API, including a type that already requires signing. [Form default](../dashboard/src/pages/DocumentList.jsx#L96) · [Server fallback](../backend/routes/documents.js#L321)
2. **Should fix — Direct dashboard navigation (item 2).** The shared staff dashboard explicitly opens a preview, whose Open record button calls the existing full-record handler. Reception already calls that handler directly. Wire the affected dashboard record links to the existing handler using the document ID. Keep status filters, attachment previews and office access rules intact. Test mouse and keyboard opening from the action queue, priority list and transfer rows for each applicable role. Check that the same record opens once and that closing it leaves focus somewhere usable. [Staff dashboard](../dashboard/src/pages/DashboardHome.jsx#L149) · [Reception](../dashboard/src/pages/ReceptionistDashboard.jsx#L137) · [Record navigation](../dashboard/src/App.jsx#L451)
3. **Should fix — Receipt feedback (item 5).** The table renders Receive only for a pending transmission. The centered action group recenters the eye when Receive disappears. Give the view icon a stable position and render Received in the adjacent space only after a confirmed receipt for this office and delivery. Keep the existing confirmation and retry flow. Test another office’s receipt, a later delivery of the same document, a failed save and a refresh. Verify the success message is available to screen-reader users and the eye remains keyboard accessible. [Table controls](../dashboard/src/pages/DocumentList.jsx#L1235)
4. **Should fix — Empty Mayor archive picker (item 4).** The page opens the form unconditionally and populates the selector from eligible documents. An empty selector is confirmed as a possible outcome. The screenshot cannot establish why the list was empty. First test loaded-empty, loading, failed-load and one-eligible-record cases. Verify the eligible record action completes the same archive operation with the intended date and attribution. If it covers the Mayor’s workflow, remove only the Mayor’s redundant shortcut. Otherwise expose loading, retry or a plain empty-state message as appropriate. Preserve server eligibility checks and archive browsing. [Picker and shortcut](../dashboard/src/pages/ArchiveList.jsx#L299) · [Archive checks](../backend/utils/archiveWorkflow.js#L37)
5. **Should fix — Header alignment (item 3).** Reception has a specific downward offset of 1.15rem in the working tree. The shared staff header has bottom alignment, but the same visual defect in other roles remains unverified. Compare the default bell and action-button centers at the reported desktop size, with wrapped heading text, and at the narrow breakpoint. Remove the Reception offset and adjust shared alignment only where the measurements show a mismatch. Retest a moved bell and narrow-screen stacking. [Reception offset](../dashboard/src/index.css#L8291)

**Acceptance** — Implement each item as a separately reviewable change. Use synthetic records for workflow tests, run the dashboard suite and production build, then repeat the manual retests above on the target build. Record the tested role, result and build before closing each item. This audit changed only the note.

**Implementation update, 2026-11-27** — Items 1–5 are implemented locally on main at base 8551223. The disposable database suite passed the Engineering-equivalent Office and Mayor scenarios for information and signature requests. All 113 backend tests, 123 dashboard tests and the production build passed. The five items remain open for the role-specific manual retests above. Approval without a signature remains a policy question.
