---
{
  "name": "Vinzons DigiPath",
  "description": "Desktop municipal document registration, custody and receipt workspace.",
  "colors": {
    "primary": "#0f4c75",
    "primary-light": "#1d5f99",
    "primary-dark": "#0b3554",
    "accent": "#0891b2",
    "action-primary": "#14547d",
    "action-primary-dark-theme": "#8accf2",
    "action-primary-dark-ink": "#102332",
    "background": "#f4f7fa",
    "surface": "#ffffff",
    "elevated": "#e7eef4",
    "text-main": "#172b3a",
    "text-secondary": "#475569",
    "text-muted": "#586b7e",
    "success": "#047857",
    "warning": "#92400e",
    "danger": "#b91c1c",
    "info": "#1d4ed8",
    "background-dark": "#101820",
    "surface-dark": "#1a2632",
    "elevated-dark": "#1a2536",
    "text-main-dark": "#e8eff5",
    "text-secondary-dark": "#b8c6d2",
    "text-muted-dark": "#94a3b8",
    "success-dark": "#91e4bf",
    "warning-dark": "#f9ce91",
    "danger-dark": "#fda4af",
    "info-dark": "#9bc5ff"
  },
  "typography": {
    "page-heading": {
      "fontFamily": "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
      "fontWeight": 800,
      "lineHeight": 1.1,
      "letterSpacing": "-0.035em"
    },
    "section-title": {
      "fontSize": "1rem",
      "fontWeight": 700
    },
    "dialog-title": {
      "fontSize": "1.125rem",
      "fontWeight": 700
    },
    "body": {
      "fontFamily": "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
      "fontSize": "1rem",
      "lineHeight": 1.6
    },
    "control": {
      "fontSize": "0.875rem"
    },
    "field-label": {
      "fontSize": "0.8125rem",
      "fontWeight": 600
    },
    "metadata": {
      "fontSize": "0.75rem"
    }
  },
  "rounded": {
    "sm": "0.375rem",
    "md": "0.5rem",
    "lg": "0.625rem",
    "xl": "0.875rem",
    "dialog": "1.25rem"
  },
  "spacing": {
    "control-gap": "0.5rem",
    "action-gap": "0.75rem",
    "group": "1rem",
    "section": "1.5rem",
    "page-inline": "2rem"
  },
  "components": {
    "button-primary": {
      "backgroundColor": "{colors.action-primary}",
      "textColor": "{colors.surface}",
      "rounded": "{rounded.md}",
      "padding": "0.75rem 1.5rem",
      "typography": "{typography.control}"
    },
    "button-primary-dark": {
      "backgroundColor": "{colors.action-primary-dark-theme}",
      "textColor": "{colors.action-primary-dark-ink}",
      "rounded": "{rounded.md}",
      "padding": "0.75rem 1.5rem",
      "typography": "{typography.control}"
    },
    "button-secondary": {
      "backgroundColor": "{colors.elevated}",
      "textColor": "{colors.text-main}",
      "rounded": "{rounded.md}",
      "padding": "0.75rem 1.5rem",
      "typography": "{typography.control}"
    },
    "button-success": {
      "backgroundColor": "{colors.success}",
      "textColor": "{colors.surface}",
      "rounded": "{rounded.md}",
      "typography": "{typography.control}"
    },
    "button-danger": {
      "backgroundColor": "{colors.danger}",
      "textColor": "{colors.surface}",
      "rounded": "{rounded.md}",
      "typography": "{typography.control}"
    },
    "input": {
      "backgroundColor": "{colors.surface}",
      "textColor": "{colors.text-main}",
      "rounded": "{rounded.md}",
      "padding": "0.65rem 1rem",
      "typography": "{typography.control}"
    },
    "card": {
      "rounded": "{rounded.md}",
      "padding": "1.5rem"
    }
  }
}
---

# Design System: Vinzons DigiPath

## Overview

This document records the existing desktop interface rather than proposing a new identity. DigiPath is an operational municipal records workspace: staff register documents, inspect custody, confirm deliveries and continue role-permitted work. Preserve the Vinzons identity, blue/teal palette, grouped sidebar, dense tables and light/dark themes.

**Key Characteristics:**

- Clear office, role and document context before an action.
- Familiar labeled controls and compact, readable records.
- Distinct custody, copy receipt and workflow states.
- Visible keyboard focus and recoverable forms.

The baseline is the local source at `d37da9d`, with the current consistency pass recorded in `CHANGELOG.md`. The stylesheet and components remain the implementation authority; this file describes their shared conventions and rules for touched/new screens. Desktop review sizes are 1366×768 and 1920×1080. Mobile development/testing is excluded by user direction; PDF-viewer changes are deferred. Existing print/PDF styles are separate from this desktop convention set.

