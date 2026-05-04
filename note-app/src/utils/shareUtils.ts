import type { Note, Folder, Attachment, ShareScope, ShareResult } from '../types/note';

export function collectShareScope(
  notes: Note[],
  folders: Folder[],
  scope: ShareScope
): ShareResult {
  let selectedNotes: Note[] = [];
  let selectedFolders: Folder[] = [];

  switch (scope.type) {
    case 'note': {
      const note = notes.find((n) => n.id === scope.noteId);
      if (note) {
        selectedNotes = [note];
      }
      break;
    }
    case 'folder': {
      const folder = folders.find((f) => f.id === scope.folderId);
      if (folder) {
        selectedFolders = [folder];
        selectedNotes = notes.filter((n) => n.folderId === scope.folderId);
      }
      break;
    }
    case 'vault': {
      selectedNotes = [...notes];
      selectedFolders = [...folders];
      break;
    }
  }

  const selectedAttachments: Attachment[] = [];
  for (const note of selectedNotes) {
    if (note.attachments) {
      selectedAttachments.push(...note.attachments);
    }
  }

  return {
    notes: selectedNotes,
    folders: selectedFolders,
    attachments: selectedAttachments,
    noteCount: selectedNotes.length,
    folderCount: selectedFolders.length,
    attachmentCount: selectedAttachments.length,
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return escapeHtml(trimmed);
  }
  return '#';
}

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 200);
}

export function generateMarkdownContent(note: Note): string {
  let content = '';
  
  if (note.title) {
    content += `# ${note.title}\n\n`;
  }

  if (note.tags.length > 0) {
    content += `标签: ${note.tags.join(', ')}\n\n`;
  }

  if (note.sourceUrl) {
    content += `来源: ${note.sourceUrl}\n\n`;
  }

  content += note.content;

  return content;
}

export function generateMetadataJson(
  notes: Note[],
  folders: Folder[]
): string {
  const metadata = {
    exportDate: new Date().toISOString(),
    version: 1,
    notes: notes.map((n) => ({
      id: n.id,
      title: n.title,
      tags: n.tags,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    })),
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
    })),
  };

  return JSON.stringify(metadata, null, 2);
}

export function generateExportReadme(): string {
  return `# 知识库导出

此目录包含从个人知识库导出的笔记。

## 内容

- \`notes/\` - Markdown 笔记文件
- \`attachments/\` - 附件文件
- \`metadata.json\` - 元数据信息
- \`README.md\` - 本说明文件

## 使用说明

这些笔记是标准的 Markdown 文件，可以被任何 Markdown 编辑器打开。

笔记中的 \`[[双链]]\` 语法是内部链接格式，需要在支持双链的工具中使用。

导出日期: ${new Date().toLocaleString('zh-CN')}
`;
}

