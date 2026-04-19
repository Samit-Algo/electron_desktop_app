/**
 * CHATBOT FLOW DIAGRAM MODULE (ES Module)
 */

let messagesEl = null;
let ensureReteFlowRenderer = null;

async function renderFlowDiagram(pendingId, flowDiagramData) {
  try {
    if (!window.flowTransforms || !window.flowTransforms.isValid(flowDiagramData)) return;

    const pendingNode = messagesEl?.querySelector?.(`[data-chatbot-pending="${pendingId}"]`);
    if (!pendingNode) return;

    const bubble = pendingNode.querySelector?.('div');
    if (!bubble) return;

    const diagramId = `flow-diagram-${pendingId}`;
    if (document.getElementById(diagramId)) return;

    const container = document.createElement('div');
    container.id = diagramId;
    container.className = 'flow-diagram-container mt-3';
    container.style.width = '100%';
    container.style.minHeight = '500px';
    bubble.appendChild(container);

    if (ensureReteFlowRenderer) {
      await ensureReteFlowRenderer();
    }

    if (!window.reteFlowRenderer) {
      throw new Error('Rete flow renderer not available');
    }

    const reteData = window.flowTransforms.toRete(flowDiagramData);
    const layoutDirection = flowDiagramData.layout === 'vertical' ? 'vertical' : 'vertical';
    const nodeSpacing = layoutDirection === 'vertical' ? { x: 0, y: 80 } : { x: 28, y: 54 };

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

export function init(deps) {
  messagesEl = deps.messagesEl;
  ensureReteFlowRenderer = deps.ensureReteFlowRenderer;
}

export { renderFlowDiagram };