Source entry points are [the stylesheet](dashboard/src/index.css), [PageShell](dashboard/src/components/PageShell.jsx), [Layout](dashboard/src/components/Layout.jsx), [ModalOverlay](dashboard/src/components/ModalOverlay.jsx), [DataSectionStatus](dashboard/src/components/DataSectionStatus.jsx) and [the queue predicates](dashboard/src/utils/documentQueue.js). The document uses the [DESIGN.md format](https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md); its JSON-form frontmatter is also valid YAML 1.2. The actual fluid heading expression is kept in prose/sidecar metadata because that format's primitive dimension fields accept fixed unit values.

## Colors

### Primary and accent

Use the primary family for navigation, links and document identity, and the teal accent for existing supporting treatments. Primary action buttons use the later solid action-color override, not the earlier gradient declaration or the base primary token. Their dark-theme variant uses a light background with dark ink. Keep the existing logo/sidebar gradients; their presence does not require gradients on new controls.

### Neutral

Use semantic surface, elevated, text and border variables. Dark mode is supplied by `[data-theme="dark"]`; use those variables rather than copying light-theme grays into dark surfaces. The frontmatter records the common light/dark color values. Inputs use `--input-bg`; cards use `--bg-card`, which are not interchangeable with every opaque surface.

### State

Success, warning, danger and information have semantic foreground/background pairs. Status badges additionally have dedicated theme-specific pairs for Received, In Transit, For Signing, For Filing, Signed, Completed and Archived. Preserve these existing badge overrides; a status color is not an action permission. Include a status word or icon, so color is never the sole cue. Filled success/danger buttons keep their darker background and white ink in both themes; the lighter dark-theme semantic foreground is for text, not a replacement filled-button background.

## Typography

Inter is the interface family, with the system fallback stack in the frontmatter. The root remains 16px; adapt desktop layout rather than shrinking all text to fit a viewport. Shared page headings use `clamp(1.75rem, 2.2vw, 2.2rem)`; section titles use the card-title role and dialog titles use the dialog-title role. Body text inherits the body line-height. Header descriptions are smaller than body text and use a 56ch maximum measure.

Controls use the shared control size; field labels and small buttons use the field-label size. Common hints, tracking references and status metadata use the metadata size. Compact Documents table headings, dates and badges explicitly use this metadata floor. Legacy local styles still contain additional sizes; this is a shared baseline, not a claim that every historical selector has been normalized. Use tabular numerals for record dates, identifiers and counts where the existing pattern does.

## Layout

`PageShell` separates the page header/toolbar from the scrolling body. Desktop navigation remains visible on the left. Its width is 280px by default, 250px at widths up to 1366px and 230px up to 1200px. Standard page headers have a 7.5rem minimum height and use the shared inline page spacing; Documents and Reception retain their scoped layout rules.

Desktop page bodies, modal bodies, table containers, the sidebar, notification lists and office staff lists expose thin themed scrollbars when content overflows. Keep the visible scroll affordance on these task containers; it makes long forms, wide tables and longer lists discoverable without relying on a mouse wheel.

Keep desktop Search, result counts and useful filters visible. Reports retain category, scope, coverage and date controls. Do not introduce a filter-disclosure flow merely to mimic a narrow-screen pattern. Compact records can wrap meaningful subjects and office names; retain an explicit Open details or record action when a row also responds to clicks.

Above 900px, registration metadata spans the full form and uses four columns, with destination controls spanning two. Source organization appears once within sender details; the municipal assigned office and delivery destination remain separate concepts. Registration modals have a 1120px maximum width and a 92vh maximum height; body content scrolls while the footer remains reachable.

Reserve desktop header space for the 46px notification bell. The default bell position derives from the header height and reanchors on desktop resize; optional custom dragging remains supported. Panels stay within the viewport and open above a bell near the bottom edge. Do not position new header actions or scanner status inside that reserved area.

The spacing entries are recurring values, not a separate token engine. Use the existing CSS variables and nearby component patterns instead of inventing another spacing system.

## Elevation & Depth

The incumbent uses pale or dark tonal layers, thin borders, modest shadows and limited backdrop blur. Standard cards have a border and translucent card surface; table containers have a low shadow; primary buttons add a small raised hover treatment. Dialogs use a stronger shadow over the modal overlay. These are observed legacy combinations, not a reason to add more nested cards, glows or blur during polish.

Reuse `--shadow-sm`, `--shadow-md` and `--shadow-lg`, including their dark-theme overrides. Focus outlines communicate keyboard position independently of decorative shadows. The sidecar records the shadow and motion values that do not fit the frontmatter schema.

## Shapes

