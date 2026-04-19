import { api } from '../../core/api.js';
/**
 * CHATBOT MARKDOWN MODULE (ES Module)
 */

let messagesEl = null;
let escapeHtml = null;

function getVendorPath(pathFromVendors) {
  return new URL('/vendors/' + pathFromVendors, window.location.origin).toString();
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    try {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) return resolve();
      const scriptEl = document.createElement('script');
      scriptEl.src = src;
      scriptEl.defer = true;
      scriptEl.onload = () => resolve();
      scriptEl.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(scriptEl);
    } catch (e) {
      reject(e);
    }
  });
}

export function ensureMarkdownDeps() {
  if (window.marked && window.DOMPurify) return Promise.resolve();
  const markedSrc = getVendorPath('marked/marked.min.js');
  const purifySrc = getVendorPath('dompurify/purify.min.js');
  return loadScriptOnce(markedSrc)
    .then(() => loadScriptOnce(purifySrc))
    .catch(function () {});
}

function rewriteApiImageUrls(html) {
  if (!html || typeof html !== 'string') return html;
  const baseURL = (typeof window !== 'undefined' && api && api.baseURL) ? api.baseURL : '';
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('visionai_token') : null;
  const separator = (url) => (url.indexOf('?') !== -1 ? '&' : '?');
  const withToken = (url) => (token ? url + separator(url) + 'token=' + encodeURIComponent(token) : url);

  let rewritten = html;
  rewritten = rewritten.replace(
    /src="([^"]*\/api\/v1\/events\/[^"]*\/image[^"]*)"/g,
    function (match, urlPath) {
      const isAbsolute = /^https?:\/\//i.test(urlPath);
      const fullUrl = isAbsolute ? urlPath : (baseURL ? (baseURL.replace(/\/$/, '') + (urlPath.startsWith('/') ? urlPath : '/' + urlPath)) : urlPath);
      const finalUrl = withToken(fullUrl);
      console.log('[ChatbotMarkdown] Rewriting image src:', urlPath, '->', finalUrl);
      return 'src="' + finalUrl + '"';
    }
  );
  return rewritten;
}

function logImageLoadErrors(container) {
  if (!container || !container.querySelectorAll) return;
  container.querySelectorAll('img').forEach(function (img, i) {
    const src = img.getAttribute('src');
    console.log('[ChatbotMarkdown] Image #' + (i + 1) + ' src set:', src);
    img.addEventListener('load', function () { console.log('[ChatbotMarkdown] Image loaded OK:', src); });
    img.addEventListener('error', function () { console.warn('[ChatbotMarkdown] Image failed to load:', src); });
  });
}

export function safeMarkdownForStreaming(text) {
  let t = String(text || '');
  t = t.replace(/<\/?question>/gi, '');

  (function suppressMermaidBlocks() {
    const placeholder = '\n\n<div class="flow-diagram-placeholder" style="width:100%;height:360px;margin-top:1rem;margin-bottom:1rem;background:#f8f9fa;border:1px solid #dee2e6;border-radius:0.5rem;display:flex;align-items:center;justify-content:center;color:#6c757d;font-size:0.95rem;">Rendering diagram…</div>\n\n';
    let src = t;
    let out = '';
    let i = 0;
    while (true) {
      const start = src.indexOf('```mermaid', i);
      if (start === -1) break;
      out += src.slice(i, start);
      const lineEnd = src.indexOf('\n', start);
      if (lineEnd === -1) { out += placeholder; i = src.length; break; }
      let close = src.indexOf('\n```', lineEnd + 1);
      while (close !== -1) {
        const after = close + 4;
        if (after >= src.length) break;
        const ch = src[after];
        if (ch === '\n') break;
        if (ch === '\r' && src[after + 1] === '\n') break;
        close = src.indexOf('\n```', close + 1);
      }
      if (close === -1) { out += placeholder; i = src.length; break; }
      out += placeholder;
      i = close + 4;
      if (src[i] === '\r' && src[i + 1] === '\n') i += 2;
      else if (src[i] === '\n') i += 1;
    }
    out += src.slice(i);
    t = out;
  })();

  const fence = '```';
  const fenceCount = (t.match(/```/g) || []).length;
  if (fenceCount % 2 === 1) {
    const last = t.lastIndexOf(fence);
    if (last !== -1) {
      const brokenFence = '``\u200b`';
      t = t.slice(0, last) + brokenFence + t.slice(last + fence.length);
    }
  }

  try {
    const lines = t.split('\n');
    const sepRe = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;
    const rowRe = /^\s*\|.*\|\s*$/;
    let sepLineIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (sepRe.test(lines[i] || '')) { sepLineIdx = i; break; }
    }
    if (sepLineIdx !== -1) {
      let tableStart = Math.max(0, sepLineIdx - 1);
      while (tableStart > 0) {
        const prev = lines[tableStart - 1] || '';
        if (prev.trim() === '') break;
        if (rowRe.test(prev) || sepRe.test(prev)) { tableStart -= 1; continue; }
        break;
      }
      let tableEnd = sepLineIdx;
      while (tableEnd + 1 < lines.length) {
        const nxt = lines[tableEnd + 1] || '';
        if (nxt.trim() === '') break;
        if (rowRe.test(nxt) || sepRe.test(nxt)) { tableEnd += 1; continue; }
        break;
      }
      const terminatorLine = lines[tableEnd + 1] || '';
      const hasTerminator = (terminatorLine.trim() === '') || (!!terminatorLine && !(rowRe.test(terminatorLine) || sepRe.test(terminatorLine)));
      if (!hasTerminator && tableEnd >= lines.length - 1) {
        for (let j = tableStart; j < lines.length; j++) {
          lines[j] = (lines[j] || '').replaceAll('|', '&#124;');
        }
        t = lines.join('\n');
      }
    }
  } catch (_) {}

  return t;
}

