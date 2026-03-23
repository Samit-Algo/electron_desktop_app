# Chatbot Code Guide – Easy to Understand

This guide explains how the chatbot code is organized. Written for students and beginners.

---

## 📁 File Structure (What Each File Does)

| File | What it does | When it runs |
|------|--------------|--------------|
| **chatbot-core.js** | Main controller. Handles layout, tabs, sending messages, streaming | First – starts everything |
| **chatbot-markdown.js** | Renders **markdown** (bold, links, code) in AI messages | When AI response has markdown |
| **chatbot-attachments.js** | Renders **images, tables, charts, videos** in AI messages | When backend sends content blocks |
| **chatbot-zone-editor.js** | Lets user **draw zones/lines** on camera snapshot | When agent needs a monitoring zone |
| **chatbot-flow-diagram.js** | Draws **flowcharts** (agent plans) in chat | When backend returns flow diagram |
| **chatbot-voice.js** | **Voice input/output** – mic, recording, playback | When user taps voice button |

---

## 🔄 How a Message Flows (Step by Step)

```
1. User types text and clicks Send (or presses Enter)
   └─> chatbot-core.js: sendTextMessage()

2. Core adds user bubble and creates empty AI bubble ("Thinking...")
   └─> appendUserBubble(), appendAssistantPending()

3. Core calls backend API (visionAPI.chatWithAgentStream or generalChatStream)
   └─> Stream returns events: token, done, pending_approval, etc.

4. As tokens arrive, core updates the AI bubble
   └─> chatbot-markdown.js: updateAssistantPendingText() (streaming text)
   └─> OR chatbot-attachments.js: renderContentBlocksInBubble() (structured response)

5. When done, final message is shown with Copy/Like buttons
   └─> chatbot-markdown.js: replaceAssistantPending()
```

---

## 📂 Inside chatbot-core.js (Main Sections)

| Section | Function | What it does |
|---------|----------|--------------|
| **1. Path & script loading** | getVendorScriptPath, loadScriptOnce | Load external scripts (marked, DOMPurify, etc.) |
| **2. Layout & resize** | initChatbotLayout | Chat panel width, drag handle, open/close |
| **3. Composer** | initChatbotComposer | Text input, Enter to send, send/voice button |
| **4. Tabs & messaging** | initChatbotTabs | Tabs, send message, stream response, HITL |
| **5. Find person modal** | initFindPersonModal | Upload photos for face recognition |
| **6. Keyboard shortcut** | initChatbotKeyboardShortcut | Ctrl+L toggles chatbot |
| **7. Startup** | initAll | Runs all init functions on page load |

---

## 🧩 How Modules Talk to Each Other

- **chatbot-core.js** is the boss. It calls other modules:
  - `ChatbotMarkdown.replaceAssistantPending()` – final message
  - `ChatbotMarkdown.updateAssistantPendingText()` – streaming text
  - `ChatbotAttachments.renderContentBlocksInBubble()` – images/tables/videos
  - `ChatbotZoneEditor.openZoneEditorInBubble()` – draw zone
  - `ChatbotFlowDiagram.renderFlowDiagram()` – flow chart
  - `ChatbotVoice.startVoiceRecording()` – voice input

- Each module gets what it needs via `init(deps)`:
  - e.g. `messagesEl` (the chat container), `escapeHtml`, `sendTextMessage`

---

## 📝 Naming Conventions Used

| Type | Example | Rule |
|------|---------|------|
| **Functions** | `sendTextMessage`, `appendUserBubble` | camelCase, verb first |
| **Variables** | `accumulatedText`, `chatState` | camelCase, descriptive |
| **Constants** | `DEFAULT_CHATBOT_WIDTH`, `VOICE_STATE` | UPPER_SNAKE_CASE |
| **Section headers** | `// ============ SECTION 1 ============` | Clear, easy to find |

---

## 🎯 Where to Look When...

| You want to... | Look in |
|----------------|---------|
| Change chat panel width | chatbot-core.js → initChatbotLayout |
| Change how markdown looks | chatbot-markdown.js → replaceAssistantPending |
| Add a new content type | chatbot-attachments.js → renderSingleBlock |
| Change zone drawing | chatbot-zone-editor.js → createZoneEditorElement |
| Change voice behavior | chatbot-voice.js → startVoiceRecording |

---

## 🔧 Load Order (in chatbot.html)

1. chatbot.css  
2. chatbot-core.js  
3. chatbot-attachments.js  
4. chatbot-voice.js  
5. chatbot-zone-editor.js  
6. chatbot-flow-diagram.js  
7. chatbot-markdown.js  

Core loads first and passes dependencies to others via `init()` or `*PendingDeps`.
