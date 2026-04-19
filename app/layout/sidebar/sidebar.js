/* Sidebar module: injects sidebar markup into the app shell. */
export async function initSidebar() {
  const host = document.getElementById('sidebar-host');
  if (!host || host.dataset.sidebarReady === 'true') return;
  const res = await fetch('./layout/sidebar/sidebar.html', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load sidebar: ${res.status}`);
  host.innerHTML = await res.text();
  const toggle = host.querySelector('.navbar-vertical-toggle');
  if (toggle) {
    const stored = localStorage.getItem('phoenixIsNavbarVerticalCollapsed');
    const shouldCollapse = stored === 'true';
    document.documentElement.classList.toggle('navbar-vertical-collapsed', shouldCollapse);
    toggle.addEventListener('click', () => {
      const isCollapsed = document.documentElement.classList.toggle('navbar-vertical-collapsed');
      localStorage.setItem('phoenixIsNavbarVerticalCollapsed', String(isCollapsed));
    });
  }
  host.dataset.sidebarReady = 'true';
}
