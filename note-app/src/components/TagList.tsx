import React from 'react';

interface TagListProps {
  tags: { name: string; count: number }[];
  selectedTag: string | null;
  onTagSelect: (tag: string | null) => void;
}

export const TagList: React.FC<TagListProps> = React.memo(({
  tags,
  selectedTag,
  onTagSelect,
}) => {
  if (tags.length === 0) {
    return (
      <div className="sidebar-section">
        <h3 className="sidebar-title">标签</h3>
        <div className="sidebar-empty">
          <p className="empty-title">还没有标签</p>
          <p className="empty-description">在笔记里添加标签后，这里会自动整理。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar-section">
      <h3 className="sidebar-title">标签</h3>
      <ul className="tag-list">
        {tags.map((tag) => (
          <li key={tag.name}>
            <button
              className={`tag-button ${selectedTag === tag.name ? 'active' : ''}`}
              onClick={() => onTagSelect(selectedTag === tag.name ? null : tag.name)}
            >
              {tag.name}
              <span className="tag-count">{tag.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
});