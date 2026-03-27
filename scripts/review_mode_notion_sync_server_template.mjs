import 'dotenv/config';
import express from 'express';

const app = express();
const port = Number(process.env.PORT || 8787);

const NOTION_API_BASE = 'https://api.notion.com/v1';
const notionApiKey = process.env.NOTION_API_KEY || '';
const notionParentPageIdRaw = process.env.NOTION_PARENT_PAGE_ID || '';
const notionVersion = process.env.NOTION_VERSION || '2026-03-11';
const notionTitlePrefix = process.env.NOTION_REPORT_TITLE_PREFIX || 'UI Review';

app.use(express.json({ limit: '25mb' }));

function normalizeNotionUuid(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const dashed = raw.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (dashed) return dashed[0].toLowerCase();

  const hexMatches = raw.match(/[0-9a-fA-F]{32}/g);
  if (!hexMatches || !hexMatches.length) return raw;
  const hex = hexMatches[hexMatches.length - 1].toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const notionParentPageId = normalizeNotionUuid(notionParentPageIdRaw);

function ensureConfigured() {
  if (!notionApiKey) throw new Error('Missing NOTION_API_KEY');
  if (!notionParentPageId) throw new Error('Missing NOTION_PARENT_PAGE_ID');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(notionParentPageId)) {
    throw new Error(`Invalid NOTION_PARENT_PAGE_ID after normalization: "${notionParentPageIdRaw}"`);
  }
}

function truncateText(value, max = 1800) {
  const str = String(value ?? '');
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function richText(value) {
  return [{ type: 'text', text: { content: truncateText(value) } }];
}

function parseDataUrl(dataUrl) {
  const raw = String(dataUrl ?? '');
  const match = raw.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/);
  if (!match) throw new Error('Invalid screenshot data URL');
  const contentType = match[1] || 'application/octet-stream';
  const payload = match[2] || '';
  const buffer = Buffer.from(payload, 'base64');
  return { buffer, contentType };
}

async function notionRequest(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${notionApiKey}`,
      'Notion-Version': notionVersion,
      ...headers,
    },
    body,
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const detail = typeof payload === 'string' ? payload : JSON.stringify(payload);
    throw new Error(`Notion API ${method} ${path} failed (${response.status}): ${detail}`);
  }

  return payload;
}

async function createPage({ title, generatedAt, itemCount, sourceUrl }) {
  return notionRequest('/pages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parent: { page_id: notionParentPageId },
      properties: {
        title: {
          title: [{ type: 'text', text: { content: truncateText(title, 200) } }],
        },
      },
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: richText(`Generated: ${generatedAt}`) },
        },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: richText(`Items: ${itemCount}`) },
        },
        ...(sourceUrl
          ? [
              {
                object: 'block',
                type: 'paragraph',
                paragraph: {
                  rich_text: [
                    { type: 'text', text: { content: 'Source: ' } },
                    { type: 'text', text: { content: truncateText(sourceUrl), link: { url: sourceUrl } } },
                  ],
                },
              },
            ]
          : []),
      ],
    }),
  });
}

async function uploadFileToNotion({ filename, contentType, buffer }) {
  const created = await notionRequest('/file_uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'single_part', filename, content_type: contentType }),
  });

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType }), filename);

  await notionRequest(`/file_uploads/${created.id}/send`, {
    method: 'POST',
    body: form,
  });

  return created.id;
}

async function appendChildren(parentId, children) {
  const batchSize = 80;
  for (let i = 0; i < children.length; i += batchSize) {
    const batch = children.slice(i, i + batchSize);
    await notionRequest(`/blocks/${parentId}/children`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ children: batch }),
    });
  }
}

app.get('/api/review/notion/health', (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(notionApiKey && notionParentPageId),
    normalizedParentPageId: notionParentPageId || null,
    notionVersion,
  });
});

app.post('/api/review/notion', async (req, res) => {
  try {
    ensureConfigured();

    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) {
      return res.status(400).json({ ok: false, error: 'No review items provided.' });
    }

    const generatedAt = body.generatedAt || new Date().toISOString();
    const title = truncateText(body.title || `${notionTitlePrefix} ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`, 200);
    const sourceUrl = body.sourceUrl ? String(body.sourceUrl) : '';

    const page = await createPage({
      title,
      generatedAt,
      itemCount: items.length,
      sourceUrl,
    });

    const blocks = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i] || {};
      let uploadId = null;
      const dataUrl = item?.screenshot?.dataUrl;

      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
        try {
          const parsed = parseDataUrl(dataUrl);
          const filename = truncateText(item?.screenshot?.file || `capture-${i + 1}.png`, 180);
          uploadId = await uploadFileToNotion({
            filename,
            contentType: parsed.contentType,
            buffer: parsed.buffer,
          });
        } catch (error) {
          console.error(`Screenshot upload failed for item ${i + 1}`, error);
        }
      }

      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: richText(`${i + 1}. ${item?.element?.tag || 'element'} — ${item?.createdAt || 'Unknown time'}`),
        },
      });
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: richText(`Comment: ${item?.comment || '(none)'}`) },
      });
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: richText(`Selector: ${item?.element?.selector || 'N/A'}`) },
      });
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: richText(`Text: ${item?.element?.text || 'N/A'}`) },
      });

      if (uploadId) {
        blocks.push({
          object: 'block',
          type: 'image',
          image: {
            type: 'file_upload',
            file_upload: { id: uploadId },
            caption: richText(item?.screenshot?.file || 'capture.png'),
          },
        });
      }
    }

    await appendChildren(page.id, blocks);
    return res.json({ ok: true, pageId: page.id, pageUrl: page.url, pushed: items.length });
  } catch (error) {
    console.error('Notion sync failed', error);
    return res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
});

app.listen(port, () => {
  console.log(`[review-notion-api] listening on http://localhost:${port}`);
});
