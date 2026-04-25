import { api } from '../../core/api.js';
/**
 * CHATBOT ATTACHMENTS MODULE (ES Module)
 */

import { ensureMarkdownDeps, renderMarkdownFragment } from './markdown.js';

function escapeHtmlSafe(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

export async function renderContentBlocksInBubble(pendingId, contentBlocks, isError, evidence) {
  await ensureMarkdownDeps();
  console.log('[Chatbot] backend blocks received:', { content: contentBlocks, evidence, isError });
  (contentBlocks || []).forEach(function (b, i) { console.log('[Chatbot] content[' + i + ']', b?.type, b); });
  (evidence || []).forEach(function (e, i) { console.log('[Chatbot] evidence[' + i + ']', e?.type, e); });
  if (!contentBlocks || !Array.isArray(contentBlocks) || contentBlocks.length === 0) {
    if (!evidence || !Array.isArray(evidence) || evidence.length === 0) return;
  }

  const messagesEl = document.querySelector('#chatbot-offcanvas .chat-messages');
  if (!messagesEl) return;

  const node = messagesEl.querySelector(`[data-chatbot-pending="${pendingId}"]`);
  if (!node) return;

  const bubble = node.querySelector('div');
  if (!bubble) return;

  const existingActions = node.querySelector('.ai-message-actions');
  if (existingActions) existingActions.remove();

  const addAuthTokenToUrl = buildUrlWithAuthToken();

  const firstBlock = contentBlocks?.[0];
  const firstText = (firstBlock?.type === 'text' || firstBlock?.type === 'markdown')
    ? (firstBlock.value ?? firstBlock.text ?? '')
    : '';
  if (isError && contentBlocks?.length === 1 && firstText !== undefined) {
    bubble.textContent = firstText;
    bubble.classList.remove('bg-body-secondary', 'markdown-content');
    bubble.classList.add('bg-danger', 'text-white');
    appendMessageActions(node);
    return;
  }

  bubble.classList.remove('bg-danger', 'text-white');
  bubble.classList.add('bg-body-secondary', 'markdown-content');
  bubble.innerHTML = '';

  for (let i = 0; i < (contentBlocks || []).length; i++) {
    const block = contentBlocks[i];
    if (!block || !block.type) continue;
    const html = renderSingleBlock(block, addAuthTokenToUrl);
    if (html) {
      const wrap = document.createElement('div');
      wrap.className = 'chatbot-content-block chatbot-content-block-' + String(block.type);
      wrap.innerHTML = html;
      wrap.querySelectorAll?.('a[href]')?.forEach(function (a) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      });
      bubble.appendChild(wrap);
    }
  }

  if (evidence && Array.isArray(evidence) && evidence.length > 0) {
    const evidenceHtml = renderEvidenceCards(evidence, addAuthTokenToUrl);
    if (evidenceHtml) {
      const wrap = document.createElement('div');
      wrap.className = 'chat-evidence';
      wrap.innerHTML = evidenceHtml;
      bubble.appendChild(wrap);
    }
  }

  appendMessageActions(node);
}

function renderSingleBlock(block, addAuthTokenToUrl) {
  const val = block.value ?? block.text ?? '';
  const fullUrl = (url) => (url ? addAuthTokenToUrl(url) : '');

  switch (block.type) {
    case 'text':
      return renderMarkdownFragment(val) || escapeHtmlSafe(val).replace(/\n/g, '<br>');
    case 'markdown':
      return '<div class="markdown">' + (renderMarkdownFragment(val) || escapeHtmlSafe(val).replace(/\n/g, '<br>')) + '</div>';
    case 'image':
      if (!block.url) return '';
      const caption = block.caption || (block.metadata && block.metadata.label) || '';
      const imgUrl = fullUrl(block.url);
      return '<div class="evidence-card image-block-card"><img src="' + escapeHtmlSafe(imgUrl) + '" alt="' + escapeHtmlSafe(caption) + '" loading="lazy" />' + (caption ? '<p>' + escapeHtmlSafe(caption) + '</p>' : '') + '</div>';
    case 'table':
      if (!block.columns || !block.columns.length) return '';
      const header = block.columns.map(function (c) { return '<th>' + escapeHtmlSafe(c) + '</th>'; }).join('');
      const rows = (block.rows || []).map(function (row) {
        const cells = row.map(function (cell) {
          var cellObj = cell;
          if (typeof cell === 'string' && cell.trim().indexOf('{') === 0) {
            try { cellObj = JSON.parse(cell); } catch (_) {}
          }
          if (typeof cellObj === 'object' && cellObj && cellObj.type === 'image' && cellObj.url) {
            return '<td><img src="' + escapeHtmlSafe(fullUrl(cellObj.url)) + '" alt="' + escapeHtmlSafe(cellObj.caption || '') + '" loading="lazy" /></td>';
          }
          var text = String(cell ?? '').replace(/\\n/g, '\n');
          var cellHtml = renderMarkdownFragment(text) || escapeHtmlSafe(text).replace(/\n/g, '<br>');
          return '<td class="chatbot-table-cell-markdown"><div class="markdown-content">' + cellHtml + '</div></td>';
        }).join('');
        return '<tr>' + cells + '</tr>';
      }).join('');
      return '<table class="chatbot-table"><thead><tr>' + header + '</tr></thead><tbody>' + rows + '</tbody></table>';
    case 'chart':
      return '<div class="chart-block" data-chart-type="' + escapeHtmlSafe(block.chart_type || '') + '" data-labels=\'' + escapeHtmlSafe(JSON.stringify(block.labels || [])) + '\' data-values=\'' + escapeHtmlSafe(JSON.stringify(block.values || [])) + '\'></div>';
    case 'code':
      return '<pre><code class="language-' + escapeHtmlSafe(block.language || '') + '">' + escapeHtmlSafe(val) + '</code></pre>';
    case 'diagram':
      return '<div class="mermaid">' + escapeHtmlSafe(val) + '</div>';
    case 'video': {
      const vidEvidence = {
        type: 'video',
        url: block.url,
        label: (block.metadata && block.metadata.label) || 'Video',
        timestamp: block.metadata && block.metadata.timestamp,
        ...(block.metadata || {})
      };
      const videoCard = buildVideoCard(vidEvidence, addAuthTokenToUrl);
      if (!videoCard) return '';
      const vWrap = document.createElement('div');
      vWrap.appendChild(videoCard);
      return vWrap.innerHTML;
    }
    case 'file': {
      const fileUrl = fullUrl(block.url || '');
      const fileName = block.name || 'Download';
      return '<a href="' + escapeHtmlSafe(fileUrl) + '" target="_blank" rel="noopener noreferrer" class="chatbot-file-link">' + escapeHtmlSafe(fileName) + '</a>';
    }
    default:
      if (val) {
        return '<div class="markdown">' + (renderMarkdownFragment(val) || escapeHtmlSafe(val).replace(/\n/g, '<br>')) + '</div>';
      }
      return '';
  }
}