Use the existing radius scale for controls, cards and table containers. Standard buttons, fields and cards use the medium radius; icon buttons use the small radius; table containers use the large radius. The general modal uses a larger dialog radius. Status chips and count badges retain their pill/circle shapes. Preserve these distinctions rather than applying one radius to every surface.

## Components

### Buttons and navigation

Use the existing primary, secondary, ghost, success, danger, small and icon button patterns. The main action names its outcome; secondary buttons cancel, return or support it. Header buttons have a 46px minimum height. Report action buttons retain their specialized variants. Icon-only actions require an accessible name matching their function.

Sidebar entries are native buttons with `aria-current="page"` on the active destination. Preserve normal click, Enter and Space activation. Shared focus uses a two-pixel semantic outline; navigation and contained rows use an inset offset where needed. Do not transition inherited visibility with `transition: all` on navigation items; the current navigation transitions only colors.

### Forms

Keep visible labels associated with their controls, hints and errors connected through `aria-describedby`, and invalid state limited to the affected fields. Mark required inputs consistently; placeholders supplement labels. Source organization is locked on edit because the existing save contract preserves the original source. Disabled/read-only state must explain such restrictions rather than offer an edit that is silently discarded.

Use the error-summary pattern for a failed form and the `focusFormError` helper after the rendered error becomes available. Preserve entered values and selected files when saving fails. Busy state disables repeated actions and uses the existing submission gate when asynchronous work can race. Office and document-type management now use this same inline-error/focus/busy-close pattern. Do not dismiss a form merely because a mutation started or confirmation was cancelled.

### Dialogs

Use `ModalOverlay` and `AppModal`, with a unique visible title connected to the shared dialog semantics. The top modal owns focus, contains Tab movement, makes background content inert, dismisses through the caller's permitted close path and returns focus to its trigger. A nested close or Escape affects only the top layer. Callers can refuse dismissal while a save is pending. Do not add a second dialog role inside the shared overlay.

### Records, queues and handoffs

Use the existing workflow and queue helpers for counts, next-action labels and filtered destinations. Available work includes role-permitted review, processing, sending, receipt, correction and eligible final-copy archiving. Completed workflow items are not Reception pending work. Keep tracking/waiting distinguishable from work the role can perform.

Sending uses one explicit custody office and independent optional copy recipients. Custody is serialized first. Receipt remains an explicit confirmation, not a status inferred from opening a record. For an uncertain send, preserve choices and provide the existing read-only status check; do not replay the mutation. Current uncertainty markers survive navigation within a signed-in page session, not reload/logout. A ready preview or confirmed scanner registration can continue through Open record to the existing detail/claim-slip path; do not label capture, persistence and physical sorting as the same outcome.

### Loading, empty and failure states

`DataSectionStatus` exposes independent section loading/failure and Retry without replacing usable sections with a global spinner. Dashboard action queues with incomplete required data show loading/unavailable feedback rather than claiming there is no work. On the first load, primary collection pages wait for a successful result before displaying an empty collection; cached rows remain usable with section status. After a successful load, [App's `hasLoaded` state](dashboard/src/App.jsx) keeps the page mounted during refresh/loading failure even when the last result was empty, preserving first-record drafts. Activity distinguishes loading/failure from no matching entries. A genuine empty collection and a filter with no matches need different explanations. Retry should identify the failed operation and keep valid context.

Reports keep category/scope/date controls visible but withhold result summaries and disable Preview, Print and Download until the required report collections are ready. [ReportsPage](dashboard/src/pages/ReportsPage.jsx) requires documents, transmissions and archives for every category, with these additional dependencies:

| Category | Additional collections |
| --- | --- |
| Summary, Documents | Offices, document types |
| Transmissions | Offices, users |
| Offices | Offices |
| Activity | Users, activity logs |

An unrelated category's loading/failure does not block the selected category. Changing filters does not make unavailable source data complete. This readiness rule concerns report data and export controls; it does not change the PDF viewer. These are the conventions for touched/new states; do not infer that an empty array alone proves a successful load.

## Do's and Don'ts

- **Do** reuse the existing semantic tokens, shared components and current stylesheet cascade.
- **Do** check light/dark desktop views, keyboard focus and long record names before calling a change finished.
- **Do** preserve typed data, selected destinations and the distinction between confirmed and uncertain outcomes.
- **Do** keep role permissions, custody, receipt, approval and FIFO rules in the existing workflow layer.
- **Don't** create another external-source field for the same saved value.
- **Don't** use a color or a missing count as proof of workflow state or permission.
- **Don't** change mobile behavior or the PDF viewer as part of this desktop consistency scope.
- **Don't** treat a local build, synthetic screenshot or design document as deployed or live staff acceptance.
