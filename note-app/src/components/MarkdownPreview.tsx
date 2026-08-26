import React, { useMemo } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';

interface MarkdownPreviewProps {
  content: string;
  onLinkClick?: (targetTitle: string) => void;
}

const INTERNAL_LINK_PATTERN = /\[\[([^\]|]+)(\|([^\]]*))?\]\]/g;
const INTERNAL_LINK_PREFIX = 'note://internal/';
// 附件图片自定义协议（如 vault-img://attachments/xxx.png）
const VAULT_IMG_PREFIX = 'vault-img://';

// Placeholder prefix using a UUID-like token to avoid collisions with real content
const PLACEHOLDER_PREFIX = '\x00WIKI_';

function encodeInternalLinks(content: string): string {
  const placeholders: string[] = [];

  // Step 1: Protect fenced code blocks (``` or ~~~ fences, including unclosed ones)
  // 结束条件：同行的闭合围栏，或真正的字符串末尾（$(?![\s\S]) 避免 m 模式下 $ 匹配行尾）
  let processed = content.replace(/^(`{3,}|~{3,}).*$([\s\S]*?)(?:^\1[ \t]*$|$(?![\s\S]))/gm, (match) => {
    placeholders.push(match);
    return `${PLACEHOLDER_PREFIX}${placeholders.length - 1}\x00`;
  });

  // Step 2: Protect inline code (`...` and ``...`` code spans)
  processed = processed.replace(/(`{1,2})(?!`)([\s\S]*?)\1(?!`)/g, (match) => {
    placeholders.push(match);
    return `${PLACEHOLDER_PREFIX}${placeholders.length - 1}\x00`;
  });

  // Step 3: Convert [[wikilinks]] outside protected regions
  processed = processed.replace(
    INTERNAL_LINK_PATTERN,
    (_match, targetTitle: string, _aliasGroup: string, displayText?: string) => {
      const target = targetTitle.trim();
      const label = displayText?.trim() || target;
      return `[${label}](${INTERNAL_LINK_PREFIX}${encodeURIComponent(target)})`;
    }
  );

  // Step 4: Restore placeholders in reverse order to avoid index corruption
  for (let i = placeholders.length - 1; i >= 0; i--) {
    processed = processed.replace(`${PLACEHOLDER_PREFIX}${i}\x00`, placeholders[i]);
  }

  return processed;
}

const LinkRenderer: React.FC<{
  href?: string;
  children: React.ReactNode;
  onLinkClick?: (targetTitle: string) => void;
}> = React.memo(({ href, children, onLinkClick }) => {
  if (href?.startsWith(INTERNAL_LINK_PREFIX)) {
    const targetTitle = decodeURIComponent(href.slice(INTERNAL_LINK_PREFIX.length));
    return (
      <a
        className="internal-link"
        href="#"
        title={`打开: ${targetTitle}`}
        onClick={(e) => {
          e.preventDefault();
          onLinkClick?.(targetTitle);
        }}
      >
        {children}
      </a>
    );
  }

  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
});

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = React.memo(({ content, onLinkClick }) => {
  const markdownContent = useMemo(() => encodeInternalLinks(content), [content]);

  const components = useMemo(() => ({
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
      <LinkRenderer href={href} onLinkClick={onLinkClick}>{children}</LinkRenderer>
    ),
  }), [onLinkClick]);

  // v10 默认会清空 note:// 等自定义协议的 href/src，需先放行内部双链与附件图片
  const urlTransform = useMemo(
    () => (url: string) =>
      url.startsWith(INTERNAL_LINK_PREFIX) || url.startsWith(VAULT_IMG_PREFIX)
        ? url
        : defaultUrlTransform(url),
    []
  );

  if (!content.trim()) {
    return (
      <div className="markdown-preview empty">
        <p className="preview-placeholder">预览区域</p>
      </div>
    );
  }

  return (
    <div className="markdown-preview">
      <ReactMarkdown components={components} urlTransform={urlTransform}>
        {markdownContent}
      </ReactMarkdown>
    </div>
  );
});
