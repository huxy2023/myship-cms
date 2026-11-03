/**
 * src/scripts/markdown.js
 * 基于 marked@18 + highlight.js@11 + dompurify@3 的生产级 Markdown 渲染引擎
 * 由 Astro 7.4 (Vite / Rolldown) 自动 Tree-Shake 与分包打包
 */
import { Marked } from 'marked';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';

export function renderRichMarkdown(mdText) {
  if (!mdText) return '';

  let headingCounter = 0;
  const markedInstance = new Marked({
    gfm: true,
    breaks: true,
  });

  markedInstance.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        if (depth === 1 || depth === 2) {
          headingCounter++;
          return `<h2 id="toc-h-${headingCounter}" data-toc-level="2">${text}</h2>\n`;
        }
        if (depth === 3) {
          headingCounter++;
          return `<h3 id="toc-h-${headingCounter}" data-toc-level="3">${text}</h3>\n`;
        }
        return `<h${depth}>${text}</h${depth}>\n`;
      },
      code({ text, lang }) {
        const cleanLang = (lang || '').trim().toLowerCase();
        let highlighted = '';
        let resolvedLang = cleanLang || 'text';
        try {
          if (cleanLang && hljs.getLanguage(cleanLang)) {
            highlighted = hljs.highlight(text, { language: cleanLang, ignoreIllegals: true }).value;
          } else {
            const auto = hljs.highlightAuto(text);
            highlighted = auto.value;
            if (!cleanLang && auto.language) resolvedLang = auto.language;
          }
        } catch {
          highlighted = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        }

        return `
          <div class="code-block-wrap">
            <div class="code-block-header">
              <span class="code-lang-label">${resolvedLang}</span>
              <button type="button" class="code-copy-btn" onclick="window.copyCodeBlock(this)">复制代码</button>
            </div>
            <pre><code class="hljs language-${resolvedLang}">${highlighted}</code></pre>
          </div>
        `;
      },
      image({ href, title, text }) {
        const safeHref = String(href || '');
        const safeAlt = String(text || '');
        const titleAttr = title ? ` title="${String(title).replace(/"/g, '&quot;')}"` : '';
        return `<figure class="prose-figure"><img src="${safeHref}" alt="${safeAlt}"${titleAttr} loading="lazy" onclick="window.openCmsLightbox(this.src)" />${
          safeAlt ? `<figcaption>${safeAlt}</figcaption>` : ''
        }</figure>`;
      },
    },
  });

  const rawHtml = markedInstance.parse(String(mdText));

  return DOMPurify.sanitize(rawHtml, {
    ADD_ATTR: ['target', 'rel', 'onclick', 'data-toc-level', 'loading'],
    ADD_TAGS: ['figure', 'figcaption'],
  });
}

if (typeof window !== 'undefined') {
  window.renderSimpleMarkdown = renderRichMarkdown;
  window.renderRichMarkdown = renderRichMarkdown;
  window.dispatchEvent(new CustomEvent('cms-markdown-ready'));
}
