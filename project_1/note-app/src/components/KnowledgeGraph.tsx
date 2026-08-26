import React, { useMemo, useState, useCallback, useRef } from 'react';
import type { Note, LinkGraph } from '../types/note';
import { parseLinks, extractLinksFromNote, resolveNoteByTitle } from '../utils/linkParser';

interface KnowledgeGraphProps {
  notes: Note[];
  selectedNoteId: string | null;
  onNoteSelect: (noteId: string) => void;
  onClose: () => void;
}

type Vec2 = { x: number; y: number };

// 参与力导向布局的节点上限，超出时截断并在 UI 提示
const MAX_LAYOUT_NODES = 300;

function forceLayout(nodes: { id: string }[], edges: { source: string; target: string }[], width: number, height: number): Map<string, Vec2> {
  const positions = new Map<string, Vec2>();
  const centerX = width / 2;
  const centerY = height / 2;

  // Initialize positions in a circle
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    const radius = Math.min(width, height) * 0.3;
    positions.set(node.id, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  });

  if (nodes.length <= 1) return positions;

  const edgeSet = new Map<string, string[]>();
  for (const edge of edges) {
    if (!edgeSet.has(edge.source)) edgeSet.set(edge.source, []);
    if (!edgeSet.has(edge.target)) edgeSet.set(edge.target, []);
    edgeSet.get(edge.source)!.push(edge.target);
    edgeSet.get(edge.target)!.push(edge.source);
  }

  const velocities = new Map<string, Vec2>();
  nodes.forEach((n) => velocities.set(n.id, { x: 0, y: 0 }));

  const iterations = 120;
  const repulsion = 2000;
  const attraction = 0.01;
  const damping = 0.9;
  const centerGravity = 0.005;

  for (let iter = 0; iter < iterations; iter++) {
    const temp = 1 - iter / iterations;

    // Repulsion between all node pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = positions.get(nodes[i].id)!;
        const b = positions.get(nodes[j].id)!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (repulsion * temp) / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        velocities.get(nodes[i].id)!.x += fx;
        velocities.get(nodes[i].id)!.y += fy;
        velocities.get(nodes[j].id)!.x -= fx;
        velocities.get(nodes[j].id)!.y -= fy;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const a = positions.get(edge.source);
      const b = positions.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      // 除零保护：两点重合时 dist 为 0
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = dist * attraction * temp;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      velocities.get(edge.source)!.x += fx;
      velocities.get(edge.source)!.y += fy;
      velocities.get(edge.target)!.x -= fx;
      velocities.get(edge.target)!.y -= fy;
    }

    // Center gravity
    for (const node of nodes) {
      const pos = positions.get(node.id)!;
      velocities.get(node.id)!.x += (centerX - pos.x) * centerGravity;
      velocities.get(node.id)!.y += (centerY - pos.y) * centerGravity;
    }

    // Apply velocities
    for (const node of nodes) {
      const pos = positions.get(node.id)!;
      const vel = velocities.get(node.id)!;
      vel.x *= damping;
      vel.y *= damping;
      pos.x += vel.x;
      pos.y += vel.y;
      // Keep within bounds
      pos.x = Math.max(40, Math.min(width - 40, pos.x));
      pos.y = Math.max(40, Math.min(height - 40, pos.y));
    }
  }

  return positions;
}

