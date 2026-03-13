/**
 * CHATBOT ATTACHMENTS MODULE
 * ==========================
 * Renders different types of content in chat bubbles:
 * text, markdown, images, tables, charts, videos, files.
 *
 * Flow: Backend sends content blocks -> We turn each into HTML -> Append to bubble
 */
(function () {
  'use strict';

  // ============================================================================
  // SECTION 1: MAIN ENTRY POINT
  // ============================================================================

  /**
   * Render content blocks (text, images, tables, etc.) into a pending AI message bubble.
   * Called when the backend returns a structured response.
   *
   * @param {string} pendingId  - ID of the bubble (data-chatbot-pending)
   * @param {Array}  contentBlocks - Array of { type, value, url, ... }
   * @param {boolean} isError  - If true, show error styling
   * @param {Array}  [evidence] - Optional evidence cards (images)
   */
  async function renderContentBlocksInBubble(pendingId, contentBlocks, isError, evidence) {
    if (window.ChatbotMarkdown && typeof window.ChatbotMarkdown.ensureMarkdownDeps === 'function') {
      await window.ChatbotMarkdown.ensureMarkdownDeps();
    }
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

    // Remove any existing actions bar (from previous replaceAssistantPending)
    const existingActions = node.querySelector('.ai-message-actions');
    if (existingActions) existingActions.remove();

    const addAuthTokenToUrl = buildUrlWithAuthToken();

    // Error: single text block
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

    // Render content blocks (agent + general chat)
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

    // Render evidence section
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

  /** Escape HTML to prevent XSS (safe text in HTML) */
  function escapeHtmlSafe(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  // ============================================================================
  // SECTION 2: BLOCK RENDERERS (convert each block type to HTML)
  // ============================================================================

  /** Turn one content block into HTML. Returns empty string if nothing to show. */
  function renderSingleBlock(block, addAuthTokenToUrl) {
    const val = block.value ?? block.text ?? '';
    const fullUrl = (url) => (url ? addAuthTokenToUrl(url) : '');

    switch (block.type) {
      case 'text':
        return (window.ChatbotMarkdown && typeof window.ChatbotMarkdown.renderMarkdownFragment === 'function')
          ? window.ChatbotMarkdown.renderMarkdownFragment(val)
          : escapeHtmlSafe(val).replace(/\n/g, '<br>');
      case 'markdown':
        return (window.ChatbotMarkdown && typeof window.ChatbotMarkdown.renderMarkdownFragment === 'function')
          ? '<div class="markdown">' + window.ChatbotMarkdown.renderMarkdownFragment(val) + '</div>'
          : '<div class="markdown">' + escapeHtmlSafe(val).replace(/\n/g, '<br>') + '</div>';
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
              try {
                cellObj = JSON.parse(cell);
              } catch (_) {}
            }
            if (typeof cellObj === 'object' && cellObj && cellObj.type === 'image' && cellObj.url) {
              return '<td><img src="' + escapeHtmlSafe(fullUrl(cellObj.url)) + '" alt="' + escapeHtmlSafe(cellObj.caption || '') + '" loading="lazy" /></td>';
            }
            var text = String(cell ?? '');
            text = text.replace(/\\n/g, '\n');
            var cellHtml = (window.ChatbotMarkdown && typeof window.ChatbotMarkdown.renderMarkdownFragment === 'function')
              ? window.ChatbotMarkdown.renderMarkdownFragment(text)
              : escapeHtmlSafe(text).replace(/\n/g, '<br>');
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
      case 'video':
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
      case 'file':
        const fileUrl = fullUrl(block.url || '');
        const fileName = block.name || 'Download';
        return '<a href="' + escapeHtmlSafe(fileUrl) + '" target="_blank" rel="noopener noreferrer" class="chatbot-file-link">' + escapeHtmlSafe(fileName) + '</a>';
      default:
        if (val) {
          return (window.ChatbotMarkdown && typeof window.ChatbotMarkdown.renderMarkdownFragment === 'function')
            ? '<div class="markdown">' + window.ChatbotMarkdown.renderMarkdownFragment(val) + '</div>'
            : escapeHtmlSafe(val).replace(/\n/g, '<br>');
        }
        return '';
    }
  }

  /** Render evidence section (image cards with titles). Returns HTML string. */
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

  /** Add Copy, Like, Dislike, Share buttons below the AI message */
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

  /** Build HTML for a video evidence card */
  function buildVideoCard(evidence, addAuthTokenToUrl) {
    const url = addAuthTokenToUrl(evidence.url || '');
    if (!url) return null;

    const card = document.createElement('div');
    card.className = 'chatbot-media-card';

    const label = document.createElement('div');
    label.className   = 'chatbot-media-label';
    label.textContent = buildLabel(evidence);
    card.appendChild(label);

    const video = document.createElement('video');
    video.className = 'chatbot-evidence-video';
    video.controls  = true;
    video.preload   = 'metadata';

    const source = document.createElement('source');
    source.src  = url;
    source.type = 'video/mp4';
    video.appendChild(source);

    video.addEventListener('error', function () {
        card.replaceChild(
        buildErrorPlaceholder('Evidence video unavailable'), video
      );
    });

    card.appendChild(video);

    const tsText = formatTimestamp(evidence.timestamp);
    if (tsText) {
      const ts = document.createElement('div');
      ts.className   = 'chatbot-media-timestamp';
      ts.textContent = tsText;
      card.appendChild(ts);
    }

    return card;
  }


  // ============================================================================
  // SECTION 3: HELPER FUNCTIONS
  // ============================================================================

  function buildLabel(evidence) {
    const icons = { critical: '🔴', warning: '🟡', info: '🔵' };
    const icon  = icons[evidence.severity] || '';
    const label = evidence.label || 'Evidence';
    return icon ? icon + ' ' + label : label;
  }

  function buildErrorPlaceholder(message) {
    const div = document.createElement('div');
    div.className   = 'chatbot-media-error';
    div.textContent = '⚠️ ' + (message || 'Evidence failed to load.');
    return div;
  }

  function openImageLightbox(src, caption) {
    if (!src) return;
    const overlay = document.createElement('div');
    overlay.className = 'chatbot-lightbox-overlay';

    const wrap = document.createElement('div');
    wrap.className = 'chatbot-lightbox-image-wrap';

    const img = document.createElement('img');
    img.className = 'chatbot-lightbox-image';
    img.src       = src;
    img.alt       = caption || '';
    wrap.appendChild(img);

    if (caption) {
      const cap = document.createElement('div');
      cap.className   = 'chatbot-lightbox-caption';
      cap.textContent = caption;
      wrap.appendChild(cap);
    }

    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'chatbot-lightbox-close';
    btn.innerHTML = '&times;';
    btn.addEventListener('click', () => overlay.remove());

    overlay.appendChild(btn);
    overlay.appendChild(wrap);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
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

  /** Returns a function that adds ?token=xxx to URLs for authenticated API calls */
  function buildUrlWithAuthToken() {
    const api     = window.visionAPI;
    const baseUrl = (api?.baseURL || '').replace(/\/$/, '');
    const token   = api?.token ||
      (typeof localStorage !== 'undefined'
        ? localStorage.getItem('visionai_token')
        : null);

    return function withToken(url) {
      if (!url) return '';
      const abs = url.startsWith('http')
        ? url
        : baseUrl + (url.startsWith('/') ? '' : '/') + url;
      if (!token) return abs;
      if (/[?&]token=/.test(abs)) return abs;
      return abs + (abs.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
    };
  }


  // ============================================================================
  // PUBLIC API (exposed on window)
  // ============================================================================

  window.ChatbotAttachments = {
    renderContentBlocksInBubble: renderContentBlocksInBubble,
  };

})();


