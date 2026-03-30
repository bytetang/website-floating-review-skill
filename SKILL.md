---
name: review-mode
description: Add or upgrade a UI Review Mode workflow that supports click-to-comment, element pending markers, pending list/detail panel, resolve actions, translucent icon-only toolbar controls, ZIP export, and optional Notion sync. Use when users ask for website review tooling, pending comment visibility, unlocated item navigation, review panel interaction design, glass toolbar iconization, html2canvas capture, JSZip report export, or cross-agent review-mode implementation guidance.
---

# Review Mode

Implement or update client-side review tooling so reviewers can click elements, leave comments, visualize pending review locations, resolve comments, and export or sync review artifacts.

## Agent Compatibility

This skill is written to be portable across Claude Code, Codex, and OpenClaw-style coding agents.

- Keep the implementation guidance framework-agnostic and browser-runtime-specific.
- Prefer patching existing project files when the host supports file editing.
- If the host cannot access bundled skill assets directly, inline the needed code from the referenced scripts instead of assuming asset injection.
- If the host supports agent-specific manifests, treat this `SKILL.md` as the source of truth and keep any platform manifest limited to discovery metadata.
- Do not rely on agent-specific tools, secret storage conventions, or UI affordances unless the user explicitly asks for a host-specific integration.

## Core Behavior Contract

Implement the following behavior unless the user explicitly asks to change it.

1. Review interaction lock:
- Enable capture-phase interaction lock while review mode is on.
- Exempt review controls by attribute marker and container checks.
- Keep toolbar and panel controls fully interactive.

2. Toolbar visual and control model:
- Render toolbar with translucent glass styling (semi-transparent background plus blur fallback support).
- Use icon-only action buttons with `title` and `aria-label` for accessibility.
- Keep live-state icon feedback for review capture states (idle/live/capturing).

3. Comment creation:
- Capture click target element.
- Open comment dialog.
- Save comment only after screenshot capture pipeline succeeds.

4. Pending model:
- Treat pending as comments without `resolvedAt`.
- Keep resolved comments in log history but exclude from pending UI/counts/actions.

5. Marker behavior:
- Render marker overlay only in review mode.
- Use element outline plus dot marker (no numeric badge when single-comment policy applies).
- Keep marker and panel visibility scoped to current view/screen.

6. Pending panel behavior:
- Open panel from the Unlocated/Pending button.
- Default to list view.
- Open detail view when list item is clicked.
- Show three compact header icon buttons in detail view:
  - back: `<-`
  - resolved: `✓`
  - close: `x`
- Return to list when back is clicked.
- Mark comment resolved when resolved icon is clicked.
- Auto-return to list and refresh list after resolve.

7. Unlocated handling:
- Compute unlocated items by comparing pending selectors against resolved marker selectors in current view.
- Keep cross-view items visible in navigation surfaces when needed.

8. Export/sync gating:
- Enable export and push actions only when pending count > 0.
- Export and push unresolved comments only.

## Workflow

1. Confirm assumptions:
- `html2canvas` is available in client runtime.
- `JSZip` is available in client runtime.
- Review capture happens in browser runtime (not Node-only).

2. Implement review mode interaction model:
- Block underlying page actions while review mode is enabled (`click`, `pointerdown`, `touchstart`, `wheel`, `dragstart`, `drop`, `selectstart` in capture phase).
- Exempt review controls (toolbar, dialogs, panel buttons) so they remain interactive.
- Support draggable toolbar with viewport clamping.
- Style toolbar as a translucent glass layer and add both `backdrop-filter` and `-webkit-backdrop-filter` for cross-browser blur behavior.
- Use icon-only toolbar actions and preserve accessibility text via `title`, `aria-label`, and optional screen-reader-only labels.

