const fs = require('node:fs/promises');
const path = require('node:path');
const { createWriteStream } = require('node:fs');
const { dialog } = require('electron');
const archiver = require('archiver');
const { vaultFileStore } = require('../storage/vaultFileStore.cjs');

class ExportService {
  sanitizeFileName(name) {
    let safeName = String(name || '')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 200)
      .replace(/\.+$/, '');

    // Windows reserved device names cannot be used as file names
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safeName)) {
      safeName = `_${safeName}`;
    }

    return safeName;
  }

  escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  _unescapeHtml(text) {
    return String(text)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&');
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
      // vault-img 协议在导出产物中会被改写为相对路径，这里先放行
      if (['http:', 'https:', 'mailto:', 'vault-img:'].includes(parsed.protocol)) {
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
    // src/href come from already-escaped HTML, so unescape once to avoid double-escaping inside sanitizeUrl
    html = html.replace(/!\[(.+?)\]\((.+?)\)/g, (_match, alt, src) => (
      `<img src="${this.sanitizeUrl(this._unescapeHtml(src), true)}" alt="${alt}" />`
    ));

    // Links
    html = html.replace(/\[(.+?)\]\((.+?)\)/g, (_match, text, href) => (
      `<a href="${this.sanitizeUrl(this._unescapeHtml(href), true)}">${text}</a>`
    ));

    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // Tables (line-based parsing to avoid catastrophic regex backtracking)
    html = this._renderTables(html);

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

  _renderTables(html) {
    const lines = html.split('\n');
    const result = [];
    const parseCells = (row) => row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const isPipeRow = (line) => line.startsWith('|') && line.endsWith('|');

    let i = 0;
    while (i < lines.length) {
      const headerRow = lines[i];
      const separatorRow = lines[i + 1];
      if (
        isPipeRow(headerRow) &&
        typeof separatorRow === 'string' &&
        /^\|[-: |]+\|$/.test(separatorRow)
      ) {
        const headers = parseCells(headerRow);
        const rows = [];
        i += 2;
        while (i < lines.length && isPipeRow(lines[i])) {
          rows.push(parseCells(lines[i]));
          i++;
        }

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
        result.push(table);
      } else {
        result.push(headerRow);
        i++;
      }
    }

    return result.join('\n');
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
    const imagePlan = await this._buildVaultImagePlan(notes);
    const output = createWriteStream(savePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
      const cleanupPartialZip = () => {
        fs.rm(savePath, { force: true }).catch(() => {});
      };

      output.on('close', () => {
        resolve({ success: true, path: savePath, size: archive.pointer() });
      });

      output.on('error', (err) => {
        archive.destroy();
        cleanupPartialZip();
        reject(err);
      });

      archive.on('error', (err) => {
        output.destroy();
        cleanupPartialZip();
        reject(err);
      });

      archive.pipe(output);

      const fileNameById = this.createNoteFileNameMap(notes, 'md');

      for (const note of notes) {
        const fileName = `notes/${fileNameById.get(note.id)}`;
        const content = this._rewriteVaultImageLinks(
          this.generateMarkdownContent(note),
          imagePlan
        );
        archive.append(content, { name: fileName });
      }

      for (const item of imagePlan) {
        archive.file(item.absPath, { name: `attachments/${item.fileName}` });
      }

      const metadata = this.generateMetadataJson(notes, folders);
      archive.append(metadata, { name: 'metadata.json' });

      const readme = this.generateReadme(notes.length, folders.length);
      archive.append(readme, { name: 'README.md' });

      archive.finalize().catch((error) => {
        output.destroy();
        cleanupPartialZip();
        reject(error);
      });
    });
  }

  async exportHtmlZip(notes, folders, savePath) {
    const imagePlan = await this._buildVaultImagePlan(notes);
    const output = createWriteStream(savePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
      const cleanupPartialZip = () => {
        fs.rm(savePath, { force: true }).catch(() => {});
      };

      output.on('close', () => {
        resolve({ success: true, path: savePath, size: archive.pointer() });
      });

      output.on('error', (err) => {
        archive.destroy();
        cleanupPartialZip();
        reject(err);
      });

      archive.on('error', (err) => {
        output.destroy();
        cleanupPartialZip();
        reject(err);
      });

      archive.pipe(output);

      const fileNameById = this.createNoteFileNameMap(notes, 'html');

      for (const note of notes) {
        const fileName = `notes/${fileNameById.get(note.id)}`;
        const html = this._rewriteVaultImageLinks(
          this.generateNoteHtml(note, notes, fileNameById),
          imagePlan
        );
        archive.append(html, { name: fileName });
      }

      for (const item of imagePlan) {
        archive.file(item.absPath, { name: `attachments/${item.fileName}` });
      }

      const indexHtml = this.generateIndexHtml(notes, fileNameById);
      archive.append(indexHtml, { name: 'index.html' });

      const metadata = this.generateMetadataJson(notes, folders);
      archive.append(metadata, { name: 'metadata.json' });

      archive.finalize().catch((error) => {
        output.destroy();
        cleanupPartialZip();
        reject(error);
      });
    });
  }

  async _mapWithConcurrency(items, limit, worker) {
    const queue = [...items];
    const runners = Array.from(
      { length: Math.min(limit, queue.length) },
      async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          await worker(item);
        }
      }
    );
    await Promise.all(runners);
  }

  // ── vault-img 附件导出 ────────────────────────────────────────────

  // 收集笔记内容中 ![..](vault-img://attachments/...) 形式的图片引用，
  // 返回去重前的 vault 相对路径数组。
  _collectVaultImageRefs(content) {
    const refs = [];
    if (typeof content !== 'string' || content.length === 0) return refs;
    const pattern = /!\[[^\]]*\]\(\s*vault-img:\/\/([^\s)]+)\s*\)/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      let ref = match[1];
      try {
        ref = decodeURIComponent(ref);
      } catch {
        // 保留原始引用
      }
      refs.push(ref);
    }
    return refs;
  }

  // 汇总所有笔记引用的 vault 图片，校验存在性与路径安全，并分配
  // 导出产物 attachments/ 下的唯一文件名。
  // 返回 [{ ref, absPath, fileName }]；缺失或越界的引用跳过（链接保持原样）。
  async _buildVaultImagePlan(notes) {
    const refs = new Set();
    for (const note of notes) {
      for (const ref of this._collectVaultImageRefs(note && note.content)) {
        refs.add(ref);
      }
    }
    const plan = [];
    if (refs.size === 0) return plan;

    const vaultRoot = path.resolve(vaultFileStore.getStoragePath());
    const usedNames = new Set();
    for (const ref of refs) {
      const absPath = path.resolve(vaultRoot, ref);
      if (!absPath.startsWith(vaultRoot + path.sep)) {
        console.warn('Skipping vault-img reference outside the vault:', ref);
        continue;
      }
      try {
        await fs.access(absPath);
      } catch {
        console.warn('vault-img attachment not found, skipping export copy:', ref);
        continue;
      }

      const baseName = this.sanitizeFileName(path.basename(absPath)) || 'image';
      const dotIndex = baseName.lastIndexOf('.');
      const stem = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
      const ext = dotIndex > 0 ? baseName.slice(dotIndex) : '';
      let fileName = baseName;
      let counter = 2;
      while (usedNames.has(fileName.toLowerCase())) {
        fileName = `${stem}-${counter}${ext}`;
        counter++;
      }
      usedNames.add(fileName.toLowerCase());
      plan.push({ ref, absPath, fileName });
    }
    return plan;
  }

  // 把内容中的 vault-img://<ref> 链接改写为导出产物内的相对路径
  // attachments/<fileName>；未纳入导出计划的引用保持原样。
  _rewriteVaultImageLinks(text, imagePlan) {
    if (typeof text !== 'string' || imagePlan.length === 0) return text;
    const linkByRef = new Map(imagePlan.map((item) => [item.ref, `attachments/${item.fileName}`]));
    return text.replace(/vault-img:\/\/([^\s)"']+)/g, (whole, rawRef) => {
      let ref = rawRef;
      try {
        ref = decodeURIComponent(rawRef);
      } catch {
        // 保留原始引用
      }
      return linkByRef.get(ref) || linkByRef.get(rawRef) || whole;
    });
  }

  async _copyVaultImagePlan(imagePlan, destAttachmentsDir) {
    if (imagePlan.length === 0) return;
    await fs.mkdir(destAttachmentsDir, { recursive: true });
    await this._mapWithConcurrency(imagePlan, 10, async (item) => {
      try {
        await fs.copyFile(item.absPath, path.join(destAttachmentsDir, item.fileName));
      } catch (error) {
        console.warn('Failed to copy attachment for export:', item.ref, error);
      }
    });
  }

  async exportMarkdownDirectory(notes, folders, exportPath) {
    const notesDir = path.join(exportPath, 'notes');

    await fs.mkdir(notesDir, { recursive: true });

    const fileNameById = this.createNoteFileNameMap(notes, 'md');
    const imagePlan = await this._buildVaultImagePlan(notes);
    await this._copyVaultImagePlan(imagePlan, path.join(exportPath, 'attachments'));

    await this._mapWithConcurrency(notes, 10, async (note) => {
      const fileName = fileNameById.get(note.id);
      const filePath = path.join(notesDir, fileName);
      const content = this._rewriteVaultImageLinks(
        this.generateMarkdownContent(note),
        imagePlan
      );
      await fs.writeFile(filePath, content, 'utf-8');
    });

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
    const imagePlan = await this._buildVaultImagePlan(notes);
    await this._copyVaultImagePlan(imagePlan, path.join(exportPath, 'attachments'));

    await this._mapWithConcurrency(notes, 10, async (note) => {
      const fileName = fileNameById.get(note.id);
      const filePath = path.join(notesDir, fileName);
      const html = this._rewriteVaultImageLinks(
        this.generateNoteHtml(note, notes, fileNameById),
        imagePlan
      );
      await fs.writeFile(filePath, html, 'utf-8');
    });

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
