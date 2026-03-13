/**
 * CHATBOT FLOW DIAGRAM MODULE
 * ===========================
 * Renders Rete.js-style flow diagrams inside AI message bubbles.
 * Used when the backend returns flow_diagram_data (e.g. agent plans).
 *
 * Flow: flowDiagramData -> Transform to Rete format -> Render in container
 */
(function () {
  'use strict';

  /** Set by init() from chatbot-core */
  let messagesEl = null;
  let ensureReteFlowRenderer = null;

  // ============================================================================
  // MAIN RENDER FUNCTION
  // ============================================================================

  /** Render a flow diagram in the bubble with the given pendingId */
  async function renderFlowDiagram(pendingId, flowDiagramData) {
    try {
      // Validate flow diagram data structure
      if (!window.flowTransforms || !window.flowTransforms.isValid(flowDiagramData)) return;

      const pendingNode = messagesEl?.querySelector?.(`[data-chatbot-pending="${pendingId}"]`);
      if (!pendingNode) return;

      const bubble = pendingNode.querySelector?.('div');
      if (!bubble) return;

      // Create unique container ID for this diagram instance
      const diagramId = `flow-diagram-${pendingId}`;

      if (document.getElementById(diagramId)) return;

      // Create and append diagram container div to the bubble
      const container = document.createElement('div');
      container.id = diagramId;
      container.className = 'flow-diagram-container mt-3';
      container.style.width = '100%';
      container.style.minHeight = '500px';
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

      // Determine layout direction from backend data or default to vertical
      const layoutDirection = flowDiagramData.layout === 'vertical' ? 'vertical' : 'vertical';
      const nodeSpacing = layoutDirection === 'vertical' ? { x: 0, y: 80 } : { x: 28, y: 54 }; // Reduced spacing

      // Render the diagram with vertical layout and interaction options
      await window.reteFlowRenderer.render(diagramId, reteData, {
        readonly: true,
        autoLayout: true,
        layoutDirection: layoutDirection,
        nodeSpacing: nodeSpacing,
        enablePanZoom: true,
        fitOnInit: true,
        minScale: 0.5,
        maxScale: 1.6
      });
    } catch (_) {}
  }

  // ============================================================================
  // INIT & PUBLIC API
  // ============================================================================

  function init(deps) {
    messagesEl = deps.messagesEl;
    ensureReteFlowRenderer = deps.ensureReteFlowRenderer;
  }

  window.ChatbotFlowDiagram = {
    init: init,
    renderFlowDiagram: renderFlowDiagram
  };

  // Auto-initialize if dependencies were stashed before module loaded
  if (window.ChatbotFlowDiagramPendingDeps) {
    try { init(window.ChatbotFlowDiagramPendingDeps); } catch (_) {}
    window.ChatbotFlowDiagramPendingDeps = null;
  }
})();
