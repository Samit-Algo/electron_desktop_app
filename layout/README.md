# Layout – Chatbot UI

This folder contains the **chatbot panel** (offcanvas + toggle) and its scripts.

> **📖 New to the code?** See [CODE_GUIDE.md](CODE_GUIDE.md) for a student-friendly flow guide. The main layout (navbar, sidebar, viewport) lives in `side_navbar.html`, which loads this chatbot fragment.

## Structure

| File | Role |
|------|------|
| **chatbot.html** | Chat panel markup: offcanvas, tabs, messages area, input, modals (Find Person), resize handle, toggle button. |
| **chatbot.css** | Styles for the chatbot panel, messages, zone editor, voice overlay. |
| **chatbot-core.js** | Core logic: layout/resize, tabs, composer, send/stream, HITL (approval cards, zone). Delegates to the modules below. |
| **chatbot-markdown.js** | Markdown parsing (marked + DOMPurify), streaming-safe HTML, final render and AI message actions. |
| **chatbot-zone-editor.js** | Zone editor: fetch camera snapshot, polygon/line drawing, normalized coordinates, Save/Undo/Clear. |
| **chatbot-voice.js** | Voice: recording, STT/TTS stream, orb animation, barge-in, send button states. |
| **chatbot-flow-diagram.js** | Renders Rete-style flow diagrams inside assistant bubbles (uses `rete-flow-renderer.js` and `flow-transforms.js`). |
| **side_navbar.html** | Full app shell: head, navbar, sidebar, viewport, script order. Injects `chatbot.html` into `#chatbot-container`. |

## Load order (in chatbot.html)

1. `chatbot.css`
2. `chatbot-core.js`
3. `chatbot-voice.js`
4. `chatbot-zone-editor.js`
5. `chatbot-flow-diagram.js`
6. `chatbot-markdown.js`

Core initializes first and passes dependencies (e.g. `messagesEl`, `sendTextMessage`, `escapeHtml`) to the other modules via `init()` or `*PendingDeps` if they load later.

## For beginners

- **Where does the chat panel come from?**  
  `side_navbar.html` fetches `chatbot.html` and inserts it into `#chatbot-container`, then runs its script tags.

- **Where is the message list?**  
  Inside the offcanvas, the element with class `chat-messages` is the messages container; core and other modules get it from the DOM or via `init()`.

- **Who sends messages?**  
  `chatbot-core.js` handles the send button and Enter key, calls `window.visionAPI.chatWithAgentStream` or `generalChatStream`, and updates the UI from stream events. Zone and approval flows are handled in core and `chatbot-zone-editor.js`.
