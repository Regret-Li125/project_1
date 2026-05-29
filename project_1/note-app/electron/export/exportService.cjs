const fs = require('node:fs/promises');
const path = require('node:path');
const { createWriteStream } = require('node:fs');
const { dialog } = require('electron');
const archiver = require('archiver');

class ExportService {
  sanitizeFileName(name) {
    return name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 200);
  }

  escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  sanitizeUrl(rawUrl, allowRelative = false) {
    const value = String(rawUrl || '').trim();
    const compactValue = value.replace(/\s/g, '').toLowerCase();

    if (
      !value ||
      compactValue.startsWith('javascript:') ||
      compactValue.startsWith('vbscript:') ||
      compactValue.startsWith('file:') ||
      compactValue.startsWith('data:') ||
      compactValue.startsWith('//')
    ) {
      return '#';
    }

    if (allowRelative && !/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      return this.escapeHtml(value);
    }

    try {
      const parsed = new URL(value);
      if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        return this.escapeHtml(value);
      }
    } catch {
      // Invalid absolute URLs are intentionally converted to a harmless anchor.
    }

    return '#';
  }

  createNoteFileNameMap(notes, extension) {
    const usedNames = new Set();
    const fileNameById = new Map();

    for (const note of notes) {
      const baseName = this.sanitizeFileName(note.title || 'untitled') || 'untitled';
      let fileName = `${baseName}.${extension}`;

      if (usedNames.has(fileName)) {
        const idSuffix = String(note.id || Date.now()).slice(0, 8);
        fileName = `${baseName}-${idSuffix}.${extension}`;
      }

      let counter = 2;
      while (usedNames.has(fileName)) {
        fileName = `${baseName}-${counter}.${extension}`;
        counter++;
      }

      usedNames.add(fileName);
      fileNameById.set(note.id, fileName);
    }

    return fileNameById;
  }

  markdownToHtml(content) {
    // Use null-byte prefix to avoid collision with real user content
    const CB = '\x00CB_';
    const IC = '\x00IC_';

    const codeBlocks = [];
    let html = content.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const placeholder = `${CB}${codeBlocks.length}\x00`;
      codeBlocks.push(`<pre><code class="language-${lang}">${this.escapeHtml(code)}</code></pre>`);
      return placeholder;
    });

    const inlineCodes = [];
    html = html.replace(/`(.+?)`/g, (_, code) => {
      const placeholder = `${IC}${inlineCodes.length}\x00`;
      inlineCodes.push(`<code>${this.escapeHtml(code)}</code>`);
      return placeholder;
    });

    html = this.escapeHtml(html);

    // Strikethrough
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold and italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Images
    html = html.replace(/!\[(.+?)\]\((.+?)\)/g, (_match, alt, src) => (
      `<img src="${this.sanitizeUrl(src, true)}" alt="${alt}" />`
    ));

    // Links
    html = html.replace(/\[(.+?)\]\((.+?)\)/g, (_match, text, href) => (
      `<a href="${this.sanitizeUrl(href, true)}">${text}</a>`
    ));

    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // Tables
    html = html.replace(/^(\|.+\|)\n(\|[-: |]+\|)\n((?:\|.+\|\n?)+)/gm, (_match, headerRow, separatorRow, bodyRows) => {
      const parseCells = (row) => row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const headers = parseCells(headerRow);
      const rows = bodyRows.trim().split('\n').map(parseCells);
      let table = '<table><thead><tr>';
      for (const h of headers) {
        table += `<th>${h}</th>`;
      }
      table += '</tr></thead><tbody>';
      for (const row of rows) {
        table += '<tr>';
        for (const cell of row) {
          table += `<td>${cell}</td>`;
        }
        table += '</tr>';
      }
      table += '</tbody></table>';
      return table;
    });

    // Task lists
    html = html.replace(/^(\s*)- \[x\] (.+)$/gm, '$1<li class="task-list-item"><input type="checkbox" checked disabled /> $2</li>');
    html = html.replace(/^(\s*)- \[ \] (.+)$/gm, '$1<li class="task-list-item"><input type="checkbox" disabled /> $2</li>');

    // Unordered lists (skip lines already wrapped as task-list-item)
    html = html.replace(/^(\s*)- (.+)$/gm, '$1<li>$2</li>');

    // Ordered lists
    html = html.replace(/^(\s*)\d+\. (.+)$/gm, '$1<li>$2</li>');

    // Group consecutive <li> into <ul> or <ol>, supporting nested indentation
    html = this._groupListItems(html);

    // Horizontal rule
    html = html.replace(/^---$/gm, '<hr>');

    // Paragraphs
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/<p>(<h[1-6]>)/g, '$1');
    html = html.replace(/(<\/h[1-6]>)<\/p>/g, '$1');
    html = html.replace(/<p>(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)<\/p>/g, '$1');
    html = html.replace(/<p>(<ol>)/g, '$1');
    html = html.replace(/(<\/ol>)<\/p>/g, '$1');
    html = html.replace(/<p>(<blockquote>)/g, '$1');
    html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
    html = html.replace(/<p>(<pre>)/g, '$1');
    html = html.replace(/(<\/pre>)<\/p>/g, '$1');
    html = html.replace(/<p>(<hr>)/g, '$1');
    html = html.replace(/(<hr>)<\/p>/g, '$1');
    html = html.replace(/<p>(<table>)/g, '$1');
    html = html.replace(/(<\/table>)<\/p>/g, '$1');

    // Restore code blocks and inline code (reverse order)
    for (let i = codeBlocks.length - 1; i >= 0; i--) {
      html = html.replace(`${CB}${i}\x00`, codeBlocks[i]);
    }
    for (let i = inlineCodes.length - 1; i >= 0; i--) {
      html = html.replace(`${IC}${i}\x00`, inlineCodes[i]);
    }

    return html;
  }

  _groupListItems(html) {
    const lines = html.split('\n');
    const result = [];
    const stack = [];

    const closeToDepth = (targetDepth) => {
      while (stack.length > targetDepth) {
        const tag = stack.pop();
        result.push(`</${tag}>`);
      }
    };

    for (const line of lines) {
      const liMatch = line.match(/^(\s*)<li/);
      if (liMatch) {
        const indent = liMatch[1].length;
        const depth = Math.floor(indent / 2);
        const tag = 'ul';

        if (depth >= stack.length) {
          for (let i = stack.length; i <= depth; i++) {
            result.push(`${'  '.repeat(i)}<${tag}>`);
            stack.push(tag);
          }
        } else {
          closeToDepth(depth);
        }

        result.push(`${'  '.repeat(depth + 1)}${line.trim()}`);
      } else {
        closeToDepth(0);
        result.push(line);
      }
    }
    closeToDepth(0);

    return result.join('\n');
  }

  async selectExportDirectory() {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: '选择导出位置',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  }

  async selectSaveFile(defaultName) {
    const result = await dialog.showSaveDialog({
      title: '保存导出文件',
      defaultPath: defaultName,
      filters: [
        { name: 'ZIP 压缩包', extensions: ['zip'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    return result.filePath;
  }

  generateMarkdownContent(note) {
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

  generateMetadataJson(notes, folders) {
    return JSON.stringify({
      exportDate: new Date().toISOString(),
      version: 1,
      notes: notes.map((n) => ({
        id: n.id,
        title: n.title,
        tags: n.tags,
        sourceType: n.sourceType,
        sourceUrl: n.sourceUrl,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId,
      })),
    }, null, 2);
  }

  generateReadme(noteCount, folderCount) {
    return `# 知识库导出

此目录包含从个人知识库导出的笔记。

## 导出信息

- 导出日期: ${new Date().toLocaleString('zh-CN')}
- 笔记数量: ${noteCount}
- 文件夹数量: ${folderCount}

## 内容

- \`notes/\` - 笔记文件
- \`metadata.json\` - 元数据信息
- \`README.md\` - 本说明文件

## 使用说明

这些笔记是标准的 Markdown 文件，可以被任何 Markdown 编辑器打开。

笔记中的 \`[[双链]]\` 语法是内部链接格式，需要在支持双链的工具中使用。

## 隐私说明

此导出不包含：
- 本机绝对路径
- 应用日志
- 未选择的笔记
`;
  }

  async exportMarkdownZip(notes, folders, savePath) {
    const output = createWriteStream(savePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
      output.on('close', () => {
        resolve({ success: true, path: savePath, size: archive.pointer() });
      });

      archive.on('error', (err) => {
        output.destroy();
        reject(err);
      });

      archive.pipe(output);

      const fileNameById = this.createNoteFileNameMap(notes, 'md');

      for (const note of notes) {
        const fileName = `notes/${fileNameById.get(note.id)}`;
        const content = this.generateMarkdownContent(note);
        archive.append(content, { name: fileName });
      }

      const metadata = this.generateMetadataJson(notes, folders);
      archive.append(metadata, { name: 'metadata.json' });

      const readme = this.generateReadme(notes.length, folders.length);
      archive.append(readme, { name: 'README.md' });

      archive.finalize().catch((error) => {
        output.destroy();
        reject(error);
      });
    });
  }

  async exportHtmlZip(notes, folders, savePath) {
    const output = createWriteStream(savePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
      output.on('close', () => {
        resolve({ success: true, path: savePath, size: archive.pointer() });
      });

      archive.on('error', (err) => {
        output.destroy();
        reject(err);
      });

      archive.pipe(output);

      const fileNameById = this.createNoteFileNameMap(notes, 'html');

      for (const note of notes) {
        const fileName = `notes/${fileNameById.get(note.id)}`;
        const html = this.generateNoteHtml(note, notes, fileNameById);
        archive.append(html, { name: fileName });
      }

      const indexHtml = this.generateIndexHtml(notes, fileNameById);
      archive.append(indexHtml, { name: 'index.html' });

      const metadata = this.generateMetadataJson(notes, folders);
      archive.append(metadata, { name: 'metadata.json' });

      archive.finalize().catch((error) => {
        output.destroy();
        reject(error);
      });
    });
  }

  async exportMarkdownDirectory(notes, folders, exportPath) {
    const notesDir = path.join(exportPath, 'notes');

    await fs.mkdir(notesDir, { recursive: true });

    const fileNameById = this.createNoteFileNameMap(notes, 'md');

    for (const note of notes) {
      const fileName = fileNameById.get(note.id);
      const filePath = path.join(notesDir, fileName);
      const content = this.generateMarkdownContent(note);
      await fs.writeFile(filePath, content, 'utf-8');
    }

    const metadata = this.generateMetadataJson(notes, folders);
    await fs.writeFile(path.join(exportPath, 'metadata.json'), metadata, 'utf-8');

    const readme = this.generateReadme(notes.length, folders.length);
    await fs.writeFile(path.join(exportPath, 'README.md'), readme, 'utf-8');

    return { success: true, path: exportPath };
  }

  generateNoteHtml(note, allNotes, fileNameById) {
    let contentHtml = this.markdownToHtml(note.content);

    // Process internal links
    contentHtml = contentHtml.replace(
      /\[\[([^\]|]+)(\|([^\]]*))?\]\]/g,
      (_, targetTitle, __, displayText) => {
        const targetNote = allNotes.find(
          (n) => n.title.toLowerCase() === targetTitle.toLowerCase()
        );
        const text = displayText || targetTitle;
        if (targetNote) {
          const fileName = fileNameById.get(targetNote.id);
          return `<a href="${fileName}" class="internal-link">${this.escapeHtml(text)}</a>`;
        }
        return `<span class="unresolved-link">${this.escapeHtml(text)}</span>`;
      }
    );

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" />
  <title>${this.escapeHtml(note.title || '未命名笔记')}</title>
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
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .internal-link { color: #7c3aed; font-weight: 500; }
    .unresolved-link { color: #9ca3af; border-bottom: 1px dashed #9ca3af; }
    .tags { margin-top: 20px; padding-top: 10px; border-top: 1px solid #eee; }
    .tag {
      display: inline-block;
      background: #e5e7eb;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.9em;
      margin-right: 4px;
    }
    .source-url { color: #666; font-size: 0.9em; }
    table { border-collapse: collapse; margin: 1em 0; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #f4f4f4; font-weight: 600; }
    tr:nth-child(even) { background: #fafafa; }
    .task-list-item { list-style: none; margin-left: -1.5em; }
    .task-list-item input[type="checkbox"] { margin-right: 6px; }
  </style>
</head>
<body>
  <h1>${this.escapeHtml(note.title || '未命名笔记')}</h1>
  ${note.sourceUrl ? `<p class="source-url">来源: <a href="${this.sanitizeUrl(note.sourceUrl)}">${this.escapeHtml(note.sourceUrl)}</a></p>` : ''}
  ${contentHtml}
  ${note.tags.length > 0 ? `
  <div class="tags">
    ${note.tags.map((tag) => `<span class="tag">${this.escapeHtml(tag)}</span>`).join(' ')}
  </div>
  ` : ''}
</body>
</html>`;
  }

  generateIndexHtml(notes, fileNameById) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" />
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
    h1 { font-size: 2em; border-bottom: 2px solid #eee; padding-bottom: 0.3em; }
    .note-list { list-style: none; padding: 0; }
    .note-item { padding: 12px 0; border-bottom: 1px solid #eee; }
    .note-item:last-child { border-bottom: none; }
    .note-link { color: #0066cc; text-decoration: none; font-size: 1.1em; font-weight: 500; }
    .note-link:hover { text-decoration: underline; }
    .note-meta { color: #666; font-size: 0.9em; margin-top: 4px; }
    .note-tags { margin-top: 4px; }
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
      .slice()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((note) => `
    <li class="note-item">
      <a href="notes/${fileNameById.get(note.id)}" class="note-link">
        ${this.escapeHtml(note.title || '未命名笔记')}
      </a>
      <div class="note-meta">
        更新时间: ${new Date(note.updatedAt).toLocaleString('zh-CN')}
      </div>
      ${note.tags.length > 0 ? `
      <div class="note-tags">
        ${note.tags.map((tag) => `<span class="tag">${this.escapeHtml(tag)}</span>`).join(' ')}
      </div>
      ` : ''}
    </li>`)
      .join('')}
  </ul>
</body>
</html>`;
  }

  async exportHtmlDirectory(notes, folders, exportPath) {
    const notesDir = path.join(exportPath, 'notes');

    await fs.mkdir(notesDir, { recursive: true });

    const fileNameById = this.createNoteFileNameMap(notes, 'html');

    for (const note of notes) {
      const fileName = fileNameById.get(note.id);
      const filePath = path.join(notesDir, fileName);
      const html = this.generateNoteHtml(note, notes, fileNameById);
      await fs.writeFile(filePath, html, 'utf-8');
    }

    const indexHtml = this.generateIndexHtml(notes, fileNameById);
    await fs.writeFile(path.join(exportPath, 'index.html'), indexHtml, 'utf-8');

    const metadata = this.generateMetadataJson(notes, folders);
    await fs.writeFile(path.join(exportPath, 'metadata.json'), metadata, 'utf-8');

    return { success: true, path: exportPath };
  }
}

module.exports = {
  exportService: new ExportService(),
};
