/**
 * 轻量Markdown渲染器
 * 将Markdown文本转为React元素，支持：
 * - 标题(h1-h6)、段落、换行
 * - 粗体、斜体、行内代码
 * - 代码块（带语言标识）
 * - 无序/有序列表
 * - 引用块
 * - 链接
 * - 分隔线
 */

import React from 'react';

/** 行内样式解析状态 */
type InlineSpan = { type: 'text'; content: string } | { type: 'bold'; content: string } | { type: 'italic'; content: string } | { type: 'code'; content: string } | { type: 'link'; text: string; href: string };

/**
 * 解析行内Markdown格式
 */
function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // 粗体 **text** 或 __text__
    let match = remaining.match(/^(.*?)(\*\*|__)(.+?)\2(.*)/s);
    if (match && match[1].length < remaining.length) {
      if (match[1]) spans.push({ type: 'text', content: match[1] });
      spans.push({ type: 'bold', content: match[3] });
      remaining = match[4];
      continue;
    }

    // 斜体 *text* 或 _text_
    match = remaining.match(/^(.*?)(\*|_)(.+?)\2(.*)/s);
    if (match && match[1].length < remaining.length) {
      if (match[1]) spans.push({ type: 'text', content: match[1] });
      spans.push({ type: 'italic', content: match[3] });
      remaining = match[4];
      continue;
    }

    // 行内代码 `code`
    match = remaining.match(/^(.*?)`(.+?)`(.*)/s);
    if (match) {
      if (match[1]) spans.push({ type: 'text', content: match[1] });
      spans.push({ type: 'code', content: match[2] });
      remaining = match[3];
      continue;
    }

    // 链接 [text](href)
    match = remaining.match(/^(.*?)\[(.+?)\]\((.+?)\)(.*)/s);
    if (match) {
      if (match[1]) spans.push({ type: 'text', content: match[1] });
      spans.push({ type: 'link', text: match[2], href: match[3] });
      remaining = match[4];
      continue;
    }

    spans.push({ type: 'text', content: remaining });
    break;
  }

  return spans;
}

/**
 * 渲染行内元素
 */
function renderInline(spans: InlineSpan[]): React.ReactNode[] {
  return spans.map((span, i) => {
    switch (span.type) {
      case 'bold':
        return <strong key={i} className="font-semibold text-zinc-100">{span.content}</strong>;
      case 'italic':
        return <em key={i}>{span.content}</em>;
      case 'code':
        return <code key={i} className="px-1.5 py-0.5 rounded bg-zinc-700/60 text-amber-300 text-xs font-mono">{span.content}</code>;
      case 'link':
        return <a key={i} href={span.href} className="text-blue-400 hover:text-blue-300 underline" target="_blank" rel="noopener noreferrer">{span.text}</a>;
      default:
        return <React.Fragment key={i}>{span.content}</React.Fragment>;
    }
  });
}

/** Markdown块类型 */
type MdBlock =
  | { type: 'heading'; level: number; content: string }
  | { type: 'paragraph'; content: string }
  | { type: 'code_block'; language: string; content: string }
  | { type: 'unordered_list'; items: string[] }
  | { type: 'ordered_list'; items: string[] }
  | { type: 'blockquote'; content: string }
  | { type: 'hr' };

/**
 * 将Markdown文本解析为块级元素
 */
function parseBlocks(text: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行跳过
    if (line.trim() === '') { i++; continue; }

    // 标题
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, content: headingMatch[2] });
      i++; continue;
    }

    // 代码块
    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // 跳过结束的```
      blocks.push({ type: 'code_block', language, content: codeLines.join('\n') });
      continue;
    }

    // 分隔线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i++; continue;
    }

    // 引用块
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ type: 'blockquote', content: quoteLines.join('\n') });
      continue;
    }

    // 无序列表
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'unordered_list', items });
      continue;
    }

    // 有序列表
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ordered_list', items });
      continue;
    }

    // 段落（合并连续非空行）
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('#') && !lines[i].startsWith('```') && !lines[i].startsWith('> ') && !/^[-*]\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', content: paraLines.join('\n') });
    }
  }

  return blocks;
}

/** 标题样式映射 */
const headingStyles: Record<number, string> = {
  1: 'text-xl font-bold text-zinc-100 mt-4 mb-2',
  2: 'text-lg font-bold text-zinc-100 mt-3 mb-1.5',
  3: 'text-base font-semibold text-zinc-100 mt-2 mb-1',
  4: 'text-sm font-semibold text-zinc-200 mt-2 mb-1',
  5: 'text-sm font-medium text-zinc-200 mt-1.5 mb-0.5',
  6: 'text-xs font-medium text-zinc-300 mt-1.5 mb-0.5',
};

/**
 * 渲染Markdown块级元素
 */
function renderBlock(block: MdBlock, key: number): React.ReactNode {
  switch (block.type) {
    case 'heading':
      return React.createElement(`h${block.level}` as 'h1', {
        key,
        className: headingStyles[block.level],
      }, renderInline(parseInline(block.content)));

    case 'paragraph':
      return <p key={key} className="mb-2 leading-relaxed">{renderInline(parseInline(block.content))}</p>;

    case 'code_block':
      return (
        <div key={key} className="my-2 rounded-lg overflow-hidden border border-zinc-700/50">
          {block.language && (
            <div className="px-3 py-1 bg-zinc-800 text-zinc-500 text-xs border-b border-zinc-700/50 font-mono">
              {block.language}
            </div>
          )}
          <pre className="p-3 bg-zinc-900 overflow-x-auto text-xs leading-relaxed font-mono text-zinc-300">
            <code>{block.content}</code>
          </pre>
        </div>
      );

    case 'unordered_list':
      return (
        <ul key={key} className="mb-2 pl-4 space-y-0.5">
          {block.items.map((item, j) => (
            <li key={j} className="list-disc text-zinc-300">{renderInline(parseInline(item))}</li>
          ))}
        </ul>
      );

    case 'ordered_list':
      return (
        <ol key={key} className="mb-2 pl-4 space-y-0.5">
          {block.items.map((item, j) => (
            <li key={j} className="list-decimal text-zinc-300">{renderInline(parseInline(item))}</li>
          ))}
        </ol>
      );

    case 'blockquote':
      return (
        <blockquote key={key} className="my-2 pl-3 border-l-2 border-zinc-600 text-zinc-400 italic">
          {renderInline(parseInline(block.content))}
        </blockquote>
      );

    case 'hr':
      return <hr key={key} className="my-3 border-zinc-700/50" />;

    default:
      return null;
  }
}

/**
 * Markdown渲染组件属性
 */
interface MarkdownRendererProps {
  /** Markdown文本内容 */
  content: string;
  /** 额外CSS类名 */
  className?: string;
}

/**
 * 轻量Markdown渲染组件
 * 将Markdown文本渲染为格式化的React元素
 */
export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps): React.ReactElement {
  if (!content) return <></>;

  const blocks = parseBlocks(content);

  return (
    <div className={`markdown-body ${className}`}>
      {blocks.map((block, i) => renderBlock(block, i))}
    </div>
  );
}
