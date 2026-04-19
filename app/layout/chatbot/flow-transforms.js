/**
 * Flow Diagram Data Transformation Utilities
 * 
 * Transforms generic flow diagram data from backend to Rete.js format.
 * Preserves loop/exit flags and neutral colors from backend.
 */

(function () {
  'use strict';

  /**
   * Transform generic flow data to Rete.js format
   * @param {Object} genericData - Generic flow data: {nodes: [...], links: [...]}
   * @returns {Object} Rete.js compatible format
   */
  function transformToRete(genericData) {
    if (!genericData || !genericData.nodes) {
      console.warn('[flow-transforms] Invalid generic data for Rete transformation');
      return { id: 'agent-flow', nodes: {} };
    }

    const nodes = genericData.nodes || [];
    const links = genericData.links || [];

    const reteNodes = {};
    const nodeIdMap = {};  // name -> rete_id mapping

    // Transform nodes - preserve backend coordinates and styling
    nodes.forEach((node, idx) => {
      const reteId = `node_${idx}`;
      const nodeName = node.name;
      nodeIdMap[nodeName] = reteId;

      // Use backend-provided size or default (increased sizes)
      const rawSize = Array.isArray(node.symbolSize) && node.symbolSize.length >= 2
        ? node.symbolSize
        : [200, 80];
      const scaledW = Number(rawSize[0]) || 200;
      const scaledH = Number(rawSize[1]) || 80;
      const baseFont = Number(node.label?.fontSize) || 12;
      const fontSize = Math.min(16, Math.max(12, baseFont));

      // Use backend-provided position or default to 0,0
      const x = node.x !== undefined ? node.x : 0;
      const y = node.y !== undefined ? node.y : 0;

      reteNodes[reteId] = {
        id: reteId,
        name: nodeName,
        position: [x, y],
        inputs: { input: { connections: [] } },
        outputs: { output: { connections: [] } },
        data: {
          label: node.label?.formatter || nodeName,
          color: node.itemStyle?.color || '#f5f5f5',  // Neutral gray from backend
          borderColor: node.itemStyle?.borderColor || '#666',  // Neutral border from backend
          shape: node.symbol === 'diamond' ? 'diamond' : (node.symbol === 'oval' ? 'oval' : 'rect'),
          symbolSize: [scaledW, scaledH],
          fontSize,
          fontWeight: 600
        }
      };
    });

    // Transform links/connections - preserve loop and exit flags
    links.forEach(link => {
      const sourceId = nodeIdMap[link.source];
      const targetId = nodeIdMap[link.target];

      if (sourceId && targetId && reteNodes[sourceId]) {
        reteNodes[sourceId].outputs.output.connections.push({
          node: targetId,
          input: 'input',
          data: {
            label: link.label?.formatter || '',
            show: link.label?.show || false,
            isLoop: link.isLoop || false,  // Preserve loop flag
            isExit: link.isExit || false   // Preserve exit flag
          }
        });
      }
    });

    return {
      id: 'agent-flow',
      nodes: reteNodes
    };
  }

  /**
   * Validate generic flow data structure
   * @param {Object} data - Data to validate
   * @returns {boolean} True if valid
   */
  function isValidFlowData(data) {
    return !!(
      data &&
      typeof data === 'object' &&
      Array.isArray(data.nodes) &&
      Array.isArray(data.links) &&
      data.nodes.length > 0
    );
  }

  // Export to global scope
  window.flowTransforms = {
    toRete: transformToRete,
    isValid: isValidFlowData
  };

  console.log('[flow-transforms] Flow transformation utilities loaded');
})();
