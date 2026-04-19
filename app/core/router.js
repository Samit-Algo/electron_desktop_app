const INTERNAL_HTML_RE = /\.html(?:$|[?#])/i;
const PAGE_ROUTE_MAP = new Map([
  ['/pages/dashboard.html', '/app/pages/dashboard/dashboard.html'],
  ['/app/pages/dashboard.html', '/app/pages/dashboard/dashboard.html'],
  ['/pages/cameras-list.html', '/app/pages/cameras/cameras-list.html'],
  ['/app/pages/cameras-list.html', '/app/pages/cameras/cameras-list.html'],
  ['/pages/camera-detail.html', '/app/pages/cameras/camera-detail.html'],
  ['/app/pages/camera-detail.html', '/app/pages/cameras/camera-detail.html'],
  ['/pages/agents-board.html', '/app/pages/agents/agents-list.html'],
  ['/app/pages/agents-board.html', '/app/pages/agents/agents-list.html'],
  ['/pages/agent-detail.html', '/app/pages/agents/agent-detail.html'],
  ['/app/pages/agent-detail.html', '/app/pages/agents/agent-detail.html'],
  ['/pages/workflow-list.html', '/app/pages/workflows/workflow-list.html'],
  ['/app/pages/workflow-list.html', '/app/pages/workflows/workflow-list.html'],
  ['/pages/workflow-editor.html', '/app/pages/workflows/workflow-editor.html'],
  ['/app/pages/workflow-editor.html', '/app/pages/workflows/workflow-editor.html'],
  ['/pages/static-video-library.html', '/app/pages/videos/video-library.html'],
  ['/app/pages/static-video-library.html', '/app/pages/videos/video-library.html'],
  ['/pages/chat.html', '/app/pages/chat/chat.html'],
  ['/app/pages/chat.html', '/app/pages/chat/chat.html'],
  ['/pages/person-gallery.html', '/app/pages/people/person-gallery.html'],
  ['/app/pages/person-gallery.html', '/app/pages/people/person-gallery.html'],
  ['/pages/events-board.html', '/app/pages/events/events.html'],
  ['/app/pages/events-board.html', '/app/pages/events/events.html'],
]);

const isModifiedClick = e =>
  e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

function toAbsoluteUrl(href) {
  try {
    const url = new URL(href, window.location.href);
    const mapped = PAGE_ROUTE_MAP.get(url.pathname);
    if (mapped) url.pathname = mapped;
    return url.href;
  } catch { return null; }
}

function copyAttributes(source, target) {
  Array.from(source.attributes).forEach(attr => target.setAttribute(attr.name, attr.value));
}

function absolutizeResourceUrls(root, pageUrl) {
  if (!root || !pageUrl) return;
  const attrs = ['src', 'href', 'data-src', 'data-href', 'poster'];
  const isSkippable = value =>
    !value ||
    value.startsWith('#') ||
    value.startsWith('mailto:') ||
    value.startsWith('tel:') ||
    value.startsWith('javascript:') ||
    /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value) ||
    value.startsWith('//');

  root.querySelectorAll('*').forEach(el => {
    attrs.forEach(attr => {
      const raw = el.getAttribute(attr);
      if (isSkippable(raw)) return;
      try {
        const abs = new URL(raw, pageUrl).href;
        el.setAttribute(attr, abs);
      } catch {
        // ignore malformed URLs
      }
    });
  });
}

function ensureCompanionAssets(root, pageUrl) {
  if (!root || !pageUrl) return;
  let url;
  try { url = new URL(pageUrl, window.location.href); } catch { return; }
  if (!url.pathname.endsWith('.html')) return;

  const cssHref = new URL(url.pathname.replace(/\.html$/, '.css'), url.origin).href;
  const jsSrc = new URL(url.pathname.replace(/\.html$/, '.js'), url.origin).href;

  const hasCss = Array.from(root.querySelectorAll('link[rel="stylesheet"][href]'))
    .some(link => {
      try { return new URL(link.getAttribute('href'), pageUrl).href === cssHref; } catch { return false; }
    });
  const hasJs = Array.from(root.querySelectorAll('script[src]'))
    .some(script => {
      try { return new URL(script.getAttribute('src'), pageUrl).href === jsSrc; } catch { return false; }
    });

  if (!hasCss) {
    const link = document.createElement('link');
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('href', cssHref);
    root.insertBefore(link, root.firstChild);
  }
  if (!hasJs) {
    const script = document.createElement('script');
    script.setAttribute('type', 'module');
    script.setAttribute('src', jsSrc);
    root.appendChild(script);
  }
}

function getPageDepth() {
  const parts = window.location.pathname.split('/').filter(p => p && p !== 'index.html');
  return parts.filter(p => !p.endsWith('.html')).length;
}

function fixRelativePaths(element, pageDepth) {
  ['src', 'href', 'data-src', 'data-href'].forEach(attr => {
    const value = element.getAttribute(attr);
    if (value && value.startsWith('../')) {
      const currentDepth = (value.match(/\.\.\//g) || []).length;
      if (pageDepth > currentDepth) {
        const pathAfterDots = value.replace(/^\.\.+\//, '');
        element.setAttribute(attr, '../'.repeat(pageDepth) + pathAfterDots);
      }
    }
  });
  Array.from(element.children).forEach(child => fixRelativePaths(child, pageDepth));
}

async function executeInjectedScripts(root) {
  if (!root) return;
  const pageDepth = getPageDepth();
  const scripts = Array.from(root.querySelectorAll('script'))
    .filter(s => s.getAttribute('data-layout-loader-executed') !== 'true');
  if (!scripts.length) return;

  for (const oldScript of scripts) {
    try {
      const newScript = document.createElement('script');
      copyAttributes(oldScript, newScript);
      newScript.setAttribute('data-layout-loader-injected', 'true');
      newScript.setAttribute('data-layout-loader-executed', 'true');

      const oldType = (oldScript.getAttribute('type') || '').trim().toLowerCase();
      const isExecutable = !oldType || oldType === 'text/javascript' || oldType === 'application/javascript' || oldType === 'module';
      if (!isExecutable) newScript.removeAttribute('type');

      if (oldScript.src) {
        newScript.setAttribute('src', oldScript.getAttribute('src'));
        fixRelativePaths(newScript, pageDepth);
        const src = newScript.getAttribute('src');
        if (document.querySelector(`script[src="${CSS.escape(src)}"]`)) {
          oldScript.parentNode?.removeChild(oldScript);
          continue;
        }
        await new Promise((resolve, reject) => {
          newScript.onload = resolve;
          newScript.onerror = () => reject(new Error(`Failed to load injected script: ${src}`));
          if (oldScript.parentNode) { oldScript.parentNode.insertBefore(newScript, oldScript); oldScript.parentNode.removeChild(oldScript); }
          else document.body.appendChild(newScript);
        });
      } else {
        newScript.textContent = oldScript.textContent;
        if (oldScript.parentNode) { oldScript.parentNode.insertBefore(newScript, oldScript); oldScript.parentNode.removeChild(oldScript); }
        else document.body.appendChild(newScript);
      }
    } catch (error) {
      console.warn('Injected script execution error:', error);
    }
  }
}

function normalizeInternalLinks(root = document) {
  root.querySelectorAll('a[href]').forEach(a => {
    const raw = a.getAttribute('href');
    if (!raw) return;
    if (raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) return;
    if (a.hasAttribute('download') || a.target === '_blank') return;
    if (!INTERNAL_HTML_RE.test(raw)) return;
    const abs = toAbsoluteUrl(raw);
    if (!abs) return;
    if (new URL(abs).origin !== window.location.origin) return;
    if (!a.dataset.originalHref) a.dataset.originalHref = raw;
    a.setAttribute('href', abs);
  });
}

function updateActiveNav() {
  const currentPath = window.location.pathname;
  document.querySelectorAll('.navbar-vertical .nav-link[href]').forEach(link => {
    try {
      const linkPath = new URL(link.getAttribute('href'), window.location.href).pathname;
      const isActive = linkPath === currentPath;
      link.classList.toggle('active', isActive);
      if (isActive) {
        const parentCollapse = link.closest('.collapse');
        if (parentCollapse) {
          parentCollapse.classList.add('show');
          document.querySelector(`[href="#${parentCollapse.id}"][data-bs-toggle="collapse"]`)?.setAttribute('aria-expanded', 'true');
        }
      }
    } catch { /* ignore */ }
  });
}

function reInitDynamicUi(root = document) {
  if (typeof feather !== 'undefined') feather.replace();
  if (typeof bootstrap !== 'undefined') {
    root.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => new bootstrap.Tooltip(el));
    root.querySelectorAll('[data-bs-toggle="popover"]').forEach(el => new bootstrap.Popover(el));
  }
}

async function loadPage(url, { push = true } = {}) {
  try {
    if (typeof window.__visionaiPageCleanup === 'function') window.__visionaiPageCleanup();
  } catch (e) {
    console.warn('Page cleanup error:', e);
  } finally {
    window.__visionaiPageCleanup = null;
  }

  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load page: ${url}`);

  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const nextPageContent = doc.querySelector('#page-content');

  const title = doc.querySelector('title')?.textContent?.trim();
  if (title) document.title = title;

  const viewport = document.querySelector('.viewport-scrolls');
  if (!viewport) throw new Error('No .viewport-scrolls container found');

  // Remove previously injected per-page assets from <head>.
  document
    .querySelectorAll('link[data-vision-page-asset="true"], style[data-vision-page-asset="true"]')
    .forEach(el => el.remove());

  while (viewport.firstChild) viewport.removeChild(viewport.firstChild);

  const tmp = document.createElement('div');
  if (nextPageContent) {
    tmp.innerHTML = nextPageContent.innerHTML;
  } else {
    // Support module-style fragment pages that do not include #page-content.
    tmp.innerHTML = html;
  }
  ensureCompanionAssets(tmp, url);
  absolutizeResourceUrls(tmp, url);

  // Move page-level styles to <head> so CSS always applies in SPA mode.
  const pageHeadAssets = [];
  tmp.querySelectorAll('link[rel="stylesheet"], style').forEach(el => {
    pageHeadAssets.push(el.cloneNode(true));
    el.remove();
  });
  pageHeadAssets.forEach(el => {
    el.setAttribute('data-vision-page-asset', 'true');
    document.head.appendChild(el);
  });

  while (tmp.firstChild) viewport.appendChild(tmp.firstChild);

  await executeInjectedScripts(viewport);

  if (push) history.pushState({ url }, '', url);

  normalizeInternalLinks(document);
  reInitDynamicUi(viewport);
  viewport.scrollTop = 0;
  updateActiveNav();

  try { window.dispatchEvent(new CustomEvent('vision:spa:navigated', { detail: { url } })); } catch { /* ignore */ }
}

function bindGlobalReloadButton() {
  const btn = document.getElementById('reload-cameras-btn');
  if (!btn || btn.getAttribute('data-visionai-reload-bound') === 'true') return;
  btn.setAttribute('data-visionai-reload-bound', 'true');
  btn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    loadPage(window.location.href, { push: false }).catch(err => console.error('SPA reload error:', err));
  });
}

export function navigate(href, { push = true } = {}) {
  const abs = toAbsoluteUrl(href);
  if (!abs) return;
  const nextUrl = new URL(abs);
  if (nextUrl.origin !== window.location.origin) return;
  if (!INTERNAL_HTML_RE.test(nextUrl.pathname + nextUrl.search + nextUrl.hash)) return;
  return loadPage(nextUrl.href, { push });
}

export function initRouter() {
  normalizeInternalLinks(document);
  updateActiveNav();
  bindGlobalReloadButton();

  document.addEventListener('click', e => {
    if (isModifiedClick(e)) return;
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || !INTERNAL_HTML_RE.test(href)) return;
    const abs = toAbsoluteUrl(href);
    if (!abs) return;
    const nextUrl = new URL(abs);
    if (nextUrl.origin !== window.location.origin) return;
    if (a.dataset.bsToggle) return;
    e.preventDefault();
    loadPage(nextUrl.href).catch(err => console.error('SPA navigation error:', err));
  });

  window.addEventListener('popstate', e => {
    const url = e.state?.url || window.location.href;
    loadPage(url, { push: false }).catch(err => console.error('SPA navigation error:', err));
  });

}
