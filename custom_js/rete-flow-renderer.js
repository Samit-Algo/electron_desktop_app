/**
 * Simple Static Flow Diagram Renderer
 * 
 * Simple, static flow diagram renderer - no zoom, no pan, just display.
 */

(function () {
  'use strict';

  class ReteFlowRenderer {
    constructor() {
      this.instances = new Map();
    }

    async render(containerId, reteData, options = {}) {
      const container = document.getElementById(containerId);
      if (!container) {
        console.error(`[rete-renderer] Container ${containerId} not found`);
        return null;
      }

      // Clear existing instance
      if (this.instances.has(containerId)) {
        this.destroy(containerId);
      }

      const instance = new FlowDiagramInstance(container, reteData, options);
      await instance.render();

      this.instances.set(containerId, instance);
      return instance;
    }

    destroy(containerId) {
      const instance = this.instances.get(containerId);
      if (instance) {
        instance.destroy();
        this.instances.delete(containerId);
      }
    }

    destroyAll() {
      this.instances.forEach(instance => instance.destroy());
      this.instances.clear();
    }
  }

  class FlowDiagramInstance {
    constructor(container, reteData, options = {}) {
      this.container = container;
      this.data = reteData;
      this.options = {
        readonly: true,
        autoLayout: true,
        layoutDirection: 'vertical',
        nodeSpacing: { x: 180, y: 100 },
        ...options
      };

      this.svg = null;
      this.nodes = new Map();
      this.connections = [];
    }

    async render() {
      this.createSVG();
      this.renderConnections();
      this.renderNodes();

      if (this.options.autoLayout) {
        this.applyLayout();
      }

      // Use viewBox for simple scaling
      this.fitToView();
    }

    createSVG() {
      this.container.innerHTML = '';
      this.container.style.position = 'relative';
      this.container.style.width = '100%';
      this.container.style.overflow = 'visible';

      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.svg.setAttribute('width', '100%');
      this.svg.setAttribute('height', '100%');
      this.svg.style.display = 'block';

      // Create groups for connections and nodes (connections behind nodes)
      this.connectionsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.connectionsGroup.setAttribute('class', 'connections-group');
      this.svg.appendChild(this.connectionsGroup);

      this.nodesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.nodesGroup.setAttribute('class', 'nodes-group');
      this.svg.appendChild(this.nodesGroup);

      this.container.appendChild(this.svg);
    }

    renderNodes() {
      const nodes = this.data.nodes || {};

      Object.entries(nodes).forEach(([nodeId, nodeData]) => {
        const nodeEl = this.createNodeElement(nodeId, nodeData);
        this.nodesGroup.appendChild(nodeEl);
        this.nodes.set(nodeId, { data: nodeData, element: nodeEl });
      });
    }

    createNodeElement(nodeId, nodeData) {
      const { label, color, borderColor, shape, symbolSize, fontSize, fontWeight } = nodeData.data;
      const [width, height] = symbolSize;
      const [x, y] = nodeData.position;

      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', `flow-node node-type-${shape || 'rect'}`);
      group.setAttribute('data-node-id', nodeId);
      group.setAttribute('transform', `translate(${x}, ${y})`);

      // Create node shape
      if (shape === 'diamond') {
        const diamond = this.createDiamond(width, height, color, borderColor);
        group.appendChild(diamond);
      } else if (shape === 'oval') {
        const oval = this.createOval(width, height, color, borderColor);
        group.appendChild(oval);
      } else {
        const rect = this.createRect(width, height, color, borderColor);
        group.appendChild(rect);
      }

      // Create label
      const text = this.createLabel(label, width, height, fontSize, fontWeight);
      group.appendChild(text);

      return group;
    }

    createRect(width, height, color, borderColor) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', -width / 2);
      rect.setAttribute('y', -height / 2);
      rect.setAttribute('width', width);
      rect.setAttribute('height', height);
      rect.setAttribute('rx', 8);
      rect.setAttribute('ry', 8);
      rect.setAttribute('fill', color || '#ffffff');
      rect.setAttribute('stroke', borderColor || '#495057');
      rect.setAttribute('stroke-width', 2);
      rect.setAttribute('class', 'node-shape');
      rect.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.05))';
      return rect;
    }

    createOval(width, height, color, borderColor) {
      const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      ellipse.setAttribute('cx', 0);
      ellipse.setAttribute('cy', 0);
      ellipse.setAttribute('rx', width / 2);
      ellipse.setAttribute('ry', height / 2);
      ellipse.setAttribute('fill', color || '#f8f9fa');
      ellipse.setAttribute('stroke', borderColor || '#6c757d');
      ellipse.setAttribute('stroke-width', 2);
      ellipse.setAttribute('class', 'node-shape');
      return ellipse;
    }

    createDiamond(width, height, color, borderColor) {
      const points = [
        [0, -height / 2],
        [width / 2, 0],
        [0, height / 2],
        [-width / 2, 0]
      ].map(p => p.join(',')).join(' ');

      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', points);
      polygon.setAttribute('fill', color || '#ffffff');
      polygon.setAttribute('stroke', borderColor || '#dc3545');
      polygon.setAttribute('stroke-width', 2.5);
      polygon.setAttribute('class', 'node-shape');
      polygon.style.filter = 'drop-shadow(0 0 4px rgba(220, 53, 69, 0.25))';
      return polygon;
    }

    createLabel(labelText, width, height, fontSize, fontWeight) {
      const lines = labelText.split('\n');
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('fill', '#000000');
      text.setAttribute('font-size', fontSize);
      text.setAttribute('font-weight', '700');
      text.setAttribute('class', 'node-label');
      text.style.textRendering = 'optimizeLegibility';

      const lineHeight = fontSize * 1.3;
      const totalHeight = lines.length * lineHeight;
      const startY = -totalHeight / 2 + lineHeight / 2;

      lines.forEach((line, idx) => {
        const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        tspan.setAttribute('x', 0);
        tspan.setAttribute('y', startY + idx * lineHeight);
        tspan.textContent = line;
        text.appendChild(tspan);
      });

      return text;
    }

    renderConnections() {
      const nodes = this.data.nodes || {};

      Object.entries(nodes).forEach(([sourceId, sourceNode]) => {
        const outputs = sourceNode.outputs || {};

        Object.values(outputs).forEach(output => {
          const connections = output.connections || [];

          connections.forEach(conn => {
            const targetId = conn.node;
            const targetNode = nodes[targetId];

            if (targetNode) {
              const connectionEl = this.createConnection(
                sourceNode.position,
                targetNode.position,
                sourceId,
                targetId,
                conn.data
              );
              this.connectionsGroup.appendChild(connectionEl);
              this.connections.push({
                source: sourceId,
                target: targetId,
                element: connectionEl,
                data: conn.data
              });
            }
          });
        });
      });
    }

    createConnection(sourcePos, targetPos, sourceId, targetId, data) {
      const [x1, y1] = sourcePos;
      const [x2, y2] = targetPos;
      const isLoop = data?.isLoop || false;
      const isExit = data?.isExit || false;

      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', 'flow-connection');
      if (isLoop) group.setAttribute('class', 'flow-connection flow-loop');
      if (isExit) group.setAttribute('class', 'flow-connection flow-exit');
      group.setAttribute('data-source', sourceId);
      group.setAttribute('data-target', targetId);

      // Create path
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d = isLoop ? this.createLoopPath(x1, y1, x2, y2) : this.createCurvedPath(x1, y1, x2, y2);
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');

      // Style based on connection type
      if (isExit) {
        path.style.stroke = 'var(--flow-exit-color, #dc3545)';
        path.setAttribute('stroke-dasharray', '5,5');
      } else if (isLoop) {
        path.style.stroke = 'var(--flow-loop-color, #495057)';
        path.setAttribute('stroke-dasharray', '8,4');
      } else {
        path.style.stroke = 'var(--flow-edge-color, #495057)';
      }

      path.setAttribute('stroke-width', '2.5');
      path.setAttribute('class', 'connection-path');
      group.appendChild(path);

      // Add arrow marker
      const arrow = this.createArrowMarker(x2, y2, Math.atan2(y2 - y1, x2 - x1));
      group.appendChild(arrow);

      // Add label if exists
      if (data && data.label && data.show) {
        const label = this.createConnectionLabel(x1, y1, x2, y2, data.label, isLoop);
        group.appendChild(label);
      }

      return group;
    }

    createCurvedPath(x1, y1, x2, y2) {
      const midY = y1 + (y2 - y1) / 2;
      return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
    }

    createLoopPath(x1, y1, x2, y2) {
      const offset = 180;
      if (y2 < y1) {
        const outerX = Math.max(x1, x2) + offset;
        return `M ${x1} ${y1} L ${outerX} ${y1} L ${outerX} ${y2} L ${x2} ${y2}`;
      }
      return `M ${x1} ${y1} L ${x1} ${y1 + 40} L ${x1 + offset} ${y1 + 40} L ${x1 + offset} ${y2 - 40} L ${x2} ${y2 - 40} L ${x2} ${y2}`;
    }

    createArrowMarker(x, y, angle) {
      const arrowSize = 8;
      const points = [
        [x, y],
        [x - arrowSize, y - arrowSize / 2],
        [x - arrowSize, y + arrowSize / 2]
      ];

      const rotated = points.map(([px, py]) => {
        const dx = px - x;
        const dy = py - y;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return [
          x + dx * cos - dy * sin,
          y + dx * sin + dy * cos
        ];
      });

      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', rotated.map(p => p.join(',')).join(' '));
      polygon.style.fill = 'var(--flow-edge-color, #6c757d)';
      polygon.setAttribute('class', 'connection-arrow');
      return polygon;
    }

    createConnectionLabel(x1, y1, x2, y2, labelText, isLoop = false) {
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const labelY = isLoop ? Math.max(y1, y2) + 60 : midY - 5;
      const labelX = midX;

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', labelX);
      text.setAttribute('y', labelY);
      text.setAttribute('text-anchor', 'middle');
      text.style.fill = 'var(--flow-label-color, #495057)';
      text.setAttribute('font-size', '10');
      text.setAttribute('font-weight', '600');
      text.setAttribute('class', 'connection-label');
      text.textContent = labelText;

      // Add background for readability
      const bbox = text.getBBox();
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', bbox.x - 4);
      bg.setAttribute('y', bbox.y - 2);
      bg.setAttribute('width', bbox.width + 8);
      bg.setAttribute('height', bbox.height + 4);
      bg.style.fill = 'var(--flow-label-bg, #fff)';
      bg.setAttribute('rx', 3);
      bg.setAttribute('opacity', '0.9');

      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.appendChild(bg);
      group.appendChild(text);

      return group;
    }

    applyLayout() {
      const nodes = Array.from(this.nodes.entries());
      const padding = 24;

      if (this.options.layoutDirection === 'vertical') {
        // Use backend-provided coordinates if available
        let hasBackendCoords = false;
        nodes.forEach(([_, node]) => {
          const [x, y] = node.data.position || [0, 0];
          if (x !== 0 || y !== 0) {
            hasBackendCoords = true;
          }
        });

        if (hasBackendCoords) {
          // Use backend coordinates directly
          nodes.forEach(([_, node]) => {
            const [x, y] = node.data.position || [0, 0];
            node.element.setAttribute('transform', `translate(${x}, ${y})`);
          });
        } else {
          // Fallback: auto-layout vertically
          let maxW = 200;
          let maxH = 80;
          nodes.forEach(([_, node]) => {
            const sz = node?.data?.data?.symbolSize;
            if (Array.isArray(sz) && sz.length >= 2) {
              maxW = Math.max(maxW, Number(sz[0]) || 0);
              maxH = Math.max(maxH, Number(sz[1]) || 0);
            }
          });
          const gapY = 80;
          const x = padding + maxW / 2;
          nodes.forEach(([_, node], idx) => {
            const y = padding + (maxH / 2) + idx * (maxH + gapY);
            node.data.position = [x, y];
            node.element.setAttribute('transform', `translate(${x}, ${y})`);
          });
        }

        // Update connections
        this.updateConnectionPositions();
      }
    }

    updateConnectionPositions() {
      this.connections.forEach(conn => {
        const sourceNode = this.nodes.get(conn.source);
        const targetNode = this.nodes.get(conn.target);

        if (sourceNode && targetNode) {
          const [x1, y1] = sourceNode.data.position;
          const [x2, y2] = targetNode.data.position;
          const isLoop = conn.data?.isLoop || false;

          const path = conn.element.querySelector('.connection-path');
          if (path) {
            const d = isLoop ? this.createLoopPath(x1, y1, x2, y2) : this.createCurvedPath(x1, y1, x2, y2);
            path.setAttribute('d', d);
          }

          // Update arrow
          const arrow = conn.element.querySelector('.connection-arrow');
          if (arrow) {
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const arrowMarker = this.createArrowMarker(x2, y2, angle);
            arrow.replaceWith(arrowMarker);
          }
        }
      });
    }

    fitToView() {
      // Get bounding box of all elements
      const bbox = this.svg.getBBox();
      const padding = 40;

      const viewBox = [
        bbox.x - padding,
        bbox.y - padding,
        bbox.width + padding * 2,
        bbox.height + padding * 2
      ].join(' ');

      this.svg.setAttribute('viewBox', viewBox);
      this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    }

    destroy() {
      if (this.container) {
        this.container.innerHTML = '';
      }
      this.nodes.clear();
      this.connections = [];
    }
  }

  // Create global instance
  window.reteFlowRenderer = new ReteFlowRenderer();

  console.log('[rete-renderer] Simple static flow renderer loaded');
})();
