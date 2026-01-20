// Flow diagram renderer module - renders Rete.js-style SVG flow diagrams in chat messages

(function () {
  'use strict';

  // Module dependencies injected from chatbot-core.js
  let messagesEl = null;
  let ensureReteFlowRenderer = null;

  // Render a flow diagram inside a pending assistant message bubble
  async function renderFlowDiagram(pendingId, flowDiagramData) {
    try {
      // Validate flow diagram data structure
      if (!window.flowTransforms || !window.flowTransforms.isValid(flowDiagramData)) {
        console.warn('[ChatbotFlowDiagram] Invalid flow diagram data');
        return;
      }

      // Find the pending message container element
      const pendingNode = messagesEl?.querySelector?.(`[data-chatbot-pending="${pendingId}"]`);
      if (!pendingNode) {
        console.warn('[ChatbotFlowDiagram] Pending node not found:', pendingId);
        return;
      }

      // Get the assistant bubble div inside the pending container
      const bubble = pendingNode.querySelector?.('div');
      if (!bubble) {
        console.warn('[ChatbotFlowDiagram] Bubble element not found');
        return;
      }

      // Create unique container ID for this diagram instance
      const diagramId = `flow-diagram-${pendingId}`;

      // Prevent duplicate renders if diagram already exists
      if (document.getElementById(diagramId)) {
        console.warn('[ChatbotFlowDiagram] Diagram already rendered:', pendingId);
        return;
      }

      // Create and append diagram container div to the bubble
      const container = document.createElement('div');
      container.id = diagramId;
      container.className = 'flow-diagram-container mt-3';
      container.style.width = '100%';
      bubble.appendChild(container);

      // Ensure Rete flow renderer scripts are loaded
      if (ensureReteFlowRenderer) {
        await ensureReteFlowRenderer();
      }

      // Verify renderer is available after loading
      if (!window.reteFlowRenderer) {
        throw new Error('Rete flow renderer not available');
      }

      // Transform generic flow data to Rete.js format
      const reteData = window.flowTransforms.toRete(flowDiagramData);

      // Render the diagram with layout and interaction options
      await window.reteFlowRenderer.render(diagramId, reteData, {
        readonly: true,
        autoLayout: true,
        layoutDirection: 'horizontal-wrap',
        nodeSpacing: { x: 28, y: 54 },
        wrapColumns: 3,
        enablePanZoom: true,
        fitOnInit: true,
        minScale: 0.5,
        maxScale: 1.6
      });
    } catch (e) {
      console.error('[ChatbotFlowDiagram] Render failed:', e);
    }
  }

  // Initialize module with dependencies from chatbot-core.js
  function init(deps) {
    messagesEl = deps.messagesEl;
    ensureReteFlowRenderer = deps.ensureReteFlowRenderer;
  }

  // Expose public API
  window.ChatbotFlowDiagram = {
    init: init,
    renderFlowDiagram: renderFlowDiagram
  };

  // Auto-initialize if dependencies were stashed before module loaded
  if (window.ChatbotFlowDiagramPendingDeps) {
    try {
      init(window.ChatbotFlowDiagramPendingDeps);
    } catch (e) {
      console.error('[ChatbotFlowDiagram] Init failed:', e);
    }
    window.ChatbotFlowDiagramPendingDeps = null;
  }
})();
