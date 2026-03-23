# Vision AI Desktop App – Project Analysis Report

Analysis of **custom_js**, **layout**, and **pages** for gaps, dummy data, duplicate code, and architecture issues.

---

## 1. Dummy / Placeholder Data

### custom_js
| File | Lines | Issue |
|------|-------|-------|
| `custom_js/notifications-realtime.js` | ~28, 190–195, 280, 499 | `clearedDummyList` flag; `clearDummyNotificationsIfNeeded()` clears Phoenix demo placeholders |
| `custom_js/auth-guard.js` | 309–316 | "Forgot password" only shows toast "coming soon"; no implementation |

### layout
| File | Lines | Issue |
|------|-------|-------|
| `layout/side_navbar.html` | 294–350 | Quick Links: Behance, Cloud, Slack, GitLab, etc. – generic template, not app-specific |
| `layout/chatbot.html` | 41, 49–54, 138, 147, 152 | Chat history dropdown with dummy items; "Auto toggle" placeholder; static processing indicator; web search button placeholder |
| `layout/chatbot-markdown.js` | 115–145, 312 | Mermaid placeholder during streaming; extract mermaid blocks returns unchanged text |
| `layout/chatbot-voice.js` | 636 | User message bubble placeholder (replaced by STT result) |

### pages
| File | Lines | Issue |
|------|-------|-------|
| `pages/dashboard.html` | 39–46, 70–72, 95–97, 122–124 | Static stats: "2 Active", "2 Online", "2 Monitoring", "10 Total", "25 Today", "+6.2%" – not from API |
| `pages/events-board.html` | 39–44, 54–59 | Severity tabs show "(0)"; camera filter has "Camera 01", "Camera 02", "Camera 03" – hardcoded |
| `pages/camera-detail.html` | 109, 115, 276 | Timeline labeled "Dummy 24h view"; not driven by real event data |
| `pages/event-detail.html` | 247 | "Related Events – Removed dummy data, can be added later with real API" |
| `pages/chat.html` | 34 | Dummy empty state for media cards |

---

## 2. Hardcoded Values & Configuration Gaps

| File | Lines | Issue |
|------|-------|-------|
| `custom_js/api-service.js` | 28–29 | `baseURL = 'http://localhost:8000'`, `jetsonBaseURL = 'http://localhost:8001'` – not configurable |
| `custom_js/api-service.js` | 369–370 | `serverPort = '3000'`, `serverHost = '127.0.0.1'` – hardcoded fallbacks |
| `custom_js/api-service.js` | 935 | WebSocket keep-alive `30000` ms – magic number |
| `pages/workflow-list.html` | 120, 258 | Direct `fetch('http://localhost:8000/...')` – bypasses `visionAPI` |
| `pages/workflow-editor.html` | 1116, 2148, 2279, 2282, 2391, 2507 | Same pattern – multiple direct fetch to `localhost:8000` |

---

## 3. Duplicate Code

### `escapeHtml` (9+ locations)
| File | Line |
|------|------|
| `custom_js/agents-board.js` | 151 |
| `custom_js/vision-widgets/agents-board-widget.js` | 97 |
| `custom_js/vision-widgets/events-board-widget.js` | 27 |
| `custom_js/notifications-realtime.js` | 64 |
| `custom_js/agent-detail.js` | 115 |
| `layout/chatbot-core.js` | 424 |
| `layout/chatbot-zone-editor.js` | 24 |
| `layout/chatbot-attachments.js` | 100 (as `escapeHtmlSafe`) |
| `pages/camera-detail.html` | 1850 (inline script) |

### `timeAgo`
| File | Line |
|------|------|
| `custom_js/notifications-realtime.js` | 50 |
| `custom_js/vision-widgets/events-board-widget.js` | 49 |

### `inferSeverity` + `severityBadgeClass`
| File | Lines |
|------|-------|
| `custom_js/notifications-realtime.js` | 74–84 |
| `custom_js/vision-widgets/events-board-widget.js` | 36–46 |

### Agent status / rule helpers (agents-board vs agents-board-widget)
| Function | Duplicated in |
|----------|---------------|
| `normalizeStatus` | `agents-board.js`, `agents-board-widget.js` |
| `getStatusDisplay` | both |
| `formatDuration` | both |
| `getRuleGroupLabel` | both |
| `getRuleDisplayText` | both |
| `formatModel` | both |

### Agent card rendering
- `agents-board.js` (255–367) and `agents-board-widget.js` (146–181) use nearly identical card structure