export const KnowledgeGraph: React.FC<KnowledgeGraphProps> = ({
  notes,
  selectedNoteId,
  onNoteSelect,
  onClose,
}) => {
  const [showIsolated, setShowIsolated] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewBox] = useState({ width: 800, height: 600 });

  // 布局与构图只依赖内容摘要（id+标题+链接），避免 notes 引用变化导致的全量重算
  const notesDigest = notes
    .map((n) => `${n.id}:${n.title}:${n.updatedAt}:${extractLinksFromNote(n.content).join(',')}`)
    .join('|');

  const graph = useMemo<LinkGraph>(() => {
    const nodes = notes.map((note) => ({
      id: note.id,
      title: note.title || '未命名笔记',
      tags: note.tags,
    }));

    const edges: LinkGraph['edges'] = [];
    const unresolvedLinks: LinkGraph['unresolvedLinks'] = [];

    for (const note of notes) {
      const links = parseLinks(note.content);
      for (const link of links) {
        // 与反链面板共用同一解析逻辑：忽略大小写/首尾空格，重名取 updatedAt 最新者
        const target = resolveNoteByTitle(notes, link.targetTitle);
        if (target) {
          edges.push({
            source: note.id,
            target: target.id,
            label: link.displayText,
          });
        } else {
          unresolvedLinks.push({
            sourceNoteId: note.id,
            targetTitle: link.targetTitle,
          });
        }
      }
    }

    return { nodes, edges, unresolvedLinks };
    // 依赖内容摘要而非 notes 引用，摘要覆盖 id/title/链接/updatedAt 的实际变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesDigest]);

  const filteredGraph = useMemo(() => {
    if (showIsolated) return graph;

    const connectedNodeIds = new Set<string>();
    for (const edge of graph.edges) {
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    }

    return {
      ...graph,
      nodes: graph.nodes.filter((n) => connectedNodeIds.has(n.id)),
    };
  }, [graph, showIsolated]);

  // 节点数量超过上限时截断参与布局的集合，避免布局计算与渲染卡顿
  const layoutGraph = useMemo(() => {
    if (filteredGraph.nodes.length <= MAX_LAYOUT_NODES) {
      return { graph: filteredGraph, truncated: false };
    }
    const keptNodes = filteredGraph.nodes.slice(0, MAX_LAYOUT_NODES);
    const keptIds = new Set(keptNodes.map((n) => n.id));
    return {
      graph: {
        ...filteredGraph,
        nodes: keptNodes,
        edges: filteredGraph.edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target)),
      },
      truncated: true,
    };
  }, [filteredGraph]);

  const computedPositions = useMemo(
    () => forceLayout(layoutGraph.graph.nodes, layoutGraph.graph.edges, viewBox.width, viewBox.height),
    [layoutGraph, viewBox]
  );

  // Drag overrides: positions manually moved by user, layered on top of computed layout
  const [dragOverrides, setDragOverrides] = useState<Map<string, Vec2>>(() => new Map());

  // 节点集合变化时清空拖拽覆盖，避免已消失节点的残留坐标
  // （渲染期间对比 key 并调整 state，React 会在提交前立即重渲染一次）
  const layoutNodeIdsKey = layoutGraph.graph.nodes.map((n) => n.id).join('|');
  const [prevNodeIdsKey, setPrevNodeIdsKey] = useState(layoutNodeIdsKey);
  if (prevNodeIdsKey !== layoutNodeIdsKey) {
    setPrevNodeIdsKey(layoutNodeIdsKey);
    setDragOverrides(new Map());
  }

  // Derive display positions: computed base + drag overrides
  const positions = useMemo(() => {
    const merged = new Map(computedPositions);
    for (const [id, override] of dragOverrides) {
      merged.set(id, override);
    }
    return merged;
  }, [computedPositions, dragOverrides]);

  // 预计算有连接的节点集合，避免渲染时逐节点扫描 edges
  const connectedIds = useMemo(() => {
    const set = new Set<string>();
    for (const e of graph.edges) {
      set.add(e.source);
      set.add(e.target);
    }
    return set;
  }, [graph.edges]);

  // Drag state
  const [dragging, setDragging] = useState<string | null>(null);
  const dragOffset = useRef<Vec2>({ x: 0, y: 0 });
  const dragStart = useRef<Vec2>({ x: 0, y: 0 });
  const dragMoved = useRef(false);
  const moveRaf = useRef<number | null>(null);
  const pendingPointer = useRef<{ clientX: number; clientY: number } | null>(null);

  // 用 SVG 自身 CTM 逆矩阵做屏幕坐标 → viewBox 坐标的精确换算，
  // 兼容 preserveAspectRatio 带来的非均匀缩放/留白
  const toSvgPoint = useCallback((clientX: number, clientY: number): Vec2 | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: point.x, y: point.y };
  }, []);

  const handleMouseDown = useCallback((nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const pos = positions.get(nodeId);
    if (!pos) return;
    const svgPoint = toSvgPoint(e.clientX, e.clientY);
    if (!svgPoint) return;
    dragOffset.current = { x: svgPoint.x - pos.x, y: svgPoint.y - pos.y };
    dragStart.current = pos;
    dragMoved.current = false;
    setDragging(nodeId);
  }, [positions, toSvgPoint]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    pendingPointer.current = { clientX: e.clientX, clientY: e.clientY };
    // requestAnimationFrame 节流：每帧最多更新一次拖拽位置
    if (moveRaf.current !== null) return;
    moveRaf.current = requestAnimationFrame(() => {
      moveRaf.current = null;
      const pointer = pendingPointer.current;
      if (!pointer) return;
      const svgPoint = toSvgPoint(pointer.clientX, pointer.clientY);
      if (!svgPoint) return;
      const x = svgPoint.x - dragOffset.current.x;
      const y = svgPoint.y - dragOffset.current.y;
      // 位移超过阈值视为真实拖拽，随后拦截 click，避免拖完误切选中笔记
      const dx = x - dragStart.current.x;
      const dy = y - dragStart.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > 3) {
        dragMoved.current = true;
      }
      setDragOverrides((prev) => {
        const next = new Map(prev);
        next.set(dragging, {
          x: Math.max(20, Math.min(viewBox.width - 20, x)),
          y: Math.max(20, Math.min(viewBox.height - 20, y)),
        });
        return next;
      });
    });
  }, [dragging, viewBox, toSvgPoint]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  const handleNodeClick = useCallback((nodeId: string) => {
    // 拖拽位移超阈值后拦截紧随的 click
    if (dragMoved.current) {
      dragMoved.current = false;
      return;
    }
    onNoteSelect(nodeId);
  }, [onNoteSelect]);

  return (
    <div className="knowledge-graph-overlay">
      <div className="knowledge-graph">
        <div className="graph-header">
          <h2>知识图谱</h2>
          <div className="graph-controls">
            <label className="graph-toggle">
              <input
                type="checkbox"
                checked={showIsolated}
                onChange={(e) => setShowIsolated(e.target.checked)}
              />
              显示孤立节点
            </label>
            <button className="graph-close-btn" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
        {layoutGraph.truncated && (
          <p className="graph-truncated-hint">
            笔记数量较多，仅前 {MAX_LAYOUT_NODES} 个节点参与布局显示。
          </p>
        )}
        {filteredGraph.nodes.length === 0 ? (
          <div className="graph-empty">
            <p className="empty-title">
              {notes.length === 0 ? '还没有笔记' : '还没有形成链接关系'}
            </p>
            <p className="empty-description">
              {notes.length === 0
                ? '创建第一篇笔记，开始构建你的知识网络。'
                : '在笔记中使用 [[笔记标题]]，图谱会自动连接起来。'}
            </p>
          </div>
        ) : (
          <svg
            ref={svgRef}
            className="graph-svg"
            viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {layoutGraph.graph.edges.map((edge, i) => {
              const source = positions.get(edge.source);
              const target = positions.get(edge.target);
              if (!source || !target) return null;

              return (
                <line
                  key={`edge-${i}`}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  className="graph-edge"
                />
              );
            })}

            {layoutGraph.graph.nodes.map((node) => {
              const pos = positions.get(node.id);
              if (!pos) return null;
              const isSelected = node.id === selectedNoteId;
              const hasLinks = connectedIds.has(node.id);

              return (
                <g
                  key={node.id}
                  className={`graph-node ${isSelected ? 'selected' : ''} ${hasLinks ? 'connected' : 'isolated'}`}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onClick={() => handleNodeClick(node.id)}
                  onMouseDown={(e) => handleMouseDown(node.id, e)}
                  style={{ cursor: dragging === node.id ? 'grabbing' : 'grab' }}
                >
                  <circle r={isSelected ? 12 : 8} />
                  <text
                    dy={isSelected ? 20 : 16}
                    textAnchor="middle"
                    className="graph-node-label"
                  >
                    {node.title.length > 10
                      ? node.title.slice(0, 10) + '...'
                      : node.title}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
};