3. Implement data capture:
- Intercept clicks in review mode (`capture` phase recommended).
- Ignore review control clicks (toolbar/dialog/export buttons) and ignore synthetic clicks (`event.isTrusted === false`) to avoid false prompts during programmatic downloads.
- Capture element screenshot with a resilient pipeline:
- sanitize computed styles before capture,
- retry with `foreignObjectRendering` on unsupported color function errors (`oklab`/`color-mix`),
- detect fully transparent captures and fallback to text-canvas rendering for text-only elements.
- Store each record in `feedbackLog` with:
- timestamp
- comment text
- element metadata (`tag`, `id`, `class`, selector path, text snippet)
- `viewKey`
- optional `resolvedAt`
- screenshot data URL and deterministic filename

4. Implement pending derivations:
- Build `pendingFeedbackLog = feedbackLog.filter(item => !item.resolvedAt)`.
- Build current-view pending list from `viewKey` (with legacy view inference fallback if needed).
- Group pending by selector for marker overlays.
- Keep panel detail selection by comment id, not only by selector, so list/detail transitions are stable.

5. Implement pending panel list/detail UX:
- Open panel via toolbar button.
- Render list view from current-view pending items.
- Enter detail view when one list item is selected.
- Keep back/resolve/close icons in header.
- On resolve:
- update `resolvedAt`
- clear detail selection
- keep panel open on list view with refreshed items

6. Implement export:
- Build `screenshots/` and `REPORT.md` in memory with `JSZip`.
- Convert data URLs to binary and write each image file with per-item validation.
- Write markdown sections per unresolved feedback item and reference `screenshots/<file>.png`.
- Trigger `.zip` download with a timestamped filename.
- Delay `URL.revokeObjectURL` cleanup so browser download is reliable.

7. Implement Notion sync (optional full version):
- Keep Notion credentials server-side only (never expose API keys in browser code).
- Add a backend route (for example `POST /api/review/notion`) that:
- creates a Notion page under `NOTION_PARENT_PAGE_ID`,
- uploads each screenshot via Notion file-upload API,
- appends report blocks and image blocks to the page.
- Add client helper that POSTs report payload to your backend route (no secret keys in client).
- Support parent page ID normalization from URL/slug/32-hex/dashed UUID formats.
- Return `pageUrl` so UI can confirm sync success.

## Output Contract

Return or patch JavaScript containing:
- data capture logic (`onReviewClick`, log shape, selector helpers)
- pending derivation logic (`pendingFeedbackLog`, grouped selectors, list/detail state)
- resolve actions (`resolvePendingComment`, optional per-selector resolve)
- list/detail pending panel interactions (open list, open detail, back, resolve, close)
- marker rendering with dot badge and hover affordances
- ZIP export logic using unresolved items only
- helper conversion function (`dataUrlToUint8Array`)
- optional Notion sync helper that calls backend API only

Keep functions framework-agnostic unless user asks for React/Vue wrappers.
When the host cannot patch files directly, return a complete drop-in JavaScript snippet plus any required integration notes.

## Script

If reusable code is needed, use:
- `scripts/review_mode_capture_export.js`
- `scripts/review_mode_notion_sync_server_template.mjs`

If the current agent runtime does not expose bundled skill files automatically, read these files manually and adapt their contents into the target project.

## Security Notes

- Never hardcode tokens, secrets, workspace IDs, or database keys in skill output.
- Use environment variables (`NOTION_API_KEY`, `NOTION_PARENT_PAGE_ID`, etc.) and server-side access only.
- If user asks to place secret directly in frontend, refuse and provide secure alternative.

## Acceptance Checklist

Before completing work with this skill, verify:

- Review mode blocks page actions but not review controls.
- Toolbar is visibly translucent (glass-like) and icon-only controls remain discoverable via hover title/accessibility labels.
- Clicking an element creates exactly one pending comment item under the single-comment policy.
- Marker appears as dot indicator and opens pending context.
- Unlocated/Pending button opens panel list.
- Clicking a list item opens detail view.
- Detail header shows `<-`, `✓`, `x` controls with expected behavior.
- Resolve action marks item resolved, returns to list, and refreshes counts/items.
- Export and push process unresolved items only.
