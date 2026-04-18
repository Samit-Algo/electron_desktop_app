const STATUS_MAP = {
  online:     { label: 'Online',     cls: 'badge-success'   },
  offline:    { label: 'Offline',    cls: 'badge-danger'    },
  active:     { label: 'Active',     cls: 'badge-success'   },
  inactive:   { label: 'Inactive',   cls: 'badge-secondary' },
  pending:    { label: 'Pending',    cls: 'badge-warning'   },
  processing: { label: 'Processing', cls: 'badge-info'      },
  failed:     { label: 'Failed',     cls: 'badge-danger'    },
  completed:  { label: 'Completed',  cls: 'badge-success'   },
  unknown:    { label: 'Unknown',    cls: 'badge-secondary' },
};

export function normalizeStatus(status) {
  if (!status) return 'unknown';
  return String(status).toLowerCase().trim();
}

export function getStatusBadge(status) {
  const key = normalizeStatus(status);
  const entry = STATUS_MAP[key] ?? { label: key, cls: 'badge-secondary' };
  return `<span class="badge ${entry.cls}">${entry.label}</span>`;
}