export function updateAssistantPendingText(pendingId, text) {
  const node = messagesEl?.querySelector?.(`[data-chatbot-pending="${pendingId}"]`);
  if (!node) return;
  const bubble = node.querySelector?.('div');
  if (!bubble) return;

  bubble._streamAccumulatedText = String(text || '');
  if (bubble._streamRaf) return;

  bubble._streamRaf = requestAnimationFrame(() => {
    bubble._streamRaf = null;
    const msg = bubble._streamAccumulatedText || '';
    const safe = safeMarkdownForStreaming(msg);
    if (safe === bubble._lastStreamSafeText) return;
    bubble._lastStreamSafeText = safe;

    bubble.classList.remove('bg-danger', 'text-white');
    bubble.classList.add('bg-body-secondary', 'markdown-content');

    try {
      if (window.marked && window.DOMPurify && typeof window.marked.parse === 'function') {
        const allowedTags = ['p', 'br', 'strong', 'em', 'u', 's', 'code', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'a', 'hr', 'div', 'img'];
        let rawHtml = '';
        try { rawHtml = window.marked.parse(safe); } catch (_) { rawHtml = (escapeHtml || ((s) => s))(safe).replace(/\n/g, '<br>'); }
        const cleanHtml = window.DOMPurify.sanitize(rawHtml, {
          ALLOWED_TAGS: allowedTags,
          ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class', 'style', 'src', 'alt'],
          KEEP_CONTENT: true
        });
        let processedHtml = rewriteApiImageUrls(cleanHtml);
        bubble.innerHTML = processedHtml;
        logImageLoadErrors(bubble);
        bubble.querySelectorAll?.('a[href]')?.forEach(a => {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
        });
      } else {
        bubble.innerHTML = (escapeHtml || ((s) => s))(safe).replace(/\n/g, '<br>');
      }
    } catch (_) {
      bubble.innerHTML = (escapeHtml || ((s) => s))(safe).replace(/\n/g, '<br>');
    }
  });
}

export function renderMarkdownFragment(text) {
  if (text == null || text === '') return '';
  const msg = String(text).replace(/<\/?question>/gi, '');
  try {
    if (window.marked && window.DOMPurify) {
      const allowedTags = ['p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'a', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'img'];
      let rawHtml = typeof window.marked.parse === 'function' ? window.marked.parse(msg) : msg;
      const cleanHtml = window.DOMPurify.sanitize(rawHtml, {
        ALLOWED_TAGS: allowedTags,
        ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'id', 'style', 'type', 'class', 'src', 'alt'],
        KEEP_CONTENT: true,
        ADD_ATTR: ['id', 'style', 'class', 'src', 'alt']
      });
      return rewriteApiImageUrls(cleanHtml);
    }
  } catch (_) {}
  const esc = escapeHtml || ((s) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));
  return esc(msg).replace(/\n/g, '<br>');
}

export function replaceAssistantPending(pendingId, text, isError = false) {
  const node = messagesEl?.querySelector?.(`[data-chatbot-pending="${pendingId}"]`);
  if (!node) return;
  const bubble = node.querySelector?.('div');
  if (!bubble) return;
  let msg = String(text || '').replace(/<\/?question>/gi, '');

  if (isError) {
    bubble.textContent = msg;
    bubble.classList.remove('bg-body-secondary');
    bubble.classList.add('bg-danger', 'text-white');
    return;
  }

  bubble.classList.add('markdown-content');

  const extracted = { markdown: msg, diagrams: [] };
  const msgWithoutFlow = extracted.markdown;

  try {
    if (window.marked && window.DOMPurify) {
      const allowedTags = ['p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'a', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'img'];
      let rawHtml;
      try {
        rawHtml = typeof window.marked.parse === 'function' ? window.marked.parse(msgWithoutFlow) : msgWithoutFlow;
      } catch (_) { rawHtml = msgWithoutFlow; }
      const cleanHtml = window.DOMPurify.sanitize(rawHtml, {
        ALLOWED_TAGS: allowedTags,
        ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'id', 'style', 'type', 'class', 'src', 'alt'],
        KEEP_CONTENT: true,
        ADD_ATTR: ['id', 'style', 'class', 'src', 'alt']
      });
      let processedHtml = rewriteApiImageUrls(cleanHtml);
      bubble.innerHTML = processedHtml;
      logImageLoadErrors(bubble);
      bubble.querySelectorAll?.('a[href]')?.forEach(a => {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      });
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
    } else {
      bubble.textContent = msg;
    }
  } catch (_) {
    bubble.textContent = msg;
  }
}

export function init(deps) {
  messagesEl = deps.messagesEl;
  escapeHtml = deps.escapeHtml;
  ensureMarkdownDeps();
}
