// Review Mode capture + ZIP export helpers
// Assumptions:
// - html2canvas is available globally
// - JSZip is available globally

export const feedbackLog = [];

let reviewModeEnabled = false;
let reviewIsCapturing = false;
let lockUnderlyingInteractions = true;
let simpleFeedbackMode = false;
let toolbarSelector = '.review-toolbar';
let toolbarHandleSelector = '.review-toolbar-meta';
let toolbarPosition = null;
let toolbarDragState = null;

let commentProvider = async () => {
  const value = window.prompt('Add feedback for this element:');
  return value == null ? '' : String(value);
};

let controlTargetMatcher = (el) => {
  if (!(el instanceof Element)) return false;
  return Boolean(el.closest("[data-review-controls='true'], .review-toolbar, [role='dialog']"));
};

function normalizeEventTarget(event) {
  const target = event?.target;
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function eventHitsControls(event) {
  const path = typeof event?.composedPath === 'function' ? event.composedPath() : [];
  for (const node of path) {
    if (node instanceof Element && controlTargetMatcher(node)) return true;
  }
  return false;
}

function isReviewableTarget(target) {
  if (!(target instanceof Element)) return false;
  if (controlTargetMatcher(target)) return false;
  if (target === document.body || target === document.documentElement) return false;
  return true;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function blockReviewInteraction(event) {
  if (!reviewModeEnabled || !lockUnderlyingInteractions) return false;
  if (!event?.isTrusted) return false;
  const target = normalizeEventTarget(event);
  if (eventHitsControls(event) || controlTargetMatcher(target)) return false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  return true;
}

function applyToolbarPosition() {
  if (!toolbarPosition) return;
  const toolbar = document.querySelector(toolbarSelector);
  if (!(toolbar instanceof HTMLElement)) return;
  toolbar.style.left = `${toolbarPosition.x}px`;
  toolbar.style.top = `${toolbarPosition.y}px`;
  toolbar.style.right = 'auto';
  toolbar.style.bottom = 'auto';
}

function stopToolbarDrag() {
  toolbarDragState = null;
  const toolbar = document.querySelector(toolbarSelector);
  if (!(toolbar instanceof HTMLElement)) return;
  toolbar.classList.remove('is-dragging');
}

function onToolbarPointerDown(event) {
  if (!reviewModeEnabled) return;
  if (event.button !== 0) return;
  if (!(event.target instanceof Element)) return;

  const toolbar = document.querySelector(toolbarSelector);
  if (!(toolbar instanceof HTMLElement)) return;
  const handle = toolbar.querySelector(toolbarHandleSelector);
  if (!(handle instanceof Element) || !handle.contains(event.target)) return;

  const rect = toolbar.getBoundingClientRect();
  toolbarPosition = { x: rect.left, y: rect.top };
  toolbarDragState = {
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
  };
  toolbar.classList.add('is-dragging');
  event.preventDefault();
  event.stopPropagation();
}

function onToolbarPointerMove(event) {
  if (!toolbarDragState) return;
  if (event.pointerId !== toolbarDragState.pointerId) return;

  const toolbar = document.querySelector(toolbarSelector);
  if (!(toolbar instanceof HTMLElement)) return;

  const width = toolbar.offsetWidth || 240;
  const height = toolbar.offsetHeight || 100;
  const margin = 10;
  const x = clamp(event.clientX - toolbarDragState.offsetX, margin, Math.max(margin, window.innerWidth - width - margin));
  const y = clamp(event.clientY - toolbarDragState.offsetY, margin, Math.max(margin, window.innerHeight - height - margin));
  toolbarPosition = { x, y };
  applyToolbarPosition();
}

function onToolbarPointerUp(event) {
  if (!toolbarDragState) return;
  if (event.pointerId !== toolbarDragState.pointerId) return;
  stopToolbarDrag();
}

function cssPath(el) {
  if (!(el instanceof Element)) return '';
  const parts = [];
  let node = el;

  while (node && node.nodeType === 1 && node !== document.body) {
    const id = node.id ? `#${node.id}` : '';
    const cls = node.classList?.length ? `.${[...node.classList].slice(0, 2).join('.')}` : '';
    const nth = node.parentElement ? `:nth-child(${[...node.parentElement.children].indexOf(node) + 1})` : '';
    parts.unshift(`${node.tagName.toLowerCase()}${id || cls}${id ? '' : nth}`);
    node = node.parentElement;
  }

  return parts.join(' > ');
}

function safeName(value) {
  return String(value ?? '')
    .replace(/[^a-z0-9-_]/gi, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

function canvasHasVisiblePixels(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return true;
  }
  return false;
}

function paintTextFallbackCanvas(target, scale = 1) {
  if (!(target instanceof Element)) return null;
  const text = (target.textContent || '').trim();
  if (!text) return null;

  const rect = target.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const cs = window.getComputedStyle(target);
  const rootCs = window.getComputedStyle(document.documentElement);
  const surface = rootCs.getPropertyValue('--surface').trim() || '#111318';
  const backgroundTransparent = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\)$/i.test(cs.backgroundColor);
  const bg = cs.backgroundColor && !backgroundTransparent ? cs.backgroundColor : surface;
  const lineHeight = Number.parseFloat(cs.lineHeight) || Number.parseFloat(cs.fontSize) * 1.45 || 22;
  const font = cs.font && cs.font !== '' ? cs.font : `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const paddingLeft = Number.parseFloat(cs.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(cs.paddingRight) || 0;
  const paddingTop = Number.parseFloat(cs.paddingTop) || 0;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.scale(scale, scale);
  ctx.font = font;
  ctx.fillStyle = cs.color || '#f7f8f8';
  ctx.textBaseline = 'top';
  ctx.direction = cs.direction || 'ltr';

  const words = text.split(/\s+/);
  const maxWidth = Math.max(1, rect.width - paddingLeft - paddingRight);
  let line = '';
  let y = paddingTop;

  for (let i = 0; i < words.length; i += 1) {
    const testLine = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, paddingLeft, y);
      line = words[i];
      y += lineHeight;
    } else {
      line = testLine;
    }
  }

  if (line) ctx.fillText(line, paddingLeft, y);
  return canvas;
}

async function withSanitizedCaptureStyles(root, task) {
  if (!(root instanceof Element)) return task();

  const patched = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const nodes = [root];
  while (walker.nextNode()) {
    if (walker.currentNode instanceof Element) nodes.push(walker.currentNode);
  }

  for (const node of nodes) {
    const previousStyle = node.getAttribute('style');
    patched.push({ node, previousStyle });

    const cs = window.getComputedStyle(node);
    const webkitTextFill = cs.getPropertyValue('-webkit-text-fill-color');
    const forcedTextFill =
      webkitTextFill && webkitTextFill !== 'initial' && webkitTextFill !== 'currentcolor' ? webkitTextFill : cs.color;
    const block = [
      `color:${cs.color}`,
      `background-color:${cs.backgroundColor}`,
      `border-top-color:${cs.borderTopColor}`,
      `border-right-color:${cs.borderRightColor}`,
      `border-bottom-color:${cs.borderBottomColor}`,
      `border-left-color:${cs.borderLeftColor}`,
      `text-decoration-color:${cs.textDecorationColor || cs.color}`,
      `outline-color:${cs.outlineColor || cs.color}`,
      `-webkit-text-fill-color:${forcedTextFill}`,
    ];

    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') {
      block.push('mix-blend-mode:normal');
    }

    const append = block.join(';');
    if (previousStyle) {
      node.setAttribute('style', `${previousStyle};${append}`);
    } else {
      node.setAttribute('style', append);
    }
  }

  try {
    return await task();
  } finally {
    for (const { node, previousStyle } of patched) {
      if (previousStyle == null) {
        node.removeAttribute('style');
      } else {
        node.setAttribute('style', previousStyle);
      }
    }
  }
}

async function captureReviewCanvas(target) {
  const scale = window.devicePixelRatio > 1 ? 2 : 1;
  const rootCs = window.getComputedStyle(document.documentElement);
  const surface = rootCs.getPropertyValue('--surface').trim() || '#111318';
  const baseOptions = {
    backgroundColor: surface,
    scale,
    useCORS: true,
  };

  const render = async (options) => withSanitizedCaptureStyles(target, () => html2canvas(target, options));

  try {
    const canvas = await render(baseOptions);
    if (canvasHasVisiblePixels(canvas)) return canvas;
    const fallback = paintTextFallbackCanvas(target, scale);
    return fallback || canvas;
  } catch (error) {
    const message = String(error?.message || '');
    const unsupportedColor = message.includes('unsupported color function') || message.includes('oklab');
    if (!unsupportedColor) throw error;

    const canvas = await render({
      ...baseOptions,
      foreignObjectRendering: true,
    });
    if (canvasHasVisiblePixels(canvas)) return canvas;
    const fallback = paintTextFallbackCanvas(target, scale);
    return fallback || canvas;
  }
}

export async function onReviewClick(event) {
  if (!reviewModeEnabled) return;
  if (reviewIsCapturing) return;
  if (!event?.isTrusted) return;

  const target = normalizeEventTarget(event);
  if (eventHitsControls(event) || !isReviewableTarget(target)) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();

  const comment = (await commentProvider(target)).trim();
  if (!comment) return;

  try {
    reviewIsCapturing = true;
    const canvas = await captureReviewCanvas(target);
    const imageDataUrl = canvas.toDataURL('image/png');
    const ts = new Date();
    const stamp = ts.toISOString().replace(/[:.]/g, '-');
    const screenshotFile = `${stamp}-${safeName(target.tagName)}.png`;

    if (simpleFeedbackMode) {
      feedbackLog.push({
        timestamp: ts.toISOString(),
        comment,
        screenshot: {
          file: screenshotFile,
          dataUrl: imageDataUrl,
        },
      });
    } else {
      feedbackLog.push({
        id: feedbackLog.length + 1,
        createdAt: ts.toISOString(),
        comment,
        element: {
          tag: target.tagName.toLowerCase(),
          id: target.id || null,
          className: target.className || null,
          selector: cssPath(target),
          text: (target.textContent || '').trim().slice(0, 160),
        },
        screenshot: {
          file: screenshotFile,
          dataUrl: imageDataUrl,
        },
      });
    }
  } catch (error) {
    console.error('Review mode capture failed', error);
    window.alert('Could not capture screenshot for this element.');
  } finally {
    reviewIsCapturing = false;
  }
}

function onReviewPointerDown(event) {
  blockReviewInteraction(event);
}

function onReviewTouchStart(event) {
  blockReviewInteraction(event);
}

function onReviewWheel(event) {
  blockReviewInteraction(event);
}

function onReviewDragStart(event) {
  blockReviewInteraction(event);
}

function onReviewDrop(event) {
  blockReviewInteraction(event);
}

function onReviewSelectStart(event) {
  blockReviewInteraction(event);
}

export function setReviewMode(enabled) {
  const nextEnabled = Boolean(enabled);
  if (nextEnabled === reviewModeEnabled) return;
  reviewModeEnabled = nextEnabled;

  if (reviewModeEnabled) {
    document.addEventListener('click', onReviewClick, true);
    document.addEventListener('pointerdown', onToolbarPointerDown, true);
    document.addEventListener('pointermove', onToolbarPointerMove, true);
    document.addEventListener('pointerup', onToolbarPointerUp, true);
    document.addEventListener('pointercancel', onToolbarPointerUp, true);
    document.addEventListener('pointerdown', onReviewPointerDown, true);
    document.addEventListener('touchstart', onReviewTouchStart, { capture: true, passive: false });
    document.addEventListener('wheel', onReviewWheel, { capture: true, passive: false });
    document.addEventListener('dragstart', onReviewDragStart, true);
    document.addEventListener('drop', onReviewDrop, true);
    document.addEventListener('selectstart', onReviewSelectStart, true);
    applyToolbarPosition();
    return;
  }

  document.removeEventListener('click', onReviewClick, true);
  document.removeEventListener('pointerdown', onToolbarPointerDown, true);
  document.removeEventListener('pointermove', onToolbarPointerMove, true);
  document.removeEventListener('pointerup', onToolbarPointerUp, true);
  document.removeEventListener('pointercancel', onToolbarPointerUp, true);
  document.removeEventListener('pointerdown', onReviewPointerDown, true);
  document.removeEventListener('touchstart', onReviewTouchStart, true);
  document.removeEventListener('wheel', onReviewWheel, true);
  document.removeEventListener('dragstart', onReviewDragStart, true);
  document.removeEventListener('drop', onReviewDrop, true);
  document.removeEventListener('selectstart', onReviewSelectStart, true);
  stopToolbarDrag();
}

export function configureReviewMode(options = {}) {
  if (typeof options.commentProvider === 'function') {
    commentProvider = options.commentProvider;
  }
  if (typeof options.controlTargetMatcher === 'function') {
    controlTargetMatcher = options.controlTargetMatcher;
  }
  if (typeof options.lockUnderlyingInteractions === 'boolean') {
    lockUnderlyingInteractions = options.lockUnderlyingInteractions;
  }
  if (typeof options.simpleFeedbackMode === 'boolean') {
    simpleFeedbackMode = options.simpleFeedbackMode;
  }
  if (typeof options.toolbarSelector === 'string' && options.toolbarSelector.trim()) {
    toolbarSelector = options.toolbarSelector.trim();
  }
  if (typeof options.toolbarHandleSelector === 'string' && options.toolbarHandleSelector.trim()) {
    toolbarHandleSelector = options.toolbarHandleSelector.trim();
  }
}

export function dataUrlToUint8Array(dataUrl) {
  const raw = String(dataUrl ?? '');
  const base64 = raw.split(',')[1];
  if (!base64) throw new Error('Invalid screenshot data URL.');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function mdEscape(value = '') {
  return String(value).replace(/([\\`*_{}\[\]()#+\-.!|>])/g, '\\$1');
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.setAttribute('data-review-controls', 'true');
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function exportFeedbackZip(customLog = feedbackLog) {
  if (!customLog.length) {
    window.alert('No feedback to export.');
    return;
  }

  try {
    const zip = new JSZip();
    const shots = zip.folder('screenshots');
    const report = ['# UI Review Report', '', `Generated: ${new Date().toISOString()}`, `Items: ${customLog.length}`, ''];

    customLog.forEach((item, i) => {
      const imageData = item?.screenshot?.dataUrl;
      const hasScreenshot = typeof imageData === 'string' && imageData.startsWith('data:image/');
      const screenshotFile = item?.screenshot?.file || `capture-${i + 1}.png`;
      let screenshotLine = '- **Screenshot:** _(not available)_';

      if (hasScreenshot) {
        try {
          shots.file(screenshotFile, dataUrlToUint8Array(imageData), { binary: true });
          screenshotLine = `- **Screenshot:** ![capture](screenshots/${screenshotFile})`;
        } catch (error) {
          console.error('Failed to pack screenshot for review item', i + 1, error);
        }
      }

      report.push(`## ${i + 1}. ${mdEscape(item?.element?.tag || 'element')} — ${item?.createdAt || item?.timestamp || 'Unknown time'}`);
      report.push('');
      report.push(`- **Comment:** ${mdEscape(item?.comment || '(none)')}`);
      report.push(`- **Selector:** \`${item?.element?.selector || 'N/A'}\``);
      report.push(`- **Element ID:** \`${item?.element?.id || 'N/A'}\``);
      report.push(`- **Class:** \`${item?.element?.className || 'N/A'}\``);
      report.push(`- **Text Snippet:** ${mdEscape(item?.element?.text || 'N/A')}`);
      report.push(screenshotLine);
      report.push('');
    });

    zip.file('REPORT.md', report.join('\n'));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    downloadBlob(blob, `ui-review-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.zip`);
  } catch (error) {
    console.error('Review ZIP export failed', error);
    window.alert('Export failed. Open DevTools console for details, then try again.');
  }
}

export async function pushFeedbackToNotion(
  customLog = feedbackLog,
  {
    endpoint = '/api/review/notion',
    sourceUrl = typeof window !== 'undefined' ? window.location.href : '',
    title = `UI Review ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
  } = {}
) {
  if (!customLog.length) {
    window.alert('No feedback to push.');
    return null;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      generatedAt: new Date().toISOString(),
      sourceUrl,
      items: customLog.map((item) => ({
        id: item?.id,
        createdAt: item?.createdAt || item?.timestamp,
        comment: item?.comment,
        element: item?.element,
        screenshot: item?.screenshot,
      })),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    const message = payload?.error || `Push failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}
