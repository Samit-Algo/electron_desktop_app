// Markdown rendering and streaming utilities module for chatbot messages

(function () {
  'use strict';

  // Module dependencies injected from chatbot-core.js
  let messagesEl = null;
  let escapeHtml = null;

  // Generate root-relative vendor path for script loading
  function vendorPath(relFromVendors) {
    return new URL('/vendors/' + relFromVendors, window.location.origin).toString();
  }

  // Load external script once, preventing duplicate loads
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

  // Load markdown parsing libraries (marked.js and DOMPurify) if not already loaded
  function ensureMarkdownDeps() {
    if (window.marked && window.DOMPurify) return Promise.resolve();
    const markedSrc = vendorPath('marked/marked.min.js');
    const purifySrc = vendorPath('dompurify/purify.min.js');
    return loadScriptOnce(markedSrc)
      .then(() => loadScriptOnce(purifySrc))
      .catch((e) => {
        console.warn('Markdown deps load failed:', e);
      });
  }

  // Sanitize markdown text for safe streaming rendering (prevents broken syntax from causing errors)
  function safeMarkdownForStreaming(text) {
    let t = String(text || '');

    // Replace incomplete mermaid diagram blocks with placeholder during streaming
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
        if (lineEnd === -1) {
          out += placeholder;
          i = src.length;
          break;
        }
        let close = src.indexOf('\n```', lineEnd + 1);
        while (close !== -1) {
          const after = close + 4;
          if (after >= src.length) break;
          const ch = src[after];
          if (ch === '\n') break;
          if (ch === '\r' && src[after + 1] === '\n') break;
          close = src.indexOf('\n```', close + 1);
        }
        if (close === -1) {
          out += placeholder;
          i = src.length;
          break;
        }
        out += placeholder;
        i = close + 4;
        if (src[i] === '\r' && src[i + 1] === '\n') i += 2;
        else if (src[i] === '\n') i += 1;
      }
      out += src.slice(i);
      t = out;
    })();

    // Break incomplete code fences to prevent markdown parsing errors
    const fence = '```';
    const fenceCount = (t.match(/```/g) || []).length;
    if (fenceCount % 2 === 1) {
      const last = t.lastIndexOf(fence);
      if (last !== -1) {
        const brokenFence = '``\u200b`';
        t = t.slice(0, last) + brokenFence + t.slice(last + fence.length);
      }
    }

    // Escape incomplete tables at end of stream to prevent broken rendering
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
          if (rowRe.test(prev) || sepRe.test(prev)) {
            tableStart -= 1;
            continue;
          }
          break;
        }
        let tableEnd = sepLineIdx;
        while (tableEnd + 1 < lines.length) {
          const nxt = lines[tableEnd + 1] || '';
          if (nxt.trim() === '') break;
          if (rowRe.test(nxt) || sepRe.test(nxt)) {
            tableEnd += 1;
            continue;
          }
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
    } catch (_) { }

    return t;
  }

  // Update assistant message text during streaming with markdown rendering
  function updateAssistantPendingText(pendingId, text) {
    const node = messagesEl?.querySelector?.(`[data-chatbot-pending="${pendingId}"]`);
    if (!node) return;
    const bubble = node.querySelector?.('div');
    if (!bubble) return;

    // Batch DOM updates using requestAnimationFrame to avoid excessive renders
    bubble._streamAccumulatedText = String(text || '');
    if (bubble._streamRaf) return;

    bubble._streamRaf = requestAnimationFrame(() => {
      bubble._streamRaf = null;
      const msg = bubble._streamAccumulatedText || '';
      const safe = safeMarkdownForStreaming(msg);
      if (safe === bubble._lastStreamSafeText) return;
      bubble._lastStreamSafeText = safe;

      // Apply normal styling (not error state) during streaming
      bubble.classList.remove('bg-danger', 'text-white');
      bubble.classList.add('bg-body-secondary', 'markdown-content');

      try {
        // Render markdown if libraries are available, otherwise fallback to plain text
        if (window.marked && window.DOMPurify && typeof window.marked.parse === 'function') {
          const allowedTags = ['p', 'br', 'strong', 'em', 'u', 's', 'code', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'a', 'hr', 'div'];
          let rawHtml = '';
          try {
            rawHtml = window.marked.parse(safe);
          } catch (_) {
            rawHtml = escapeHtml(safe).replace(/\n/g, '<br>');
          }
          const cleanHtml = window.DOMPurify.sanitize(rawHtml, {
            ALLOWED_TAGS: allowedTags,
            ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class', 'style'],
            KEEP_CONTENT: true
          });
          bubble.innerHTML = cleanHtml;
          // Make all links open in new tab with security attributes
          bubble.querySelectorAll?.('a[href]')?.forEach(a => {
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
          });
        } else {
          // Fallback: render as escaped HTML with line breaks
          bubble.innerHTML = escapeHtml(safe).replace(/\n/g, '<br>');
        }
      } catch (_) {
        bubble.innerHTML = escapeHtml(safe).replace(/\n/g, '<br>');
      }
    });
  }

  // Replace pending assistant message with final rendered markdown after streaming completes
  function replaceAssistantPending(pendingId, text, isError = false) {
    const node = messagesEl?.querySelector?.(`[data-chatbot-pending="${pendingId}"]`);
    if (!node) return;
    const bubble = node.querySelector?.('div');
    if (!bubble) return;
    const msg = text || '';

    // Handle error state: plain text with error styling
    if (isError) {
      bubble.textContent = msg;
      bubble.classList.remove('bg-body-secondary');
      bubble.classList.add('bg-danger', 'text-white');
      return;
    }

    // Apply markdown content styling
    bubble.classList.add('markdown-content');

    // Extract mermaid blocks (currently returns unchanged text, placeholder for future diagram support)
    function extractMermaidBlocks(markdownText) {
      const src = String(markdownText || '');
      return { markdown: src, diagrams: [] };
    }

    const extracted = extractMermaidBlocks(msg);
    const msgWithoutFlow = extracted.markdown;

    // Render final markdown HTML with full feature support
    try {
      if (window.marked && window.DOMPurify) {
        const allowedTags = ['p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'a', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div'];
        let rawHtml;
        try {
          if (window.marked && typeof window.marked.parse === 'function') {
            rawHtml = window.marked.parse(msgWithoutFlow);
          } else {
            rawHtml = msgWithoutFlow;
          }
        } catch (e) {
          console.warn('Markdown parsing failed:', e);
          rawHtml = msgWithoutFlow;
        }
        const cleanHtml = window.DOMPurify.sanitize(rawHtml, {
          ALLOWED_TAGS: allowedTags,
          ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'id', 'style', 'type', 'class'],
          KEEP_CONTENT: true,
          ADD_ATTR: ['id', 'style', 'class']
        });
        bubble.innerHTML = cleanHtml;
        // Make all links open in new tab with security attributes
        bubble.querySelectorAll?.('a[href]')?.forEach(a => {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
        });

        // Add action buttons (copy, like, dislike, share, refresh, more) after message content
        const actionsHtml = `
          <div class="ai-message-actions mt-2">
            <button type="button" title="Copy" onclick="navigator.clipboard.writeText(this.closest('.d-flex').querySelector('.ai-message-transparent').textContent.trim()).then(() => console.log('Copied'))">
              <span class="far fa-copy"></span>
            </button>
            <button type="button" title="Like" onclick="console.log('Like clicked')">
              <span class="far fa-thumbs-up"></span>
            </button>
            <button type="button" title="Dislike" onclick="console.log('Dislike clicked')">
              <span class="far fa-thumbs-down"></span>
            </button>
            <button type="button" title="Share" onclick="console.log('Share clicked')">
              <span class="fas fa-share-alt"></span>
            </button>
            <button type="button" title="Refresh" onclick="console.log('Refresh clicked')">
              <span class="fas fa-redo-alt"></span>
            </button>
            <button type="button" title="More" onclick="console.log('More clicked')">
              <span class="fas fa-ellipsis-h"></span>
            </button>
          </div>
        `;
        node.insertAdjacentHTML('beforeend', actionsHtml);
      } else {
        // Fallback: plain text if markdown libraries not loaded
        bubble.textContent = msg;
      }
    } catch (e) {
      console.warn('Markdown render failed:', e);
      bubble.textContent = msg;
    }
  }

  // Initialize module with dependencies from chatbot-core.js
  function init(deps) {
    messagesEl = deps.messagesEl;
    escapeHtml = deps.escapeHtml;
    // Proactively load markdown dependencies on initialization
    ensureMarkdownDeps();
  }

  // Expose public API
  window.ChatbotMarkdown = {
    init: init,
    ensureMarkdownDeps: ensureMarkdownDeps,
    replaceAssistantPending: replaceAssistantPending,
    updateAssistantPendingText: updateAssistantPendingText,
    safeMarkdownForStreaming: safeMarkdownForStreaming
  };

  // Auto-initialize if dependencies were stashed before module loaded
  if (window.ChatbotMarkdownPendingDeps) {
    try {
      init(window.ChatbotMarkdownPendingDeps);
    } catch (e) {
      console.error('[ChatbotMarkdown] Init failed:', e);
    }
    window.ChatbotMarkdownPendingDeps = null;
  }
})();