function renderEvidenceCards(evidence, addAuthTokenToUrl) {
  if (!evidence || !evidence.length) return '';
  const fullUrl = (url) => (url ? addAuthTokenToUrl(url) : '');
  return evidence.map(function (e) {
    if (!e || e.type !== 'image' || !e.url) return '';
    const url = fullUrl(e.url);
    const title = e.title ? '<h4>' + escapeHtmlSafe(e.title) + '</h4>' : '';
    const desc = e.description ? '<p>' + escapeHtmlSafe(e.description) + '</p>' : '';
    return '<div class="evidence-card"><img src="' + escapeHtmlSafe(url) + '" alt="' + escapeHtmlSafe(e.title || '') + '" />' + title + desc + '</div>';
  }).filter(Boolean).join('');
}

function appendMessageActions(node) {
  const actionsHtml = `
    <div class="ai-message-actions mt-2">
      <button type="button" title="Copy" aria-label="Copy" data-copy-ai-message>
        <span class="far fa-copy"></span>
      </button>
      <button type="button" title="Like" aria-label="Like"><span class="far fa-thumbs-up"></span></button>
      <button type="button" title="Dislike" aria-label="Dislike"><span class="far fa-thumbs-down"></span></button>
      <button type="button" title="Share" aria-label="Share"><span class="fas fa-share-alt"></span></button>
      <button type="button" title="Refresh" aria-label="Refresh"><span class="fas fa-redo-alt"></span></button>
      <button type="button" title="More" aria-label="More"><span class="fas fa-ellipsis-h"></span></button>
    </div>
  `;
  node.insertAdjacentHTML('beforeend', actionsHtml);
}

function buildVideoCard(evidence, addAuthTokenToUrl) {
  const url = addAuthTokenToUrl(evidence.url || '');
  if (!url) return null;

  const card = document.createElement('div');
  card.className = 'chatbot-media-card';

  const label = document.createElement('div');
  label.className = 'chatbot-media-label';
  label.textContent = buildLabel(evidence);
  card.appendChild(label);

  const video = document.createElement('video');
  video.className = 'chatbot-evidence-video';
  video.controls = true;
  video.preload = 'metadata';

  const source = document.createElement('source');
  source.src = url;
  source.type = 'video/mp4';
  video.appendChild(source);

  video.addEventListener('error', function () {
    card.replaceChild(buildErrorPlaceholder('Evidence video unavailable'), video);
  });

  card.appendChild(video);

  const tsText = formatTimestamp(evidence.timestamp);
  if (tsText) {
    const ts = document.createElement('div');
    ts.className = 'chatbot-media-timestamp';
    ts.textContent = tsText;
    card.appendChild(ts);
  }

  return card;
}

function buildLabel(evidence) {
  const icons = { critical: '🔴', warning: '🟡', info: '🔵' };
  const icon = icons[evidence.severity] || '';
  const label = evidence.label || 'Evidence';
  return icon ? icon + ' ' + label : label;
}

function buildErrorPlaceholder(message) {
  const div = document.createElement('div');
  div.className = 'chatbot-media-error';
  div.textContent = '⚠️ ' + (message || 'Evidence failed to load.');
  return div;
}

function formatTimestamp(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(n => String(n).padStart(2, '0'))
      .join(':');
  } catch (_) { return ''; }
}

function buildUrlWithAuthToken() {
  const baseUrl = (api?.baseURL || '').replace(/\/$/, '');
  const token = api?.token ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem('visionai_token') : null);

  return function withToken(url) {
    if (!url) return '';
    const abs = url.startsWith('http') ? url : baseUrl + (url.startsWith('/') ? '' : '/') + url;
    if (!token) return abs;
    if (/[?&]token=/.test(abs)) return abs;
    return abs + (abs.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
  };
}
