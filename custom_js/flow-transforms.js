/**
 * Flow Diagram Data Transformation Utilities
 * 
 * Transforms generic flow diagram data from backend to various rendering formats.
 * Backend sends once in generic format, frontend transforms as needed.
 */

(function() {
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
    
    // Transform nodes
    nodes.forEach((node, idx) => {
      const reteId = `node_${idx}`;
      const nodeName = node.name;
      nodeIdMap[nodeName] = reteId;

      // Reduce node size a bit (boxes were too big) and bump font for readability.
      const rawSize = Array.isArray(node.symbolSize) && node.symbolSize.length >= 2
        ? node.symbolSize
        : [170, 60];
      const scale = 0.82;
      const scaledW = Math.max(110, Math.round((Number(rawSize[0]) || 170) * scale));
      const scaledH = Math.max(44, Math.round((Number(rawSize[1]) || 60) * scale));
      const baseFont = Number(node.label?.fontSize) || 11;
      const fontSize = Math.min(14, Math.max(12, baseFont + 1));
      
      reteNodes[reteId] = {
        id: reteId,
        name: nodeName,
        position: [node.x || 0, node.y || 0],
        inputs: { input: { connections: [] } },
        outputs: { output: { connections: [] } },
        data: {
          label: node.label?.formatter || nodeName,
          color: node.itemStyle?.color || '#2A7BE4',
          borderColor: node.itemStyle?.borderColor || '#1A5BBE',
          shape: node.symbol === 'diamond' ? 'diamond' : 'rect',
          symbolSize: [scaledW, scaledH],
          fontSize,
          fontWeight: 700
        }
      };
    });
    
    // Transform links/connections
    links.forEach(link => {
      const sourceId = nodeIdMap[link.source];
      const targetId = nodeIdMap[link.target];
      
      if (sourceId && targetId && reteNodes[sourceId]) {
        reteNodes[sourceId].outputs.output.connections.push({
          node: targetId,
          input: 'input',
          data: {
            label: link.label?.formatter || '',
            show: link.label?.show || false
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
