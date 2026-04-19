/* Topbar module: injects topbar markup into the app shell. */
export async function initTopbar() {
  const host = document.getElementById('topbar-host');
  if (!host || host.dataset.topbarReady === 'true') return;
  const res = await fetch('./layout/topbar/topbar.html', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load topbar: ${res.status}`);
  host.innerHTML = await res.text();
  host.dataset.topbarReady = 'true';
}
