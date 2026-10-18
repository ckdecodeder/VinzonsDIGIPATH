# Chapter 4 Workflow Alignment Design

## Goal

Align DigiPath's outgoing approval, office handoff, receipt, and tracking behavior with Chapter 4's proposed sending and receiving flows while preserving the municipality's document-specific routing practices.

## Source requirements

- Chapter 4, page 6: register the outgoing document; determine whether Mayor approval is required; route directly when it is not; when required, review and approve or reject before routing; rejected documents return for revision.
- Chapter 4, page 5: receive and scan paper documents at reception when needed; log receipt at each receiving office; repeat the handoff and receipt for each next office; archive when routing is complete.
- Chapter 4, pages 8-9: record document identity, source, destination, routing, current location/status, signatory or approval information, movement, date/time, and archive category.
- Chapter 4, page 13: exact Mayor involvement and routing rules still require validation with the Mayor's Office.

## Current implementation

DigiPath already has document-type approval flags, route and send-history fields, office send/receive endpoints, scan/intake records, timelines, and archiving. The work should close specific gaps in these existing paths rather than replace them.

The document send endpoint currently checks that intake is approved, but does not itself enforce the document type's `requiresMayorApproval` gate. The separate transmission endpoint keeps a document in transit until the destination office receives it, while the document send endpoint immediately changes the document's current office to the first destination and places remaining destinations in a send queue. These two paths can therefore present different custody and receipt states.

## Proposed behavior

1. **Outgoing registration and approval gate**
   - Keep the approval requirement configurable by document type.
   - Documents that do not require Mayor approval may proceed to routing once registered and otherwise eligible.
- Documents that require Mayor approval may be sent to the Mayor's Office for review, but cannot be routed onward to another office until an authorized approval action records approval.
   - Rejection records the decision and reason and returns the document to a revision state before it can be routed again.

2. **Consistent office handoffs**
   - A sent handoff records its source office, destination office, sender, and send time.
   - The document remains in transit until the destination office records receipt, including receiver and receipt time.
   - For multi-office routes, each office-to-office movement has its own send and receipt record before the next handoff is considered complete.
   - Keep direct, Mayor-related, and sequential multi-office routes available; do not impose Mayor routing on every document.

3. **Tracking and completion**
   - Show the current workflow step and office based on recorded events.
   - Preserve an auditable history of registration, approval/rejection, send, receipt, forwarding, and archive actions.
   - Archive after the applicable route is complete, following existing authorization rules.

4. **Signing boundary**
   - Record who is responsible for approval/signing and the resulting decision or status.
   - Do not add cryptographic or legally operative e-signature behavior as part of this change. Chapter 4's proposed sending prose describes signing in the digital system, while its information requirements say DigiPath records and monitors approval/signature information without replacing the actual approval/signature process. The paper also says the exact rules need further validation.

## Scope limits and assumptions

- Preserve current user roles and authorization rules except where required to enforce the configured approval gate; do not broaden who may approve or sign without an explicit policy basis.
- Do not set one universal route for all document types or municipal offices.
- Do not introduce new approval categories, digital-signature technology, new document statuses, or unrelated interface redesign.
- Treat the configured document-type approval flag as the source of whether the Mayor gate applies, pending policy validation noted in Chapter 4.
- Treat a handoff to the Mayor's Office as the approval step, not as onward routing; all other handoffs for a required document stay blocked until approval is recorded.
- Do not commit, push, or deploy during local implementation and review.
- After each completed feature, provide a step-by-step guide showing where to find it, how to try it, and what result to expect.

## Acceptance criteria

- A document type configured to require Mayor approval cannot be sent onward before approval is recorded.
- A document type configured not to require Mayor approval is not blocked by that gate.
- Rejected documents cannot be routed onward until they return through the revision and approval path.
- Each handoff has a consistent in-transit state followed by destination-office receipt, with sender/receiver and timestamps visible in the history.
- Sequential routes record each office receipt before the next office handoff is treated as complete.
- Direct, Mayor-related, and multi-office routing remain supported.
- The system records approval/signing state without implementing cryptographic signature functionality.
- Local preview and data-changing workflow checks use a local test database, not the Dev Tunnel backend.

## Open policy validation

Before treating the workflow as final municipal policy, confirm with the Mayor's Office which document types require approval, how an authorized alternate signatory is represented, and whether the proposed digital-system signing language means a recorded sign-off or an actual electronic signature. This implementation follows the non-replacement requirement in Chapter 4's information requirements until that conflict is resolved.

## Adviser feedback for later work

These items were requested by the adviser and should be considered after the Chapter 4 workflow alignment. They are recorded here but are not part of the current implementation scope:

1. Add filters to the activity log and its reports.
2. Add more report filter types based on available database fields.
3. Add a folder type/category for archives.

The Chapter 4 sending, receiving, routing, and tracking flow remains the top priority.
