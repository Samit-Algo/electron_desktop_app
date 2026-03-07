(function () {
  'use strict';

  // ── Entry point ───────────────────────────────────────

  /**
   * Render ordered content blocks into the pending bubble.
   * Supports:
   * - Agent API: { type: 'text'|'image'|'video'|'file', text?, url?, name?, metadata? }
   * - General Chat: { type: 'text'|'markdown'|'image'|'table'|'chart'|'code'|'diagram', value?, url?, caption?, columns?, rows? }
   * @param {string} pendingId - Pending bubble data attribute value
   * @param {Array} contentBlocks - message.content array
   * @param {boolean} isError - Whether response indicates error
   * @param {Array} [evidence] - Optional message.evidence for media cards
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

    const withToken = _buildWithToken();

    // Error: single text block
    const firstBlock = contentBlocks?.[0];
    const firstText = (firstBlock?.type === 'text' || firstBlock?.type === 'markdown')
      ? (firstBlock.value ?? firstBlock.text ?? '')
      : '';
    if (isError && contentBlocks?.length === 1 && firstText !== undefined) {
      bubble.textContent = firstText;
      bubble.classList.remove('bg-body-secondary', 'markdown-content');
      bubble.classList.add('bg-danger', 'text-white');
      _appendActions(node);
      return;
    }

    bubble.classList.remove('bg-danger', 'text-white');
    bubble.classList.add('bg-body-secondary', 'markdown-content');
    bubble.innerHTML = '';

    // Render content blocks (agent + general chat)
    for (let i = 0; i < (contentBlocks || []).length; i++) {
      const block = contentBlocks[i];
      if (!block || !block.type) continue;
      const html = _renderBlock(block, withToken);
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
      const evidenceHtml = _renderEvidence(evidence, withToken);
      if (evidenceHtml) {
        const wrap = document.createElement('div');
        wrap.className = 'chat-evidence';
        wrap.innerHTML = evidenceHtml;
        bubble.appendChild(wrap);
      }
    }

    _appendActions(node);
  }

  function _escapeHtml(s) {
    if (s == null) return '';
    const div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
  }

  /** Render a single block (agent or general chat format). Returns HTML string. */
  function _renderBlock(block, withToken) {
    const val = block.value ?? block.text ?? '';
    const fullUrl = function (url) {
      if (!url) return '';
      return withToken(url);
    };

    switch (block.type) {
      case 'text':
        return (window.ChatbotMarkdown && typeof window.ChatbotMarkdown.renderMarkdownFragment === 'function')
          ? window.ChatbotMarkdown.renderMarkdownFragment(val)
          : _escapeHtml(val).replace(/\n/g, '<br>');
      case 'markdown':
        return (window.ChatbotMarkdown && typeof window.ChatbotMarkdown.renderMarkdownFragment === 'function')
          ? '<div class="markdown">' + window.ChatbotMarkdown.renderMarkdownFragment(val) + '</div>'
          : '<div class="markdown">' + _escapeHtml(val).replace(/\n/g, '<br>') + '</div>';
      case 'image':
        if (!block.url) return '';
        const caption = block.caption || (block.metadata && block.metadata.label) || '';
        const imgUrl = fullUrl(block.url);
        return '<div class="evidence-card image-block-card"><img src="' + _escapeHtml(imgUrl) + '" alt="' + _escapeHtml(caption) + '" loading="lazy" />' + (caption ? '<p>' + _escapeHtml(caption) + '</p>' : '') + '</div>';
      case 'table':
        if (!block.columns || !block.columns.length) return '';
        const header = block.columns.map(function (c) { return '<th>' + _escapeHtml(c) + '</th>'; }).join('');
        const rows = (block.rows || []).map(function (row) {
          const cells = row.map(function (cell) {
            var cellObj = cell;
            if (typeof cell === 'string' && cell.trim().indexOf('{') === 0) {
              try {
                cellObj = JSON.parse(cell);
              } catch (_) {}
            }
            if (typeof cellObj === 'object' && cellObj && cellObj.type === 'image' && cellObj.url) {
              return '<td><img src="' + _escapeHtml(fullUrl(cellObj.url)) + '" alt="' + _escapeHtml(cellObj.caption || '') + '" loading="lazy" /></td>';
            }
            var text = String(cell ?? '');
            text = text.replace(/\\n/g, '\n');
            var cellHtml = (window.ChatbotMarkdown && typeof window.ChatbotMarkdown.renderMarkdownFragment === 'function')
              ? window.ChatbotMarkdown.renderMarkdownFragment(text)
              : _escapeHtml(text).replace(/\n/g, '<br>');
            return '<td class="chatbot-table-cell-markdown"><div class="markdown-content">' + cellHtml + '</div></td>';
          }).join('');
          return '<tr>' + cells + '</tr>';
        }).join('');
        return '<table class="chatbot-table"><thead><tr>' + header + '</tr></thead><tbody>' + rows + '</tbody></table>';
      case 'chart':
        return '<div class="chart-block" data-chart-type="' + _escapeHtml(block.chart_type || '') + '" data-labels=\'' + _escapeHtml(JSON.stringify(block.labels || [])) + '\' data-values=\'' + _escapeHtml(JSON.stringify(block.values || [])) + '\'></div>';
      case 'code':
        return '<pre><code class="language-' + _escapeHtml(block.language || '') + '">' + _escapeHtml(val) + '</code></pre>';
      case 'diagram':
        return '<div class="mermaid">' + _escapeHtml(val) + '</div>';
      case 'video':
        const vidEvidence = {
          type: 'video',
          url: block.url,
          label: (block.metadata && block.metadata.label) || 'Video',
          timestamp: block.metadata && block.metadata.timestamp,
          ...(block.metadata || {})
        };
        const videoCard = _buildVideoCard(vidEvidence, withToken);
        if (!videoCard) return '';
        const vWrap = document.createElement('div');
        vWrap.appendChild(videoCard);
        return vWrap.innerHTML;
      case 'file':
        const fileUrl = fullUrl(block.url || '');
        const fileName = block.name || 'Download';
        return '<a href="' + _escapeHtml(fileUrl) + '" target="_blank" rel="noopener noreferrer" class="chatbot-file-link">' + _escapeHtml(fileName) + '</a>';
      default:
        if (val) {
          return (window.ChatbotMarkdown && typeof window.ChatbotMarkdown.renderMarkdownFragment === 'function')
            ? '<div class="markdown">' + window.ChatbotMarkdown.renderMarkdownFragment(val) + '</div>'
            : _escapeHtml(val).replace(/\n/g, '<br>');
        }
        return '';
    }
  }

  /** Render evidence cards. Returns HTML string. */
  function _renderEvidence(evidence, withToken) {
    if (!evidence || !evidence.length) return '';
    const fullUrl = function (url) {
      if (!url) return '';
      return withToken(url);
    };
    return evidence.map(function (e) {
      if (!e || e.type !== 'image' || !e.url) return '';
      const url = fullUrl(e.url);
      const title = e.title ? '<h4>' + _escapeHtml(e.title) + '</h4>' : '';
      const desc = e.description ? '<p>' + _escapeHtml(e.description) + '</p>' : '';
      return '<div class="evidence-card"><img src="' + _escapeHtml(url) + '" alt="' + _escapeHtml(e.title || '') + '" />' + title + desc + '</div>';
    }).filter(Boolean).join('');
  }

  function _appendActions(node) {
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

  function _buildVideoCard(evidence, withToken) {
    const url = withToken(evidence.url || '');
    if (!url) return null;

    const card = document.createElement('div');
    card.className = 'chatbot-media-card';

    const label = document.createElement('div');
    label.className   = 'chatbot-media-label';
    label.textContent = _buildLabel(evidence);
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
        _buildErrorPlaceholder('Evidence video unavailable'), video
      );
    });

    card.appendChild(video);

    const tsText = _formatTimestamp(evidence.timestamp);
    if (tsText) {
      const ts = document.createElement('div');
      ts.className   = 'chatbot-media-timestamp';
      ts.textContent = tsText;
      card.appendChild(ts);
    }

    return card;
  }


  // ── Helpers ───────────────────────────────────────────

  function _buildLabel(evidence) {
    const icons = { critical: '🔴', warning: '🟡', info: '🔵' };
    const icon  = icons[evidence.severity] || '';
    const label = evidence.label || 'Evidence';
    return icon ? icon + ' ' + label : label;
  }

  function _buildErrorPlaceholder(message) {
    const div = document.createElement('div');
    div.className   = 'chatbot-media-error';
    div.textContent = '⚠️ ' + (message || 'Evidence failed to load.');
    return div;
  }

  function _openLightbox(src, caption) {
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

  function _formatTimestamp(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return [d.getHours(), d.getMinutes(), d.getSeconds()]
        .map(n => String(n).padStart(2, '0'))
        .join(':');
    } catch (_) { return ''; }
  }

  function _buildWithToken() {
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


  // ── Public API ────────────────────────────────────────

  window.ChatbotAttachments = {
    renderContentBlocksInBubble: renderContentBlocksInBubble,
  };

})();


