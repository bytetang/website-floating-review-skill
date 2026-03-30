# Review Mode Skill

A portable skill for adding **UI review mode** to web pages: click elements, leave feedback, capture element screenshots, and export a ZIP report.

This skill is designed to work across coding-agent hosts (Codex, Claude Code, OpenClaw-style flows) and across website stacks (framework apps or plain HTML pages).

## Features

- Click-to-comment review capture for specific DOM elements
- Element-level screenshot capture with `html2canvas`
- Resilient capture pipeline:
  - computed-style sanitization before capture
  - retry path for unsupported color functions (`oklab` / related cases)
  - transparent-capture fallback via text-canvas rendering
- In-memory review log with element metadata:
  - timestamp
  - tag/id/class
  - CSS selector path
  - text snippet
  - screenshot data URL + file name
- ZIP export with `JSZip`:
  - `REPORT.md`
  - `screenshots/*.png`
- Optional server-side Notion sync helper (no client-side secrets)
- Configurable integration hooks:
  - custom comment UI provider
  - custom control-target matcher
  - toolbar selector / drag-handle selector
  - interaction-lock toggle

## Repo Layout

- `SKILL.md` - source-of-truth skill instructions
- `scripts/review_mode_capture_export.js` - browser runtime capture/export helper
- `scripts/review_mode_notion_sync_server_template.mjs` - backend Notion sync template
- `agents/openai.yaml` - optional host metadata

## Runtime Assumptions

- `html2canvas` is available globally in browser runtime
- `JSZip` is available globally in browser runtime
- Review interactions run client-side in the page context

## Installation Guide

### Option 1: Install as a local Codex skill (recommended)

1. Pick your Codex home directory:
   - macOS default is typically `~/.codex`
2. Create the target folder:
   - `mkdir -p "$CODEX_HOME/skills/review-mode"`
3. Copy this repo's skill files into that folder:
   - copy `SKILL.md`
   - copy `scripts/`
   - copy `agents/` (optional, host-specific metadata)
4. Restart Codex (or reload skills if your host supports it).
5. Invoke it in prompts with the skill name, for example:
   - "Use `review-mode` to add click-to-comment UI review export to this page."

### Option 2: Use directly without installing as a skill

1. Copy `scripts/review_mode_capture_export.js` into your web project.
2. Ensure `html2canvas` and `JSZip` are loaded in your page/app.
3. Wire your own floating toolbar + dialog UI and call:
   - `configureReviewMode(...)`
   - `setReviewMode(true)`
   - `exportFeedbackZip()`
4. (Optional) Add a backend API and use `pushFeedbackToNotion(...)`.

## Pure HTML Page Usage

Yes, this works with pure HTML pages.

Minimum setup:

1. Load `html2canvas` + `JSZip` via script tags.
2. Load `review_mode_capture_export.js`.
3. Provide toolbar/dialog markup + CSS that matches your page style.
4. Enable review mode and bind an export button.

## Security Notes

- Never place Notion or other API secrets in frontend code.
- Keep credentials server-side (`NOTION_API_KEY`, `NOTION_PARENT_PAGE_ID`, etc.).
- Use a backend bridge endpoint from the browser helper.

## License

Add your preferred license in this repository if you plan to publish/share it.
