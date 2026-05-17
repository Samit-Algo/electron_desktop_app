# Watch Dog workflow — all node types

Single reference for every node in [`../workflow-editor.html`](../workflow-editor.html). Connection rules live in `NODE_COMPATIBILITY`; rule metadata in `RULE_META` and `renderAgentSections`.

## Table of contents

1. [Node: `start`](#node-start)
2. [Node: `camera`](#node-camera)
3. [Node: `class_detection_agent`](#node-class_detection_agent)
4. [Node: `class_detection_zone_agent`](#node-class_detection_zone_agent)
5. [Node: `object_count_agent`](#node-object_count_agent)
6. [Node: `person_behaviour_agent`](#node-person_behaviour_agent)
7. [Node: `notification`](#node-notification)
8. [Node: `report`](#node-report)
9. [Node: `end`](#node-end)

---

## Node: `start`

### Role

Entry point for a Watch Dog workflow. Defines **when** the pipeline runs (schedule, time windows, active days) and **how** it runs in continuous vs patrol-style modes with optional intervals and check duration.

### User says things like

"run this 24/7", "only on weekdays", "every morning at 9", "patrol mode every 10 minutes",
"schedule the watchdog", "when should this run"

### Config fields (from `NODE_DEFINITIONS` + `renderStartSections`)

- **label**: display name for the node card
- **description**: free-text purpose of this entry point
- **schedule_type**: `always` | `daily` | `weekly` | `once`
- **start_time** / **end_time**: optional time window strings (used when schedule is not `always`, per UI logic)
- **active_days**: which days the schedule applies (format as shown in the editor)
- **run_mode**: `continuous` | `patrol`
- **interval_minutes**: spacing between patrol-style runs (default 10)
- **check_duration_seconds**: how long each check lasts in seconds (default 30)

### Allowed inputs

- None (this is the root; no incoming edges)

### Allowed outputs

- **camera** node only

### Notes

- The **Start → Camera** chain determines workflow binding metadata (`bind_to_event` / graph root) on save.
- If **schedule_type** is **`always`**, **Notification → End** is blocked downstream (non-terminating flow); saving may fail if an **End** node is still incorrectly wired (`hasUnusedEndNode` validation).

---

## Node: `camera`

### Role

Selects one or more **cameras** whose feeds are passed to downstream **AI agent** nodes. Bridges the **Start** trigger to detection, counting, and behaviour rules.

### User says things like

"watch camera 3", "use the front door feed", "all lobby cameras",
"which camera", "video source for this watchdog"

### Config fields (from `NODE_DEFINITIONS` + `renderCameraSections`)

- **label**: node label on the card
- **camera_ids**: selected camera(s) from the API-backed camera list (`/api/v1/cameras/list`)
- **frame_rate** (where shown in UI): optional frame-rate hint used in camera sections (default 25 in renderer)

### Allowed inputs

- **start** node only

### Allowed outputs

- **class_detection_agent**
- **class_detection_zone_agent**
- **object_count_agent**
- **person_behaviour_agent**

### Notes

- Agents **must** receive input from **camera**, not directly from **start**.
- Downstream agents inherit the logical “video context” from the selected camera(s).

---

## Node: `class_detection_agent`

### Role

Detects objects or conditions using a **YOLO-style** (or specialized) model on the camera feed. Supports **class presence**, **fire**, **weapon**, and **face / person ID** rule types. Fires alerts when confidence crosses a threshold, with optional cooldown between alerts.

### User says things like

"detect cars", "alert when a person enters", "detect objects",
"class detection", "identify vehicles", "spot fire", "weapon alert",
"face recognition on this camera"

### Config fields (from `NODE_DEFINITIONS`, `RULE_META`, and `renderAgentSections`)

**Core (all rules)**

- **agent_name**: optional human-readable name
- **rule_id**: `class_presence` | `fire_detection` | `weapon_detection` | `face_detection`
- **model_name**: e.g. `yolov8n.pt`, `yolov8m.pt`, `yolov8s.pt`, `fire_detection.pt` (options depend on rule; may be **read-only** when loaded from Knowledge Base — `kb_loaded` / `kb_model_name`)
- **fps**: frames per second to analyse (typically 1–60)
- **confidence_threshold**: 0.0–1.0
- **alert_cooldown_seconds**: minimum seconds between repeated alerts

**Rule-specific**

- **detect_class**: shown when **rule_id** is `class_presence` — one of `person`, `car`, `truck`, `bicycle`, `bus`, `motorcycle` (UI dropdown; aligns with `RULE_META` class lists)
- **face_detection**: `RULE_META` marks this rule as needing **watch names** on the backend; the editor may merge settings from **`/api/v1/workflows/rules/{rule_id}`** when using KB-loaded rules

**Zones**

- This node type has **no zone UI** in the editor (`class_detection_agent` path does not set `needsZone`). Use **class_detection_zone_agent** for spatial ROI / polygon rules.

### Allowed inputs

- **camera** node only

### Allowed outputs

- **notification** node
- **report** node

### Notes

- Requires a **camera** node upstream. Cannot connect directly to **start** or **end**.
- For polygon / line / ROI spatial rules, use **`class_detection_zone_agent`** or **`object_count_agent`** instead.

---

## Node: `class_detection_zone_agent`

### Role

Runs detection **inside user-drawn zones** on the camera image: restricted areas, wall-climb lines, machine ROI idle detection, or “person near machine” absence logic. Uses the same core agent fields as class detection, plus **zone geometry** stored on the node (`zones` / `zone`).

### User says things like

"restricted zone", "don't enter this area", "fence climbing",
"machine idle too long", "nobody near the machine for X minutes",
"draw a polygon on the video"

### Config fields (from `NODE_DEFINITIONS`, `RULE_META`, and `renderAgentSections`)

**Core**

- **agent_name**, **model_name**, **fps**, **confidence_threshold**, **alert_cooldown_seconds** (same semantics as class detection agent)
- **rule_id**: `restricted_zone` | `wall_climb_detection` | `person_near_machine` | `loom_machine_state`
- **zone_configured**: internal flag tracking whether zones were drawn

**Rule-specific (from `RULE_META` + UI)**

| Rule | Zone type | Extra fields |
|------|-----------|----------------|
| `restricted_zone` | polygon (min 3 points) | **detect_class** when class list applies |
| `wall_climb_detection` | polygon around wall/fence | fixed person class in metadata |
| `loom_machine_state` | ROI (two-corner box) | **idle_threshold_minutes** (default 15) |
| `person_near_machine` | polygon around machine | **absence_threshold_minutes** (default 5) |

**Geometry**

- **zones** / **zone.coordinates**: polygon, line, or ROI data produced by the in-editor **Draw zone** tools (type per rule: `polygon`, `line`, `roi`)

### Allowed inputs

- **camera** node only

### Allowed outputs

- **notification** node
- **report** node

### Notes

- Requires a **camera** node upstream. Cannot connect directly to **start** or **end**.
- Zone copy in the UI matches **`RULE_META`** (`zoneDesc`, `zoneType`) for each rule id.

---

## Node: `object_count_agent`

### Role

Counts objects crossing a **line** (or boxes for box counting) using a detection model. Supports **class-based counting** or a dedicated **box** counter model. Alerts respect FPS, confidence, and cooldown; zones are **line** type (two points).

### User says things like

"count people crossing a line", "how many cars passed",
"traffic counting", "box counter", "occupancy line"

### Config fields (from `NODE_DEFINITIONS`, `RULE_META`, and `renderAgentSections`)

**Core**

- **agent_name**, **model_name**, **fps**, **confidence_threshold**, **alert_cooldown_seconds**
- **rule_id**: `class_count` | `box_count`
- **zone_configured**: internal flag for drawn line(s)

**Rule-specific**

- **class_count**: **detect_class** — `person`, `car`, `truck`, `bicycle`, `bus`, `motorcycle` (per UI); **`RULE_META`** also lists these classes; **needsZone** with **line** — “Draw 2 points for counting line.”
- **box_count**: **`RULE_META`** uses **fixedClass** `box`; same line zone requirement

**Geometry**

- **zones** / line coordinates for the counting line (and optional additional zones via “Add another zone” when configured)

### Allowed inputs

- **camera** node only

### Allowed outputs

- **notification** node
- **report** node

### Notes

- Requires a **camera** node upstream. Cannot connect directly to **start** or **end**.
- For full-frame class alerts without a counting line, prefer **`class_detection_agent`**.

---

## Node: `person_behaviour_agent`

### Role

Analyses **person pose** streams for behaviours such as **fall detection** and **sleep detection**, using pose models (`yolov8*-pose.pt`). Uses confidence, FPS, and alert cooldown like other agents; no class dropdown (rules are person-centric).

### User says things like

"detect if someone fell", "fall down alert", "sleeping on duty",
"pose monitoring", "person behaviour"

### Config fields (from `NODE_DEFINITIONS` and `renderAgentSections`)

- **agent_name**: optional label
- **rule_id**: `fall_detection` | `sleep_detection`
- **model_name**: `yolov8m-pose.pt` | `yolov8n-pose.pt`
- **fps**: analysis rate (1–60 in UI)
- **confidence_threshold**: 0.0–1.0
- **alert_cooldown_seconds**: minimum time between alerts

**`RULE_META` mapping**

- **fall_detection** / **sleep_detection**: no class picker, no zone in this node (see **`RULE_META`** — `needsZone: false`)

### Allowed inputs

- **camera** node only

### Allowed outputs

- **notification** node
- **report** node

### Notes

- Requires a **camera** node upstream. Cannot connect directly to **start** or **end**.
- Spatial / zone-based rules use **`class_detection_zone_agent`** instead.

---

## Node: `notification`

### Role

Sends alerts through **Email**, **SMS**, or **Webhook** when upstream agents trigger. Carries recipients, subject, body (with placeholders such as `{{camera_name}}` / `{{class_name}}`), and importance.

### User says things like

"email the team", "SMS alert", "webhook to Slack",
"notify security", "send a message when it triggers"

### Config fields (from `NODE_DEFINITIONS`)

- **label**: node label
- **channel**: `Email` | `SMS` | `Webhook`
- **recipients**: comma-separated emails or phone numbers (as applicable)
- **subject**: title line for email-style channels
- **body**: message body with optional template placeholders
- **importance**: `Low` | `Normal` | `High`

### Allowed inputs

- **class_detection_agent**
- **class_detection_zone_agent**
- **object_count_agent**
- **person_behaviour_agent**
- **report** (workflows may chain report → notification)

### Allowed outputs

- **end** node
- **report** node

### Notes

- When the upstream **Start** schedule is **`always`**, a connection **Notification → End** is **invalid** (output port hidden / validation blocks). Use **report** or omit **end** for that pattern.
- Does not accept **camera** or **start** directly; agents must sit between **camera** and **notification**.

---

## Node: `report`

### Role

Schedules or triggers **reports** (events, counting, agents, cameras, system) and delivers them to configured recipients. Supports **end-of-day**, **hourly**, **every N minutes**, **once**, or **manual** schedules, with optional UTC time for end-of-day and notes.

### User says things like

"daily summary email", "hourly report", "send counts at 6pm",
"operations digest", "scheduled PDF/email report"

### Config fields (from `NODE_DEFINITIONS`)

- **label**: node label
- **report_type**: `events` | `counting` | `agents` | `cameras` | `system`
- **report_schedule**: `end_of_day` | `hourly` | `every_n_minutes` | `once` | `manual`
- **end_of_day_time**: shown when schedule is `end_of_day` — time as **HH:MM UTC** (default `23:55`)
- **interval_minutes**: shown when schedule is `every_n_minutes`
- **recipients**: comma-separated email addresses
- **notes**: free-text notes about the report

### Allowed inputs

- **class_detection_agent**
- **class_detection_zone_agent**
- **object_count_agent**
- **person_behaviour_agent**
- **notification** (notification and report may chain in either direction per compatibility)

### Allowed outputs

- **end** node
- **notification** node

### Notes

- **notification** and **report** can feed each other (`notification` ↔ `report`) per `NODE_COMPATIBILITY`, enabling notify-then-report or report-then-notify flows.
- Does not connect directly to **camera** or **start**.

---

## Node: `end`

### Role

Marks a **terminating** outcome for the Watch Dog graph. Holds a short **expected outcome** description for operators. Has **no outgoing** connections.

### User says things like

"workflow complete", "done", "success criteria",
"what does finished mean for this watchdog"

### Config fields (from `NODE_DEFINITIONS`)

- **label**: node label (e.g. “End”)
- **result_summary**: textarea — “Expected outcome” / what completion means for this Watch Dog

### Allowed inputs

- **notification** node
- **report** node

### Allowed outputs

- None (terminal node)

### Notes

- **Start** with schedule **`always`** plus **Notification → End** is disallowed: validation prevents that edge and may block save if an **End** is still incorrectly attached (`hasUnusedEndNode`).
- **End** cannot connect to **camera** or **agents** directly; it only receives from **notification** or **report**.