---

## 4. Incomplete Features / Gaps

| Location | Issue |
|----------|-------|
| `custom_js/auth-guard.js` | Forgot password not implemented |
| `pages/dashboard.html` | Stats cards (cameras, agents, incidents, objects) use static values – no API |
| `pages/events-board.html` | Camera filter dropdown static; severity tabs not wired to widget |
| `pages/event-detail.html` | Related events section empty; no API |
| `pages/camera-detail.html` | Timeline shows dummy 24h; not aligned to real events |
| `pages/workflow-list.html` | Uses direct fetch instead of `visionAPI` |
| `pages/workflow-editor.html` | Same – multiple direct fetch calls |
| `layout/chatbot.html` | Chat history, Auto toggle, processing indicator, web search – placeholders only |

---

## 5. Architecture & File Structure

### Oversized files
| File | Approx. lines | Issue |
|------|---------------|------|
| `pages/camera-detail.html` | ~2515 | HTML + inline JS + styles mixed; should be split |
| `pages/workflow-editor.html` | ~2500+ | LogicFlow, workflow CRUD, modals, inline scripts |
| `custom_js/agents-board.js` | ~1700 | Page logic, rendering, filters, create-agent modal, RULE_META |
| `layout/chatbot-core.js` | ~1243 | Layout, tabs, composer, messages, approvals |
| `layout/chatbot-zone-editor.js` | ~1243 | Zone drawing, camera select, mixed concerns |

### Inconsistent API usage
| Pattern | Files |
|---------|-------|
| Uses `visionAPI` | Most of app |
| Direct `fetch` to `localhost:8000` | `workflow-list.html`, `workflow-editor.html` |

### Duplicate implementations
| Feature | Implementations |
|---------|-----------------|
| Agents board | `agents-board.js` (full page) vs `agents-board-widget.js` (reusable) – logic not shared |
| Events board | `notifications-realtime.js` (legacy) vs `VisionEventsBoardWidget` – overlapping responsibility |

### Missing shared modules
- No `utils.js` for `escapeHtml`, `timeAgo`, `inferSeverity`, etc.
- No centralized config for API URLs
- No workflow methods in `api-service.js` (workflows call API directly)

---

## 6. File Naming & Organization

| Issue | Location |
|-------|----------|
| Inline scripts in HTML | `camera-detail.html`, `dashboard.html`, `workflow-editor.html`, `event-detail.html` – should move to separate `.js` |
| Mixed concerns | `agents-board.js` mixes list, filters, modal, RULE_META |
| Widgets location | `custom_js/vision-widgets/` – good; could add `custom_js/utils/` for shared helpers |

---

## Summary Table

| Category | custom_js | layout | pages |
|----------|-----------|--------|-------|
| Dummy/placeholder data | 2 | 10+ | 5 |
| Hardcoded values | 4 | 0 | 2 |
| Duplicate code patterns | 5+ | 3+ | 3+ |
| Gaps / incomplete | 2 | 0 | 6 |
| Architecture / structure | 3 | 2 | 3 |

---

## Recommended Fixes (Priority Order)

### High priority
1. **Shared utilities** – Create `custom_js/utils.js` with `escapeHtml`, `timeAgo`, `inferSeverity`, `severityBadgeClass`; use in all modules.
2. **Workflow API** – Add workflow methods to `api-service.js`; replace direct fetch in `workflow-list.html` and `workflow-editor.html`.
3. **Config** – Move `baseURL`, `jetsonBaseURL`, ports to a config module or env.
4. **Dashboard stats** – Drive stats (cameras, agents, incidents, objects) from API instead of static values.

### Medium priority
5. **Agent board refactor** – Share logic between `agents-board.js` and `agents-board-widget.js` (e.g. status helpers, card rendering).
6. **Events board** – Use `VisionEventsBoardWidget` on `events-board.html`; remove or reduce duplicate logic in `notifications-realtime.js`.
7. **Replace placeholders** – Quick links in navbar; chatbot history, Auto toggle, web search – implement or remove.

### Lower priority
8. **Split large files** – Extract JS from `camera-detail.html` and `workflow-editor.html` to `camera-detail.js`, `workflow-editor.js`.
9. **Forgot password** – Implement or remove.
10. **Related events** – Implement in `event-detail.html` if required.
11. **Timeline** – Replace dummy 24h in `camera-detail.html` with real event-based timeline.
