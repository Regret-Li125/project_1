import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import type { Note, LinkGraph } from '../types/note';
import { parseLinks } from '../utils/linkParser';

interface KnowledgeGraphProps {
  notes: Note[];
  selectedNoteId: string | null;
  onNoteSelect: (noteId: string) => void;
  onClose: () => void;
}

type Vec2 = { x: number; y: number };

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
      const dist = Math.sqrt(dx * dx + dy * dy);
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
  const [viewBox, setViewBox] = useState({ width: 800, height: 600 });

  const graph = useMemo<LinkGraph>(() => {
    const nodes = notes.map((note) => ({
      id: note.id,
      title: note.title || '未命名笔记',
      tags: note.tags,
    }));

    const edges: LinkGraph['edges'] = [];
    const unresolvedLinks: LinkGraph['unresolvedLinks'] = [];
    const titles = new Map(notes.map((n) => [n.title.toLowerCase(), n.id]));

    for (const note of notes) {
      const links = parseLinks(note.content);
      for (const link of links) {
        const targetId = titles.get(link.targetTitle.toLowerCase());
        if (targetId) {
          edges.push({
            source: note.id,
            target: targetId,
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
  }, [notes]);

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

  const computedPositions = useMemo(
    () => forceLayout(filteredGraph.nodes, filteredGraph.edges, viewBox.width, viewBox.height),
    [filteredGraph, viewBox]
  );

  // Mutable positions ref + render trigger for drag updates
  const positionsRef = useRef<Map<string, Vec2>>(computedPositions);
  const [, forceRender] = useState(0);

  // Sync ref when computed positions change (new layout)
  if (positionsRef.current !== computedPositions) {
    positionsRef.current = computedPositions;
  }

  // Drag state
  const [dragging, setDragging] = useState<string | null>(null);
  const dragOffset = useRef<Vec2>({ x: 0, y: 0 });

  const handleMouseDown = useCallback((nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const pos = positionsRef.current.get(nodeId);
    if (!pos) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = viewBox.width / rect.width;
    const scaleY = viewBox.height / rect.height;
    dragOffset.current = {
      x: (e.clientX - rect.left) * scaleX - pos.x,
      y: (e.clientY - rect.top) * scaleY - pos.y,
    };
    setDragging(nodeId);
  }, [viewBox]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = viewBox.width / rect.width;
    const scaleY = viewBox.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX - dragOffset.current.x;
    const y = (e.clientY - rect.top) * scaleY - dragOffset.current.y;
    const pos = positionsRef.current.get(dragging);
    if (pos) {
      pos.x = Math.max(20, Math.min(viewBox.width - 20, x));
      pos.y = Math.max(20, Math.min(viewBox.height - 20, y));
      forceRender((n) => n + 1);
    }
  }, [dragging, viewBox]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

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
            {filteredGraph.edges.map((edge, i) => {
              const source = positionsRef.current.get(edge.source);
              const target = positionsRef.current.get(edge.target);
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

            {filteredGraph.nodes.map((node) => {
              const pos = positionsRef.current.get(node.id);
              if (!pos) return null;
              const isSelected = node.id === selectedNoteId;
              const hasLinks = graph.edges.some(
                (e) => e.source === node.id || e.target === node.id
              );

              return (
                <g
                  key={node.id}
                  className={`graph-node ${isSelected ? 'selected' : ''} ${hasLinks ? 'connected' : 'isolated'}`}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onClick={() => onNoteSelect(node.id)}
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
