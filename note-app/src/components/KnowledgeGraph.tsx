import React, { useMemo, useState, useCallback } from 'react';
import type { Note, LinkGraph } from '../types/note';
import { parseLinks } from '../utils/linkParser';

interface KnowledgeGraphProps {
  notes: Note[];
  selectedNoteId: string | null;
  onNoteSelect: (noteId: string) => void;
  onClose: () => void;
}

export const KnowledgeGraph: React.FC<KnowledgeGraphProps> = ({
  notes,
  selectedNoteId,
  onNoteSelect,
  onClose,
}) => {
  const [showIsolated, setShowIsolated] = useState(true);

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

  const getNodePosition = useCallback(
    (index: number, total: number) => {
      const centerX = 400;
      const centerY = 300;
      const radius = 200;

      if (total <= 1) return { x: centerX, y: centerY };

      const angle = (2 * Math.PI * index) / total - Math.PI / 2;
      return {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      };
    },
    []
  );

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
          <svg className="graph-svg" viewBox="0 0 800 600">
            {/* 绘制边 */}
            {filteredGraph.edges.map((edge, i) => {
              const sourceIndex = filteredGraph.nodes.findIndex(
                (n) => n.id === edge.source
              );
              const targetIndex = filteredGraph.nodes.findIndex(
                (n) => n.id === edge.target
              );
              if (sourceIndex === -1 || targetIndex === -1) return null;

              const source = getNodePosition(
                sourceIndex,
                filteredGraph.nodes.length
              );
              const target = getNodePosition(
                targetIndex,
                filteredGraph.nodes.length
              );

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

            {/* 绘制节点 */}
            {filteredGraph.nodes.map((node, index) => {
              const pos = getNodePosition(index, filteredGraph.nodes.length);
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