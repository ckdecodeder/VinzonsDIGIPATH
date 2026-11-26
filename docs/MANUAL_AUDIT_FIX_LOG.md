# Manual audit fix log

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

**Status** — Fixed locally. Browser retest pending.

**Observed behavior** — On the Receptionist Dashboard, Register sat lower than the notification bell.

**Fix** — Centered header actions vertically in the Receptionist Dashboard and the shared staff dashboard used by Admin, Mayor, and Office accounts. Removed the extra Receptionist offset and retained stacked controls on narrow screens.

**Retest** — With the bell at its default position, check Receptionist, Admin, Mayor, and Office dashboards. On desktop, the header actions should sit centered alongside the bell. At narrow widths, check that the controls stack and remain usable.
