/**
 * Layout Loader - Dynamically loads shared layout from side_navbar.html
 * and injects page-specific content
 */

(function() {
    'use strict';

    // Configuration
    // Detect if running in Electron (has localhost server) or regular browser
    const isElectron = window.location.protocol === 'http:' && window.location.hostname === '127.0.0.1';
    const LAYOUT_PATH = isElectron 
        ? '/layout/side_navbar.html'  // Absolute path for Electron local server
        : '../layout/side_navbar.html';  // Relative path for regular browser
    const CONTENT_SELECTOR = '#page-content'; // ID of the content container in each page
    const CONTENT_INSERT_SELECTOR = 'main.main'; // Where to insert content in the layout

    /**
     * Parse HTML string and extract elements
     */
    function parseHTML(htmlString) {
        const parser = new DOMParser();
        return parser.parseFromString(htmlString, 'text/html');
    }

    /**
     * Copy attributes from source element to target element
     */
    function copyAttributes(source, target) {
        Array.from(source.attributes).forEach(attr => {
            target.setAttribute(attr.name, attr.value);
        });
    }

    /**
     * Copy HTML element attributes (CRITICAL for Phoenix CSS)
     */
    function copyHtmlAttributes(layoutDoc) {
        const layoutHtml = layoutDoc.documentElement;
        const currentHtml = document.documentElement;
        
        // Copy all attributes from layout's <html> tag
        copyAttributes(layoutHtml, currentHtml);
    }

    /**
     * Calculate page depth (how many levels deep from root)
     * pages/dashboard.html = 1 level (needs ../ to reach root)
     * pages/settings/general.html = 2 levels (needs ../../ to reach root)
     */
    function getPageDepth() {
        const path = window.location.pathname;
        // Remove leading slash and split
        const parts = path.split('/').filter(p => p && p !== 'index.html');
        
        // Remove the HTML file itself, count only directories
        const directories = parts.filter(p => !p.endsWith('.html'));
        
        // Count how many directories deep we are from root
        return directories.length;
    }

    /**
     * Fix relative paths in an element based on page depth
     * Layout file uses ../assets/ (because layout is at layout/ = 1 level deep)
     * When injected into pages/dashboard.html (1 level deep): ../assets/ works
     * When injected into pages/settings/general.html (2 levels deep): needs ../../assets/
     */
    function fixRelativePaths(element, pageDepth) {
        // Attributes that may contain relative paths
        const pathAttributes = ['src', 'href', 'data-src', 'data-href'];
        
        pathAttributes.forEach(attr => {
            const value = element.getAttribute(attr);
            if (value && value.startsWith('../')) {
                // Count how many ../ are in the current path
                const currentDepth = (value.match(/\.\.\//g) || []).length;
                
                // Layout assumes it's 1 level deep (layout/), so it uses ../ to reach root
                // If our page is N levels deep, we need N ../ to reach root
                if (pageDepth > currentDepth) {
                    // Replace with correct number of ../
                    const pathAfterDots = value.replace(/^\.\.+\//, '');
                    const newValue = '../'.repeat(pageDepth) + pathAfterDots;
                    element.setAttribute(attr, newValue);
                }
            }
        });
        
        // Recursively fix child elements
        Array.from(element.children).forEach(child => {
            fixRelativePaths(child, pageDepth);
        });
    }

    /**
     * Load a single script and return a promise (for head scripts)
     */
    function loadHeadScript(script) {
        return new Promise((resolve, reject) => {
            const newScript = document.createElement('script');
            copyAttributes(script, newScript);

            if (script.src) {
                // External script - wait for it to load
                newScript.onload = () => resolve();
                newScript.onerror = () => reject(new Error(`Failed to load script: ${script.src}`));
                newScript.src = script.src;
                document.head.appendChild(newScript);
            } else {
                // Inline script - check if it depends on other scripts
                const scriptText = script.textContent;
                
                // If script uses window.config, wait for config.js to load
                if (scriptText.includes('window.config')) {
                    const checkConfig = setInterval(() => {
                        if (typeof window.config !== 'undefined' && window.config.config) {
                            clearInterval(checkConfig);
                            newScript.textContent = scriptText;
                            document.head.appendChild(newScript);
                            resolve();
                        }
                    }, 10);
                    
                    // Timeout after 5 seconds
                    setTimeout(() => {
                        clearInterval(checkConfig);
                        if (typeof window.config === 'undefined') {
                            console.warn('window.config not available, skipping inline script');
                            resolve(); // Resolve anyway to continue
                        }
                    }, 5000);
                } else {
                    // No dependencies, execute immediately
                    newScript.textContent = scriptText;
                    document.head.appendChild(newScript);
                    resolve();
                }
            }
        });
    }

    /**
     * Load and inject head content
     */
    async function injectHead(layoutDoc) {
        const layoutHead = layoutDoc.head;
        const currentHead = document.head;
        
        // Calculate page depth for path fixing
        const pageDepth = getPageDepth();

        // Separate scripts from other elements
        const scripts = [];
        const otherElements = [];

        Array.from(layoutHead.children).forEach(element => {
            const tagName = element.tagName.toLowerCase();
            
            // Skip title if page has its own
            if (tagName === 'title' && document.querySelector('title')) {
                return;
            }

            if (tagName === 'script') {
                scripts.push(element);
            } else {
                otherElements.push(element);
            }
        });

        // First, inject all non-script elements (CSS, meta, etc.)
        otherElements.forEach(element => {
            const clone = element.cloneNode(true);
            // Fix relative paths before appending
            fixRelativePaths(clone, pageDepth);
            currentHead.appendChild(clone);
        });

        // Then, load scripts sequentially
        for (const script of scripts) {
            try {
                // Fix relative paths in script src
                fixRelativePaths(script, pageDepth);
                await loadHeadScript(script);
            } catch (error) {
                console.warn('Head script loading error:', error);
            }
        }
    }

    /**
     * Save chatbot state before clearing body
     */
    function saveChatbotState() {
        const chatbotOffcanvas = document.getElementById('chatbot-offcanvas');
        if (chatbotOffcanvas) {
            const isOpen = chatbotOffcanvas.classList.contains('show');
            localStorage.setItem('chatbotOpen', isOpen ? 'true' : 'false');
            
            // Also save the current width
            if (isOpen) {
                const currentWidth = parseInt(window.getComputedStyle(chatbotOffcanvas).width, 10);
                if (currentWidth && !isNaN(currentWidth)) {
                    localStorage.setItem('chatbotWidth', currentWidth.toString());
                }
            }
        }
    }

    /**
     * Restore chatbot state after layout loads
     */
    function restoreChatbotState() {
        const chatbotOffcanvas = document.getElementById('chatbot-offcanvas');
        if (chatbotOffcanvas) {
            const wasOpen = localStorage.getItem('chatbotOpen') === 'true';
            const savedWidth = localStorage.getItem('chatbotWidth');
            
            if (wasOpen) {
                // Restore width first if available
                if (savedWidth) {
                    const width = parseInt(savedWidth, 10);
                    if (width && !isNaN(width) && width >= 300 && width <= 1200) {
                        chatbotOffcanvas.style.width = width + 'px';
                    }
                }
                
                // Wait for Bootstrap and all scripts to be ready
                const tryRestore = () => {
                    if (typeof bootstrap !== 'undefined' && bootstrap.Offcanvas) {
                        try {
                            // Get or create offcanvas instance
                            let offcanvasInstance = bootstrap.Offcanvas.getInstance(chatbotOffcanvas);
                            if (!offcanvasInstance) {
                                offcanvasInstance = new bootstrap.Offcanvas(chatbotOffcanvas, {
                                    backdrop: false,
                                    scroll: true
                                });
                            }
                            // Show the offcanvas
                            offcanvasInstance.show();
                            console.log('Chatbot state restored: opened');
                        } catch (error) {
                            console.warn('Error restoring chatbot state:', error);
                        }
                    } else {
                        // Bootstrap not ready yet, try again
                        setTimeout(tryRestore, 100);
                    }
                };
                
                // Start trying to restore after a short delay
                setTimeout(tryRestore, 500);
            }
        }
    }

    /**
     * Load and inject body structure
     */
    function injectBody(layoutDoc) {
        const layoutBody = layoutDoc.body;
        const currentBody = document.body;
        
        // Calculate page depth for path fixing
        const pageDepth = getPageDepth();

        // Get page content before clearing body
        const contentContainer = document.querySelector(CONTENT_SELECTOR);
        const contentHTML = contentContainer ? contentContainer.innerHTML : '';

        // CRITICAL: Save chatbot state before clearing body
        saveChatbotState();

        // Clear current body
        currentBody.innerHTML = '';

        // Copy all body content from layout (but NOT scripts yet)
        Array.from(layoutBody.children).forEach(element => {
            // Skip scripts - we'll load them separately in correct order
            if (element.tagName.toLowerCase() !== 'script') {
                const clone = element.cloneNode(true);
                // Fix relative paths before appending
                fixRelativePaths(clone, pageDepth);
                currentBody.appendChild(clone);
            }
        });

        // Find the main content area and inject page content
        const mainElement = document.querySelector(CONTENT_INSERT_SELECTOR);
        if (mainElement && contentHTML) {
            // New structure: page content should always go into the scroll viewport
            const viewportContainer = mainElement.querySelector('.viewport-scrolls');

            // IMPORTANT: Don't wrap in .content again - pages already include it
            const contentContainer = document.createElement('div');
            contentContainer.innerHTML = contentHTML;

            if (viewportContainer) {
                // Append page content into the viewport
                while (contentContainer.firstChild) {
                    viewportContainer.appendChild(contentContainer.firstChild);
                }
            } else {
                // Fallback (older layout): try after top navbar if present, else append to main
                const topNavbar = mainElement.querySelector('.navbar-top');
                if (topNavbar && topNavbar.nextSibling) {
                    while (contentContainer.firstChild) {
                        mainElement.insertBefore(contentContainer.firstChild, topNavbar.nextSibling);
                    }
                } else {
                    while (contentContainer.firstChild) {
                        mainElement.appendChild(contentContainer.firstChild);
                    }
                }
            }
        }
    }

    /**
     * Load a single script and return a promise
     */
    function loadScript(script) {
        return new Promise((resolve, reject) => {
            const newScript = document.createElement('script');
            copyAttributes(script, newScript);

            if (script.src) {
                // External script
                newScript.onload = () => resolve();
                newScript.onerror = () => reject(new Error(`Failed to load script: ${script.src}`));
                newScript.src = script.src;
                document.body.appendChild(newScript);
            } else {
                // Inline script
                newScript.textContent = script.textContent;
                document.body.appendChild(newScript);
                // Inline scripts execute immediately
                resolve();
            }
        });
    }

    /**
     * Load and execute scripts from layout body ONLY (head scripts already loaded)
     * Load sequentially to maintain order
     */
    async function loadScripts(layoutDoc) {
        // Calculate page depth for path fixing
        const pageDepth = getPageDepth();
        
        // Only get scripts from body (head scripts are already injected)
        const scripts = Array.from(layoutDoc.body.querySelectorAll('script'));
        
        // Load scripts sequentially to maintain order
        for (const script of scripts) {
            try {
                // Fix relative paths in script src
                fixRelativePaths(script, pageDepth);
                await loadScript(script);
                // Small delay between scripts to ensure proper initialization
                await new Promise(resolve => setTimeout(resolve, 10));
            } catch (error) {
                console.warn('Script loading error:', error);
            }
        }
    }

    /**
     * Execute scripts inside dynamically-injected page content.
     * - Scripts inserted via innerHTML do NOT execute automatically.
     * - We replace each inert <script> with a new <script> so it runs.
     * - External scripts with the same src are not reloaded (avoids duplicates).
     */
    async function executeInjectedScripts(root) {
        if (!root) return;

        const pageDepth = getPageDepth();
        const scripts = Array.from(root.querySelectorAll('script'))
            // prevent double-executing if we call this more than once
            .filter(s => s.getAttribute('data-layout-loader-executed') !== 'true');
        if (!scripts.length) return;

        for (const oldScript of scripts) {
            try {
                const newScript = document.createElement('script');
                copyAttributes(oldScript, newScript);
                newScript.setAttribute('data-layout-loader-injected', 'true');
                newScript.setAttribute('data-layout-loader-executed', 'true');

                // If a page uses a custom script type to prevent early execution on initial parse,
                // force it back to executable JS when we inject it.
                const oldType = (oldScript.getAttribute('type') || '').trim().toLowerCase();
                const isExecutableType =
                    oldType === '' ||
                    oldType === 'text/javascript' ||
                    oldType === 'application/javascript' ||
                    oldType === 'module';
                if (!isExecutableType) {
                    newScript.removeAttribute('type');
                }

                if (oldScript.src) {
                    // Carry over src then fix relative paths on the new element
                    newScript.setAttribute('src', oldScript.getAttribute('src'));
                    fixRelativePaths(newScript, pageDepth);

                    const src = newScript.getAttribute('src');
                    const alreadyLoaded = !!document.querySelector(`script[src="${CSS.escape(src)}"]`);

                    if (alreadyLoaded) {
                        oldScript.parentNode && oldScript.parentNode.removeChild(oldScript);
                        continue;
                    }

                    await new Promise((resolve, reject) => {
                        newScript.onload = resolve;
                        newScript.onerror = () => reject(new Error(`Failed to load injected script: ${src}`));

                        if (oldScript.parentNode) {
                            oldScript.parentNode.insertBefore(newScript, oldScript);
                            oldScript.parentNode.removeChild(oldScript);
                        } else {
                            document.body.appendChild(newScript);
                        }
                    });
                } else {
                    newScript.textContent = oldScript.textContent;

                    if (oldScript.parentNode) {
                        oldScript.parentNode.insertBefore(newScript, oldScript);
                        oldScript.parentNode.removeChild(oldScript);
                    } else {
                        document.body.appendChild(newScript);
                    }
                }
            } catch (error) {
                console.warn('Injected script execution error:', error);
            }
        }
    }

    /**
     * Initialize components after layout is loaded
     */
    function initializeComponents() {
        // Wait for FontAwesome to be ready
        const waitForFontAwesome = () => {
            return new Promise((resolve) => {
                // Check if FontAwesome is already active
                if (document.body.classList.contains('fontawesome-i2svg-active')) {
                    resolve();
                    return;
                }
                
                // Wait for FontAwesome to load (check every 50ms, max 5 seconds)
                let attempts = 0;
                const maxAttempts = 100;
                const checkInterval = setInterval(() => {
                    if (document.body.classList.contains('fontawesome-i2svg-active') || attempts >= maxAttempts) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                    attempts++;
                }, 50);
            });
        };

        // Wait for everything to be ready
        Promise.all([
            waitForFontAwesome(),
            new Promise(resolve => setTimeout(resolve, 300)) // Extra buffer for scripts
        ]).then(() => {
            // Initialize Feather icons (must be after FontAwesome)
            if (typeof feather !== 'undefined') {
                feather.replace();
            }

            // Initialize Phoenix components if available
            if (typeof window.phoenix !== 'undefined') {
                if (window.phoenix.init) {
                    window.phoenix.init();
                }
            }

            // Re-initialize Bootstrap tooltips and popovers if needed
            if (typeof bootstrap !== 'undefined') {
                // Reinitialize tooltips
                const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
                tooltipTriggerList.map(function (tooltipTriggerEl) {
                    return new bootstrap.Tooltip(tooltipTriggerEl);
                });

                // Reinitialize popovers
                const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
                popoverTriggerList.map(function (popoverTriggerEl) {
                    return new bootstrap.Popover(popoverTriggerEl);
                });
            }

            // Force a reflow to ensure CSS is applied
            document.body.offsetHeight;
        });
    }

    /**
     * SPA Navigation - Replace only #page-content without full page reload
     */
    function initSpaNavigation() {
        const INTERNAL_HTML_RE = /\.html(?:$|[?#])/i;

        const isModifiedClick = (e) =>
            e.defaultPrevented ||
            e.button !== 0 ||
            e.metaKey ||
            e.ctrlKey ||
            e.shiftKey ||
            e.altKey;

        const toAbsoluteUrl = (href) => {
            try {
                return new URL(href, window.location.href).href;
            } catch {
                return null;
            }
        };

        // Convert eligible relative links to absolute, so deep routes (pages/settings/...)
        // don't break existing sidebar links after pushState().
        function normalizeInternalLinks(root = document) {
            root.querySelectorAll('a[href]').forEach(a => {
                const raw = a.getAttribute('href');
                if (!raw) return;
                if (raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) return;
                if (a.hasAttribute('download') || a.target === '_blank') return;
                if (!INTERNAL_HTML_RE.test(raw)) return;

                const abs = toAbsoluteUrl(raw);
                if (!abs) return;

                // Only same-origin
                if (new URL(abs).origin !== window.location.origin) return;

                // Preserve original (debugging / future use)
                if (!a.dataset.originalHref) a.dataset.originalHref = raw;
                a.setAttribute('href', abs);
            });
        }

        function updateActiveNav() {
            const currentPath = window.location.pathname;
            document
                .querySelectorAll('.navbar-vertical .nav-link[href]')
                .forEach(link => {
                    try {
                        const linkPath = new URL(link.getAttribute('href'), window.location.href).pathname;
                        const isActive = linkPath === currentPath;
                        link.classList.toggle('active', isActive);

                        // If this is a child link inside a collapse, ensure its parent is expanded
                        if (isActive) {
                            const parentCollapse = link.closest('.collapse');
                            if (parentCollapse) {
                                parentCollapse.classList.add('show');
                                const toggler = document.querySelector(`[href="#${parentCollapse.id}"][data-bs-toggle="collapse"]`);
                                if (toggler) toggler.setAttribute('aria-expanded', 'true');
                            }
                        }
                    } catch {
                        // ignore
                    }
                });
        }

        function reInitDynamicUi(root = document) {
            if (typeof feather !== 'undefined') {
                feather.replace();
            }
            if (typeof bootstrap !== 'undefined') {
                root
                    .querySelectorAll('[data-bs-toggle="tooltip"]')
                    .forEach(el => new bootstrap.Tooltip(el));
                root
                    .querySelectorAll('[data-bs-toggle="popover"]')
                    .forEach(el => new bootstrap.Popover(el));
            }
        }

        async function loadPage(url, { push = true } = {}) {
            // Allow the currently active page to cleanup resources (video players, websockets, timers, etc.)
            // before we replace the DOM via SPA navigation.
            try {
                if (typeof window.__visionaiPageCleanup === 'function') {
                    window.__visionaiPageCleanup();
                }
            } catch (e) {
                console.warn('Page cleanup error:', e);
            } finally {
                window.__visionaiPageCleanup = null;
            }

            const res = await fetch(url, { cache: 'no-cache' });
            if (!res.ok) throw new Error(`Failed to load page: ${url}`);

            const html = await res.text();
            const doc = parseHTML(html);

            const nextPageContent = doc.querySelector('#page-content');
            if (!nextPageContent) throw new Error(`No #page-content found in ${url}`);

            const title = doc.querySelector('title')?.textContent?.trim();
            if (title) document.title = title;

            const viewport = document.querySelector('.viewport-scrolls');
            if (!viewport) throw new Error('No .viewport-scrolls container found');

            // Replace ONLY viewport content
            while (viewport.firstChild) {
                viewport.removeChild(viewport.firstChild);
            }

            const tmp = document.createElement('div');
            tmp.innerHTML = nextPageContent.innerHTML;
            while (tmp.firstChild) {
                viewport.appendChild(tmp.firstChild);
            }

            // Execute scripts from the newly injected content
            await executeInjectedScripts(viewport);

            if (push) {
                history.pushState({ url }, '', url);
            }

            // Normalize links within newly injected content and sidebar
            normalizeInternalLinks(document);

            // Minimal UI re-init for injected DOM
            reInitDynamicUi(viewport);

            // Scroll viewport to top (optional UX)
            viewport.scrollTop = 0;

            updateActiveNav();

            // Notify SPA listeners (e.g., notifications/events UI) that a navigation finished
            try {
                window.dispatchEvent(new CustomEvent('vision:spa:navigated', { detail: { url } }));
            } catch {
                // ignore
            }
        }

        // Global reload button (top navbar) for SPA:
        // - Must work on every page (dashboard, camera-detail, etc.)
        // - Must trigger page cleanup before replacing content (handled inside loadPage)
        function bindGlobalReloadButton() {
            const btn = document.getElementById('reload-cameras-btn');
            if (!btn) return;
            if (btn.getAttribute('data-visionai-reload-bound') === 'true') return;
            btn.setAttribute('data-visionai-reload-bound', 'true');

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Reload the currently active page content via SPA
                loadPage(window.location.href, { push: false }).catch(err =>
                    console.error('SPA reload error:', err)
                );
            });
        }

        // Expose a tiny SPA navigation helper for programmatic navigation (e.g., grid clicks).
        // This avoids full page reloads when code uses window.location.href.
        window.visionaiSpa = window.visionaiSpa || {};
        window.visionaiSpa.navigate = (href, { push = true } = {}) => {
            const abs = toAbsoluteUrl(href);
            if (!abs) return;
            const nextUrl = new URL(abs);
            if (nextUrl.origin !== window.location.origin) return;
            if (!INTERNAL_HTML_RE.test(nextUrl.pathname + nextUrl.search + nextUrl.hash)) return;
            return loadPage(nextUrl.href, { push });
        };

        // Run once at start
        normalizeInternalLinks(document);
        updateActiveNav();
        bindGlobalReloadButton();

        document.addEventListener('click', (e) => {
            if (isModifiedClick(e)) return;
            const a = e.target.closest?.('a[href]');
            if (!a) return;

            const href = a.getAttribute('href');
            if (!href) return;
            if (!INTERNAL_HTML_RE.test(href)) return;

            const abs = toAbsoluteUrl(href);
            if (!abs) return;

            const nextUrl = new URL(abs);
            if (nextUrl.origin !== window.location.origin) return;

            // Let Bootstrap / JS widgets handle their own anchors
            if (a.dataset.bsToggle) return;

            e.preventDefault();
            loadPage(nextUrl.href).catch(err => console.error('SPA navigation error:', err));
        });

        window.addEventListener('popstate', (e) => {
            const url = e.state?.url || window.location.href;
            loadPage(url, { push: false }).catch(err => console.error('SPA navigation error:', err));
        });
    }

    /**
     * Initialize layout loading
     */
    async function loadLayout() {
        try {
            // Get page content before loading layout
            const contentContainer = document.querySelector(CONTENT_SELECTOR);
            if (!contentContainer) {
                console.warn('Content container not found. Make sure your page has an element with id="page-content"');
                return;
            }

            // Fetch the layout file
            const response = await fetch(LAYOUT_PATH);
            if (!response.ok) {
                throw new Error(`Failed to load layout: ${response.statusText}`);
            }

            const htmlString = await response.text();
            const layoutDoc = parseHTML(htmlString);

            // 🔴 FIX 1: Copy HTML attributes FIRST (before CSS loads)
            copyHtmlAttributes(layoutDoc);

            // Inject head content (CSS, meta tags, head scripts)
            injectHead(layoutDoc);

            // Wait a bit for CSS to apply
            await new Promise(resolve => setTimeout(resolve, 50));

            // Inject body structure and page content
            injectBody(layoutDoc);

            // Wait for DOM to be ready
            await new Promise(resolve => {
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', resolve);
                } else {
                    resolve();
                }
            });

            // 🔴 FIX 2: Load scripts from body ONLY (head scripts already loaded)
            await loadScripts(layoutDoc);

            // Wait longer for scripts to fully initialize (especially FontAwesome)
            await new Promise(resolve => setTimeout(resolve, 200));

            // Initialize components (this will wait for FontAwesome internally)
            initializeComponents();

            // Execute scripts inside injected page content (e.g., dashboard GridStack init)
            await executeInjectedScripts(document.querySelector('.viewport-scrolls'));

            // Enable SPA navigation (replace content only; keep layout)
            initSpaNavigation();

            // Restore chatbot state after everything is loaded
            restoreChatbotState();

            console.log('Layout loaded successfully');
        } catch (error) {
            console.error('Error loading layout:', error);
        }
    }

    // Start loading when script is executed
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadLayout);
    } else {
        loadLayout();
    }
})();
