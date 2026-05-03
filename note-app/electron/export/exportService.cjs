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
    let html = this.escapeHtml(content);

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold and italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Inline code
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');

    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code class="language-${lang}">${code}</code></pre>`;
    });

    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // Unordered lists
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Images
    html = html.replace(/!\[(.+?)\]\((.+?)\)/g, (_match, alt, src) => (
      `<img src="${this.sanitizeUrl(src, true)}" alt="${alt}" />`
    ));

    // Links
    html = html.replace(/\[(.+?)\]\((.+?)\)/g, (_match, text, href) => (
      `<a href="${this.sanitizeUrl(href, true)}">${text}</a>`
    ));

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
    html = html.replace(/<p>(<blockquote>)/g, '$1');
    html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
    html = html.replace(/<p>(<pre>)/g, '$1');
    html = html.replace(/(<\/pre>)<\/p>/g, '$1');
    html = html.replace(/<p>(<hr>)/g, '$1');
    html = html.replace(/(<hr>)<\/p>/g, '$1');

    return html;
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

  generateReadme(noteCount, folderCount, attachmentCount) {
    return `# 知识库导出

此目录包含从个人知识库导出的笔记。

## 导出信息

- 导出日期: ${new Date().toLocaleString('zh-CN')}
- 笔记数量: ${noteCount}
- 文件夹数量: ${folderCount}
- 附件数量: ${attachmentCount}

## 内容

- \`notes/\` - Markdown 笔记文件
- \`attachments/\` - 附件文件
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

  async copyAttachments(attachments, sourceDir, destDir) {
    let copiedCount = 0;
    for (const attachment of attachments) {
      try {
        const sourcePath = attachment.path;
        const destPath = path.join(destDir, attachment.name);
        
        try {
          await fs.access(sourcePath);
          await fs.copyFile(sourcePath, destPath);
          copiedCount++;
        } catch {
          console.warn(`Attachment not found: ${sourcePath}`);
        }
      } catch (error) {
        console.error(`Failed to copy attachment: ${attachment.name}`, error);
      }
    }
    return copiedCount;
  }

  async exportMarkdownZip(notes, folders, attachments, savePath) {
    return new Promise(async (resolve, reject) => {
      try {
        const output = createWriteStream(savePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
          resolve({ success: true, path: savePath, size: archive.pointer() });
        });

        archive.on('error', (err) => {
          reject(err);
        });

        archive.pipe(output);

        const fileNameById = this.createNoteFileNameMap(notes, 'md');

        // Add notes
        for (const note of notes) {
          const fileName = `notes/${fileNameById.get(note.id)}`;
          const content = this.generateMarkdownContent(note);
          archive.append(content, { name: fileName });
        }

        // Add metadata
        const metadata = this.generateMetadataJson(notes, folders);
        archive.append(metadata, { name: 'metadata.json' });

        // Add README
        const readme = this.generateReadme(notes.length, folders.length, attachments.length);
        archive.append(readme, { name: 'README.md' });

        // Add attachments
        for (const attachment of attachments) {
          try {
            await fs.access(attachment.path);
            archive.file(attachment.path, { name: `attachments/${attachment.name}` });
          } catch {
            console.warn(`Attachment not found: ${attachment.path}`);
          }
        }

        await archive.finalize();
      } catch (error) {
        reject(error);
      }
    });
  }

  async exportHtmlZip(notes, folders, attachments, savePath) {
    return new Promise(async (resolve, reject) => {
      try {
        const output = createWriteStream(savePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
          resolve({ success: true, path: savePath, size: archive.pointer() });
        });

        archive.on('error', (err) => {
          reject(err);
        });

        archive.pipe(output);

        const fileNameById = this.createNoteFileNameMap(notes, 'html');

        // Add notes as HTML
        for (const note of notes) {
          const fileName = `notes/${fileNameById.get(note.id)}`;
          const html = this.generateNoteHtml(note, notes, fileNameById);
          archive.append(html, { name: fileName });
        }

        // Add index.html
        const indexHtml = this.generateIndexHtml(notes, fileNameById);
        archive.append(indexHtml, { name: 'index.html' });

        // Add metadata
        const metadata = this.generateMetadataJson(notes, folders);
        archive.append(metadata, { name: 'metadata.json' });

        // Add attachments
        for (const attachment of attachments) {
          try {
            await fs.access(attachment.path);
            archive.file(attachment.path, { name: `attachments/${attachment.name}` });
          } catch {
            console.warn(`Attachment not found: ${attachment.path}`);
          }
        }

        await archive.finalize();
      } catch (error) {
        reject(error);
      }
    });
  }

  async exportMarkdownDirectory(notes, folders, attachments, exportPath) {
    const notesDir = path.join(exportPath, 'notes');
    const attachmentsDir = path.join(exportPath, 'attachments');

    await fs.mkdir(notesDir, { recursive: true });
    await fs.mkdir(attachmentsDir, { recursive: true });

    const fileNameById = this.createNoteFileNameMap(notes, 'md');

    // Write notes
    for (const note of notes) {
      const fileName = fileNameById.get(note.id);
      const filePath = path.join(notesDir, fileName);
      const content = this.generateMarkdownContent(note);
      await fs.writeFile(filePath, content, 'utf-8');
    }

    // Copy attachments
    const copiedAttachments = await this.copyAttachments(attachments, null, attachmentsDir);

    // Write metadata
    const metadata = this.generateMetadataJson(notes, folders);
    await fs.writeFile(path.join(exportPath, 'metadata.json'), metadata, 'utf-8');

    // Write README
    const readme = this.generateReadme(notes.length, folders.length, copiedAttachments);
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

  async exportHtmlDirectory(notes, folders, attachments, exportPath) {
    const notesDir = path.join(exportPath, 'notes');
    const attachmentsDir = path.join(exportPath, 'attachments');

    await fs.mkdir(notesDir, { recursive: true });
    await fs.mkdir(attachmentsDir, { recursive: true });

    const fileNameById = this.createNoteFileNameMap(notes, 'html');

    // Write notes as HTML
    for (const note of notes) {
      const fileName = fileNameById.get(note.id);
      const filePath = path.join(notesDir, fileName);
      const html = this.generateNoteHtml(note, notes, fileNameById);
      await fs.writeFile(filePath, html, 'utf-8');
    }

    // Write index.html
    const indexHtml = this.generateIndexHtml(notes, fileNameById);
    await fs.writeFile(path.join(exportPath, 'index.html'), indexHtml, 'utf-8');

    // Copy attachments
    const copiedAttachments = await this.copyAttachments(attachments, null, attachmentsDir);

    // Write metadata
    const metadata = this.generateMetadataJson(notes, folders);
    await fs.writeFile(path.join(exportPath, 'metadata.json'), metadata, 'utf-8');

    return { success: true, path: exportPath };
  }
}

module.exports = {
  exportService: new ExportService(),
};
