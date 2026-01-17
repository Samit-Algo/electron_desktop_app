/**
 * Rete.js-Style Flow Diagram Renderer
 * 
 * Clean, canvas-based flow diagram renderer inspired by n8n and Rete.js.
 * Supports multi-line layouts, proper connections, and interactive features.
 */

(function() {
  'use strict';

  class ReteFlowRenderer {
    constructor() {
      this.instances = new Map();  // Track diagram instances
      this.animationFrames = new Map();
    }

    /**
     * Render a flow diagram in a container
     * @param {string} containerId - DOM element ID
     * @param {Object} reteData - Transformed Rete data
     * @param {Object} options - Rendering options
     */
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

    /**
     * Destroy a diagram instance
     * @param {string} containerId - DOM element ID
     */
    destroy(containerId) {
      const instance = this.instances.get(containerId);
      if (instance) {
        instance.destroy();
        this.instances.delete(containerId);
      }
    }

    /**
     * Destroy all instances
     */
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
        layoutDirection: 'horizontal-wrap',  // vertical | horizontal | horizontal-wrap
        nodeSpacing: { x: 180, y: 100 },
        // Force N columns per row in horizontal-wrap (set to 3 for your requirement)
        wrapColumns: null,
        // n8n-like canvas controls
        enablePanZoom: true,
        fitOnInit: true,
        minScale: 0.45,
        maxScale: 2.4,
        zoomStep: 1.12,
        animate: true,
        ...options
      };
      
      this.svg = null;
      this.nodes = new Map();
      this.connections = [];
      this.animationTimer = null;

      // camera state for pan/zoom (applied to a root <g>)
      this.camera = { x: 0, y: 0, scale: 1 };
      this.worldBounds = null; // {minX,minY,maxX,maxY}
      this._panning = { active: false, lastX: 0, lastY: 0 };
      this._toolbarEl = null;
    }

    async render() {
      console.log('[rete-renderer] Starting render with data:', this.data);
      this.createSVG();
      this.renderConnections();
      this.renderNodes();
      
      console.log('[rete-renderer] Rendered', this.nodes.size, 'nodes and', this.connections.length, 'connections');
      
      if (this.options.autoLayout) {
        this.applyLayout();
      }

      // n8n-like: keep text readable, no viewBox scaling. Use camera instead.
      this.svg.removeAttribute('viewBox');
      this.svg.removeAttribute('preserveAspectRatio');

      if (this.options.enablePanZoom) {
        this.installPanZoom();
        if (this.options.fitOnInit) {
          // Wait a frame so we have real sizes
          requestAnimationFrame(() => this.fitToViewCamera());
        }
      }

      // Auto-reflow when chat bubble width changes (resize, sidebar drag, etc)
      this.installResizeObserver();
      
      if (this.options.animate) {
        this.startAnimation();
      }
      
      console.log('[rete-renderer] Render complete. SVG viewBox:', this.svg.getAttribute('viewBox'));
    }

    createSVG() {
      this.container.innerHTML = '';
      this.container.style.position = 'relative';
      this.container.style.width = '100%';
      // Let CSS control sizing/theme. No scrolling; user pans/zooms inside.
      this.container.style.overflow = 'hidden';

      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.svg.setAttribute('width', '100%');
      this.svg.setAttribute('height', '100%');
      this.svg.style.display = 'block';
      this.svg.style.touchAction = 'none'; // allow pointer pan without page scroll
      
      // Root camera group (pan/zoom applies here)
      this.cameraGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.cameraGroup.setAttribute('class', 'flow-camera');
      this.svg.appendChild(this.cameraGroup);

      // Create groups for connections and nodes (connections behind nodes)
      this.connectionsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.connectionsGroup.setAttribute('class', 'connections-group');
      this.cameraGroup.appendChild(this.connectionsGroup);
      
      this.nodesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.nodesGroup.setAttribute('class', 'nodes-group');
      this.cameraGroup.appendChild(this.nodesGroup);
      
      this.container.appendChild(this.svg);
      // Initialize camera transform
      this.applyCameraTransform();
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
      group.setAttribute('class', 'flow-node');
      group.setAttribute('data-node-id', nodeId);
      group.setAttribute('transform', `translate(${x}, ${y})`);

      // Create node shape
      if (shape === 'diamond') {
        const diamond = this.createDiamond(width, height, color, borderColor);
        group.appendChild(diamond);
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
      rect.setAttribute('rx', 10);
      rect.setAttribute('ry', 10);
      rect.setAttribute('fill', color);
      rect.setAttribute('stroke', borderColor || '#1A5BBE');
      rect.setAttribute('stroke-width', 2);
      rect.setAttribute('class', 'node-shape');
      return rect;
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
      polygon.setAttribute('fill', color);
      polygon.setAttribute('stroke', borderColor || '#1A5BBE');
      polygon.setAttribute('stroke-width', 2);
      polygon.setAttribute('class', 'node-shape');
      return polygon;
    }

    createLabel(labelText, width, height, fontSize, fontWeight) {
      const lines = labelText.split('\n');
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('fill', '#fff');
      text.setAttribute('font-size', fontSize);
      text.setAttribute('font-weight', String(fontWeight || 600));
      text.setAttribute('class', 'node-label');
      // Improve readability on small sizes / scaling
      text.style.textRendering = 'geometricPrecision';
      text.style.paintOrder = 'stroke';
      text.style.stroke = 'rgba(0, 0, 0, 0.25)';
      text.style.strokeWidth = '0.7px';

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

      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', 'flow-connection');
      group.setAttribute('data-source', sourceId);
      group.setAttribute('data-target', targetId);

      // Create curved path
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d = this.createCurvedPath(x1, y1, x2, y2);
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.style.stroke = 'var(--flow-edge-color, #6c757d)';
      path.setAttribute('stroke-width', '2');
      path.setAttribute('class', 'connection-path');
      group.appendChild(path);

      // Add arrow marker
      const arrow = this.createArrowMarker(x2, y2, Math.atan2(y2 - y1, x2 - x1));
      group.appendChild(arrow);

      // Add label if exists
      if (data && data.label && data.show) {
        const label = this.createConnectionLabel(x1, y1, x2, y2, data.label);
        group.appendChild(label);
      }

      return group;
    }

    createCurvedPath(x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      
      // Vertical flow: curve horizontally
      if (Math.abs(dy) > Math.abs(dx)) {
        const midY = (y1 + y2) / 2;
        return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
      }
      // Horizontal flow: curve vertically
      else {
        const midX = (x1 + x2) / 2;
        return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
      }
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

    createConnectionLabel(x1, y1, x2, y2, labelText) {
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', midX);
      text.setAttribute('y', midY - 5);
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
      const spacing = this.options.nodeSpacing;
      const padding = 24;

      console.log('[rete-renderer] Applying layout:', this.options.layoutDirection, 'with', nodes.length, 'nodes');

      if (this.options.layoutDirection === 'vertical') {
        // Top-to-bottom layout
        // Determine max node size
        let maxW = 170;
        let maxH = 60;
        nodes.forEach(([_, node]) => {
          const sz = node?.data?.data?.symbolSize;
          if (Array.isArray(sz) && sz.length >= 2) {
            maxW = Math.max(maxW, Number(sz[0]) || 0);
            maxH = Math.max(maxH, Number(sz[1]) || 0);
          }
        });
        const gapY = Math.max(10, Number(spacing?.y) || 80);
        const x = padding + maxW / 2;
        nodes.forEach(([_, node], idx) => {
          const y = padding + (maxH / 2) + idx * (maxH + gapY);
          node.data.position = [x, y];
          node.element.setAttribute('transform', `translate(${x}, ${y})`);
        });

        const layoutW = padding * 2 + maxW;
        const layoutH = padding * 2 + nodes.length * maxH + Math.max(0, nodes.length - 1) * gapY;
        if (this.options.fitMode !== 'fit') {
          this.svg.setAttribute('width', `${layoutW}px`);
          this.svg.setAttribute('height', `${layoutH}px`);
        }
      } else if (this.options.layoutDirection === 'horizontal-wrap') {
        // Wrap nodes into multiple rows based on container width
        // IMPORTANT: during first paint clientWidth can be 0; use getBoundingClientRect().
        const rectW = this.container.getBoundingClientRect?.().width || 0;
        const containerWidth = Math.max(rectW, this.container.clientWidth || 0, 300);

        // If width is not measurable yet, retry on next frame.
        if (containerWidth <= 10) {
          requestAnimationFrame(() => this.applyLayout());
          return;
        }

        // Compute max node size so wrap respects actual node width/height.
        let maxW = 170;
        let maxH = 60;
        nodes.forEach(([_, node]) => {
          const sz = node?.data?.data?.symbolSize;
          if (Array.isArray(sz) && sz.length >= 2) {
            maxW = Math.max(maxW, Number(sz[0]) || 0);
            maxH = Math.max(maxH, Number(sz[1]) || 0);
          }
        });

        // Treat spacing.x/y as GAPs between nodes (not absolute step)
        const gapX = Math.max(10, Number(spacing?.x) || 40);
        const gapY = Math.max(10, Number(spacing?.y) || 70);
        const stepX = maxW + gapX;
        const stepY = maxH + gapY;

        const desiredCols = Number(this.options.wrapColumns);
        const availableWidth = Math.max(containerWidth - padding * 2, maxW);
        const autoCols = Math.max(1, Math.floor((availableWidth + gapX) / stepX));
        const columns = (Number.isFinite(desiredCols) && desiredCols > 0)
          ? Math.max(1, Math.min(Math.floor(desiredCols), nodes.length))
          : autoCols;

        console.log('[rete-renderer] Horizontal wrap layout - containerWidth:', containerWidth, 'maxW:', maxW, 'columns:', columns);

        nodes.forEach(([nodeId, node], idx) => {
          const row = Math.floor(idx / columns);
          const col = idx % columns;
          // Positions are CENTER points (nodes are drawn from -w/2, -h/2)
          const x = padding + (maxW / 2) + col * stepX;
          const y = padding + (maxH / 2) + row * stepY;
          node.data.position = [x, y];
          node.element.setAttribute('transform', `translate(${x}, ${y})`);
        });

        const rows = Math.max(1, Math.ceil(nodes.length / columns));

        const layoutW = padding * 2 + columns * maxW + Math.max(0, columns - 1) * gapX;
        const layoutH = padding * 2 + rows * maxH + Math.max(0, rows - 1) * gapY;
        // World bounds for camera fit / panning limits
        this.worldBounds = { minX: 0, minY: 0, maxX: layoutW, maxY: layoutH };
      } else {
        // Left-to-right layout
        let maxW = 170;
        let maxH = 60;
        nodes.forEach(([_, node]) => {
          const sz = node?.data?.data?.symbolSize;
          if (Array.isArray(sz) && sz.length >= 2) {
            maxW = Math.max(maxW, Number(sz[0]) || 0);
            maxH = Math.max(maxH, Number(sz[1]) || 0);
          }
        });
        const gapX = Math.max(10, Number(spacing?.x) || 40);
        const y = padding + maxH / 2;
        nodes.forEach(([_, node], idx) => {
          const x = padding + (maxW / 2) + idx * (maxW + gapX);
          node.data.position = [x, y];
          node.element.setAttribute('transform', `translate(${x}, ${y})`);
        });

        const layoutW = padding * 2 + nodes.length * maxW + Math.max(0, nodes.length - 1) * gapX;
        const layoutH = padding * 2 + maxH;
        this.worldBounds = { minX: 0, minY: 0, maxX: layoutW, maxY: layoutH };
      }

      // Update connections
      this.updateConnectionPositions();
    }

    applyCameraTransform() {
      if (!this.cameraGroup) return;
      const { x, y, scale } = this.camera;
      this.cameraGroup.setAttribute('transform', `translate(${x}, ${y}) scale(${scale})`);
    }

    clampScale(next) {
      const min = Number(this.options.minScale) || 0.4;
      const max = Number(this.options.maxScale) || 2.5;
      return Math.min(max, Math.max(min, next));
    }

    zoomAt(clientX, clientY, factor) {
      const rect = this.svg.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;

      const old = this.camera.scale;
      const next = this.clampScale(old * factor);
      if (next === old) return;

      // Keep the world point under cursor fixed
      const wx = (sx - this.camera.x) / old;
      const wy = (sy - this.camera.y) / old;
      this.camera.scale = next;
      this.camera.x = sx - wx * next;
      this.camera.y = sy - wy * next;
      this.applyCameraTransform();
    }

    panBy(dx, dy) {
      this.camera.x += dx;
      this.camera.y += dy;
      this.applyCameraTransform();
    }

    fitToViewCamera() {
      if (!this.worldBounds) return;
      const rect = this.container.getBoundingClientRect();
      const vw = Math.max(10, rect.width);
      const vh = Math.max(10, rect.height);

      const pad = 24;
      const worldW = Math.max(1, this.worldBounds.maxX - this.worldBounds.minX);
      const worldH = Math.max(1, this.worldBounds.maxY - this.worldBounds.minY);

      const scaleX = (vw - pad * 2) / worldW;
      const scaleY = (vh - pad * 2) / worldH;
      const scale = this.clampScale(Math.min(scaleX, scaleY));

      this.camera.scale = scale;
      this.camera.x = (vw - worldW * scale) / 2 - this.worldBounds.minX * scale;
      this.camera.y = (vh - worldH * scale) / 2 - this.worldBounds.minY * scale;
      this.applyCameraTransform();
    }

    installPanZoom() {
      if (this._panZoomInstalled) return;
      this._panZoomInstalled = true;

      const isOnNode = (target) => {
        try { return !!target?.closest?.('.flow-node'); } catch (_) { return false; }
      };

      // Wheel zoom
      this._onWheel = (e) => {
        e.preventDefault();
        const step = Number(this.options.zoomStep) || 1.12;
        const factor = e.deltaY < 0 ? step : 1 / step;
        this.zoomAt(e.clientX, e.clientY, factor);
      };
      this.svg.addEventListener('wheel', this._onWheel, { passive: false });

      // Drag pan (middle mouse OR space+left OR drag background)
      this._spaceDown = false;
      this._onKeyDown = (e) => { if (e.code === 'Space') this._spaceDown = true; };
      this._onKeyUp = (e) => { if (e.code === 'Space') this._spaceDown = false; };
      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);

      this._onMouseDown = (e) => {
        if (isOnNode(e.target)) return;
        const isMiddle = e.button === 1;
        const isLeftWithSpace = e.button === 0 && this._spaceDown;
        const isLeftBackground = e.button === 0 && (e.target === this.svg);
        if (!(isMiddle || isLeftWithSpace || isLeftBackground)) return;
        e.preventDefault();
        this._panning.active = true;
        this._panning.lastX = e.clientX;
        this._panning.lastY = e.clientY;
      };
      this._onMouseMove = (e) => {
        if (!this._panning.active) return;
        const dx = e.clientX - this._panning.lastX;
        const dy = e.clientY - this._panning.lastY;
        this._panning.lastX = e.clientX;
        this._panning.lastY = e.clientY;
        this.panBy(dx, dy);
      };
      this._onMouseUp = () => { this._panning.active = false; };
      this.svg.addEventListener('mousedown', this._onMouseDown);
      window.addEventListener('mousemove', this._onMouseMove);
      window.addEventListener('mouseup', this._onMouseUp);
    }


    installResizeObserver() {
      if (this._resizeObserver) return;
      if (typeof ResizeObserver === 'undefined') return;

      let raf = null;
      this._resizeObserver = new ResizeObserver(() => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          if (this.options.autoLayout) {
            this.applyLayout();
          }
          if (this.options.enablePanZoom && this.options.fitOnInit) {
            // Keep layout usable when user resizes chat width
            this.fitToViewCamera();
          }
        });
      });
      this._resizeObserver.observe(this.container);
    }

    updateConnectionPositions() {
      this.connections.forEach(conn => {
        const sourceNode = this.nodes.get(conn.source);
        const targetNode = this.nodes.get(conn.target);
        
        if (sourceNode && targetNode) {
          const [x1, y1] = sourceNode.data.position;
          const [x2, y2] = targetNode.data.position;
          
          const path = conn.element.querySelector('.connection-path');
          if (path) {
            const d = this.createCurvedPath(x1, y1, x2, y2);
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

    startAnimation() {
      let step = 0;
      const totalSteps = this.nodes.size;

      this.animationTimer = setInterval(() => {
        if (step >= totalSteps) {
          // Reset and loop
          this.nodes.forEach((node, id) => {
            node.element.classList.remove('active');
          });
          this.connections.forEach(conn => {
            conn.element.classList.remove('active');
          });
          step = 0;
          return;
        }

        const nodeArray = Array.from(this.nodes.entries());
        const [currentId, currentNode] = nodeArray[step];

        // Highlight current node
        currentNode.element.classList.add('active');

        // Highlight outgoing connections
        this.connections.forEach(conn => {
          if (conn.source === currentId) {
            conn.element.classList.add('active');
          }
        });

        // Unhighlight previous
        if (step > 0) {
          const [prevId, prevNode] = nodeArray[step - 1];
          prevNode.element.classList.remove('active');
          this.connections.forEach(conn => {
            if (conn.source === prevId) {
              conn.element.classList.remove('active');
            }
          });
        }

        step++;
      }, 1000);
    }

    destroy() {
      if (this.animationTimer) {
        clearInterval(this.animationTimer);
        this.animationTimer = null;
      }

      try { this._resizeObserver?.disconnect?.(); } catch (_) {}
      this._resizeObserver = null;

      try { this.svg?.removeEventListener?.('wheel', this._onWheel); } catch (_) {}
      try { this.svg?.removeEventListener?.('mousedown', this._onMouseDown); } catch (_) {}
      try { window.removeEventListener?.('mousemove', this._onMouseMove); } catch (_) {}
      try { window.removeEventListener?.('mouseup', this._onMouseUp); } catch (_) {}
      try { window.removeEventListener?.('keydown', this._onKeyDown); } catch (_) {}
      try { window.removeEventListener?.('keyup', this._onKeyUp); } catch (_) {}
      this._panZoomInstalled = false;
      this._onWheel = null;
      this._onMouseDown = null;
      this._onMouseMove = null;
      this._onMouseUp = null;
      this._onKeyDown = null;
      this._onKeyUp = null;
      this._spaceDown = false;
      this._panning.active = false;
      
      if (this.container) {
        this.container.innerHTML = '';
      }
      
      this.nodes.clear();
      this.connections = [];
    }
  }

  // Create global instance
  window.reteFlowRenderer = new ReteFlowRenderer();

  console.log('[rete-renderer] Rete-style flow renderer loaded');
})();
