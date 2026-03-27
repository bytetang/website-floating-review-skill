---
name: review-mode
description: Add or upgrade a UI Review Mode workflow that captures element-specific screenshots and reviewer comments, then exports a ZIP package with REPORT.md and images. Use when users ask for click-to-comment review tooling, DOM element feedback capture, html2canvas integration, JSZip report export, or AI-assisted UI review artifact generation.
---

# Review Mode

Implement or update client-side review tooling so reviewers can click an element, add a comment, capture only that element as an image, and export a portable ZIP report.

## Workflow

1. Confirm assumptions:
- `html2canvas` is globally available.
- `JSZip` is globally available.
- Review capture happens in browser runtime (not Node-only).

2. Implement Review Mode interaction model:
- Block underlying page actions while Review Mode is enabled (`click`, `pointerdown`, `touchstart`, `wheel`, `dragstart`, `drop`, `selectstart` in capture phase).
- Exempt review controls (toolbar/dialog/export buttons) so they remain fully interactive.
- Support draggable review toolbar/panel:
  - choose a drag handle area (for example toolbar header/meta row),
  - use pointer events to track drag delta,
  - clamp position to viewport bounds so toolbar stays visible.

3. Implement data capture:
- Intercept clicks in Review Mode (`capture` phase recommended).
- Ignore review control clicks (toolbar/dialog/export buttons) and ignore synthetic clicks (`event.isTrusted === false`) to avoid false prompts during programmatic downloads.
- Capture element screenshot with a resilient pipeline:
  - sanitize computed styles before capture,
  - retry with `foreignObjectRendering` on unsupported color function errors (`oklab`/`color-mix`),
  - detect fully transparent captures and fallback to text-canvas rendering for text-only elements.
- Store each record in `feedbackLog` with:
  - timestamp
  - comment text
  - element metadata (`tag`, `id`, `class`, selector path, text snippet)
  - screenshot data URL and deterministic filename

4. Implement export:
- Build `screenshots/` and `REPORT.md` in memory with `JSZip`.
- Convert data URLs to binary and write each image file with per-item validation.
- Write markdown sections per feedback item and reference `screenshots/<file>.png`.
- Trigger `.zip` download with a timestamped filename.
- Delay `URL.revokeObjectURL` cleanup so browser download is reliable.

5. Implement Notion sync (full version):
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
- data capture logic (`onReviewClick`, log shape, helper selectors)
- ZIP export logic (`exportFeedbackZip`)
- helper conversion function (`dataUrlToUint8Array`)
- optional configuration surface (`configureReviewMode`) for:
  - custom comment UI provider
  - custom control-target matcher
  - toolbar drag selector/handle selector
  - interaction lock toggle
- optional Notion sync helper (`pushFeedbackToNotion`) that calls backend API only

Keep functions framework-agnostic unless user asks for React/Vue wrappers.

## Script

If reusable code is needed, use:
- `scripts/review_mode_capture_export.js`
- `scripts/review_mode_notion_sync_server_template.mjs`

## Security Notes

- Never hardcode tokens, secrets, workspace IDs, or database keys in skill output.
- Use environment variables (`NOTION_API_KEY`, `NOTION_PARENT_PAGE_ID`, etc.) and server-side access only.
- If user asks to place secret directly in frontend, refuse and provide secure alternative.