export function generateNoteHtml(note: Note, allNotes: Note[]): string {
  const processContent = (content: string): string => {
    let processed = content;
    
    processed = processed.replace(
      /\[\[([^\]|]+)(\|([^\]]*))?\]\]/g,
      (_, targetTitle, __, displayText) => {
        const targetNote = allNotes.find(
          (n) => n.title.toLowerCase() === targetTitle.toLowerCase()
        );
        const text = escapeHtml(displayText || targetTitle);
        if (targetNote) {
          const fileName = sanitizeFileName(targetNote.title || 'untitled') + '.html';
          return `<a href="${escapeHtml(fileName)}" class="internal-link">${text}</a>`;
        }
        return `<span class="unresolved-link">${text}</span>`;
      }
    );

    processed = processed.replace(
      /^### (.*$)/gm,
      (_, text) => `<h3>${escapeHtml(text)}</h3>`
    );
    processed = processed.replace(
      /^## (.*$)/gm,
      (_, text) => `<h2>${escapeHtml(text)}</h2>`
    );
    processed = processed.replace(
      /^# (.*$)/gm,
      (_, text) => `<h1>${escapeHtml(text)}</h1>`
    );
    processed = processed.replace(
      /\*\*(.*?)\*\*/g,
      (_, text) => `<strong>${escapeHtml(text)}</strong>`
    );
    processed = processed.replace(
      /\*(.*?)\*/g,
      (_, text) => `<em>${escapeHtml(text)}</em>`
    );
    processed = processed.replace(
      /`(.*?)`/g,
      (_, text) => `<code>${escapeHtml(text)}</code>`
    );
    processed = processed.replace(
      /^- (.*$)/gm,
      (_, text) => `<li>${escapeHtml(text)}</li>`
    );
    processed = processed.replace(
      /^\d+\. (.*$)/gm,
      (_, text) => `<li>${escapeHtml(text)}</li>`
    );
    processed = processed.replace(
      /^> (.*$)/gm,
      (_, text) => `<blockquote>${escapeHtml(text)}</blockquote>`
    );
    processed = processed.replace(
      /\n\n/g,
      '</p><p>'
    );

    return `<p>${processed}</p>`;
  };

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(note.title || '未命名笔记')}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      line-height: 1.6;
      color: #333;
    }
    h1, h2, h3 { margin-top: 1.5em; margin-bottom: 0.5em; }
    h1 { font-size: 2em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; }
    h3 { font-size: 1.2em; }
    code {
      background: #f4f4f4;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Monaco', 'Menlo', monospace;
    }
    pre {
      background: #f4f4f4;
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
    }
    pre code {
      background: none;
      padding: 0;
    }
    blockquote {
      border-left: 4px solid #ddd;
      margin: 0;
      padding-left: 16px;
      color: #666;
    }
    a {
      color: #0066cc;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .internal-link {
      color: #7c3aed;
      font-weight: 500;
    }
    .unresolved-link {
      color: #9ca3af;
      border-bottom: 1px dashed #9ca3af;
    }
    .tags {
      margin-top: 20px;
      padding-top: 10px;
      border-top: 1px solid #eee;
    }
    .tag {
      display: inline-block;
      background: #e5e7eb;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.9em;
      margin-right: 4px;
    }
    .source-url {
      color: #666;
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(note.title || '未命名笔记')}</h1>
  ${note.sourceUrl ? `<p class="source-url">来源: <a href="${sanitizeUrl(note.sourceUrl)}">${escapeHtml(note.sourceUrl)}</a></p>` : ''}
  ${processContent(note.content)}
  ${note.tags.length > 0 ? `
  <div class="tags">
    ${note.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join(' ')}
  </div>
  ` : ''}
</body>
</html>`;
}

export function generateIndexHtml(notes: Note[]): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>个人知识库</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      line-height: 1.6;
      color: #333;
    }
    h1 {
      font-size: 2em;
      border-bottom: 2px solid #eee;
      padding-bottom: 0.3em;
    }
    .note-list {
      list-style: none;
      padding: 0;
    }
    .note-item {
      padding: 12px 0;
      border-bottom: 1px solid #eee;
    }
    .note-item:last-child {
      border-bottom: none;
    }
    .note-link {
      color: #0066cc;
      text-decoration: none;
      font-size: 1.1em;
      font-weight: 500;
    }
    .note-link:hover {
      text-decoration: underline;
    }
    .note-meta {
      color: #666;
      font-size: 0.9em;
      margin-top: 4px;
    }
    .note-tags {
      margin-top: 4px;
    }
    .tag {
      display: inline-block;
      background: #e5e7eb;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.8em;
      margin-right: 4px;
    }
  </style>
</head>
<body>
  <h1>个人知识库</h1>
  <p>导出时间: ${new Date().toLocaleString('zh-CN')}</p>
  <p>笔记数量: ${notes.length}</p>
  
  <h2>笔记列表</h2>
  <ul class="note-list">
    ${notes
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map(
        (note) => `
    <li class="note-item">
      <a href="notes/${sanitizeFileName(note.title || 'untitled')}.html" class="note-link">
        ${escapeHtml(note.title || '未命名笔记')}
      </a>
      <div class="note-meta">
        更新时间: ${new Date(note.updatedAt).toLocaleString('zh-CN')}
      </div>
      ${note.tags.length > 0 ? `
      <div class="note-tags">
        ${note.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join(' ')}
      </div>
      ` : ''}
    </li>`
      )
      .join('')}
  </ul>
</body>
</html>`;
}
