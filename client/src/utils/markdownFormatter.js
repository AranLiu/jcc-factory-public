/**
 * 统一的Markdown格式化工具
 * 解决知识库文档编辑后格式丢失的问题
 */
import { sanitizeMarkdownUrl } from './htmlSecurity';

// 转义HTML特殊字符
const escapeHtml = (text) => {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

/**
 * 将Markdown内容转换为HTML
 * @param {string} content - Markdown格式的文本内容
 * @param {object} options - 格式化选项
 * @returns {string} HTML格式的内容
 */
export const formatContentAsHtml = (content, options = {}) => {
  if (!content) {
    return options.emptyMessage || '<p style="color: #999; font-style: italic;">暂无内容</p>';
  }

  const {
    enableStyling = true,
    baseLineHeight = '1.6',
    baseFontSize = '14px',
    headingColor = '#262626',
    textColor = '#595959',
    linkColor = '#1890ff'
  } = options;

  // 处理列表状态
  let inUnorderedList = false;
  let inOrderedList = false;
  
  const lines = content.split('\n');
  const htmlLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
    const nextTrimmed = nextLine.trim();

    // 检查是否需要关闭列表
    const isCurrentLineListItem = trimmedLine.startsWith('- ') || 
                                 trimmedLine.startsWith('* ') || 
                                 /^\d+\.\s/.test(trimmedLine);
    const isNextLineListItem = nextTrimmed.startsWith('- ') || 
                              nextTrimmed.startsWith('* ') || 
                              /^\d+\.\s/.test(nextTrimmed);

    // 处理标题
    if (trimmedLine.startsWith('# ')) {
      if (inUnorderedList) {
        htmlLines.push('</ul>');
        inUnorderedList = false;
      }
      if (inOrderedList) {
        htmlLines.push('</ol>');
        inOrderedList = false;
      }
      const text = escapeHtml(trimmedLine.substring(2));
      const style = enableStyling ? 
        `style="color: ${headingColor}; margin: 20px 0 16px 0; font-size: 24px; font-weight: 600; border-bottom: 2px solid #e8e8e8; padding-bottom: 8px;"` : '';
      htmlLines.push(`<h1 ${style}>${text}</h1>`);
      
    } else if (trimmedLine.startsWith('## ')) {
      if (inUnorderedList) {
        htmlLines.push('</ul>');
        inUnorderedList = false;
      }
      if (inOrderedList) {
        htmlLines.push('</ol>');
        inOrderedList = false;
      }
      const text = escapeHtml(trimmedLine.substring(3));
      const style = enableStyling ? 
        `style="color: ${headingColor}; margin: 18px 0 14px 0; font-size: 20px; font-weight: 600;"` : '';
      htmlLines.push(`<h2 ${style}>${text}</h2>`);
      
    } else if (trimmedLine.startsWith('### ')) {
      if (inUnorderedList) {
        htmlLines.push('</ul>');
        inUnorderedList = false;
      }
      if (inOrderedList) {
        htmlLines.push('</ol>');
        inOrderedList = false;
      }
      const text = escapeHtml(trimmedLine.substring(4));
      const style = enableStyling ? 
        `style="color: ${headingColor}; margin: 16px 0 12px 0; font-size: 18px; font-weight: 600;"` : '';
      htmlLines.push(`<h3 ${style}>${text}</h3>`);
      
    } else if (trimmedLine.startsWith('#### ')) {
      if (inUnorderedList) {
        htmlLines.push('</ul>');
        inUnorderedList = false;
      }
      if (inOrderedList) {
        htmlLines.push('</ol>');
        inOrderedList = false;
      }
      const text = escapeHtml(trimmedLine.substring(5));
      const style = enableStyling ? 
        `style="color: ${headingColor}; margin: 14px 0 10px 0; font-size: 16px; font-weight: 600;"` : '';
      htmlLines.push(`<h4 ${style}>${text}</h4>`);
      
    } 
    // 处理无序列表
    else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
      if (inOrderedList) {
        htmlLines.push('</ol>');
        inOrderedList = false;
      }
      if (!inUnorderedList) {
        const listStyle = enableStyling ? 
          `style="margin: 12px 0; padding-left: 20px; list-style-type: disc;"` : '';
        htmlLines.push(`<ul ${listStyle}>`);
        inUnorderedList = true;
      }
      const text = escapeHtml(trimmedLine.substring(2));
      const itemStyle = enableStyling ? 
        `style="margin: 4px 0; color: ${textColor}; line-height: ${baseLineHeight};"` : '';
      htmlLines.push(`<li ${itemStyle}>${text}</li>`);
      
      // 检查是否需要关闭列表
      if (!isNextLineListItem && nextTrimmed !== '') {
        htmlLines.push('</ul>');
        inUnorderedList = false;
      }
      
    } 
    // 处理有序列表
    else if (/^\d+\.\s/.test(trimmedLine)) {
      if (inUnorderedList) {
        htmlLines.push('</ul>');
        inUnorderedList = false;
      }
      if (!inOrderedList) {
        const listStyle = enableStyling ? 
          `style="margin: 12px 0; padding-left: 20px;"` : '';
        htmlLines.push(`<ol ${listStyle}>`);
        inOrderedList = true;
      }
      const match = trimmedLine.match(/^\d+\.\s(.*)$/);
      const text = escapeHtml(match[1]);
      const itemStyle = enableStyling ? 
        `style="margin: 4px 0; color: ${textColor}; line-height: ${baseLineHeight};"` : '';
      htmlLines.push(`<li ${itemStyle}>${text}</li>`);
      
      // 检查是否需要关闭列表
      if (!isNextLineListItem && nextTrimmed !== '') {
        htmlLines.push('</ol>');
        inOrderedList = false;
      }
      
    } 
    // 处理空行
    else if (trimmedLine === '') {
      // 如果在列表中且下一行不是列表项，关闭列表
      if (inUnorderedList && !isNextLineListItem) {
        htmlLines.push('</ul>');
        inUnorderedList = false;
      }
      if (inOrderedList && !isNextLineListItem) {
        htmlLines.push('</ol>');
        inOrderedList = false;
      }
      
      // 只有当下一行不是空行时才添加换行
      if (nextTrimmed !== '') {
        htmlLines.push('<br/>');
      }
      
    } 
    // 处理警告信息
    else if (trimmedLine.startsWith('⚠️') || trimmedLine.startsWith('警告') || trimmedLine.startsWith('WARNING')) {
      if (inUnorderedList) {
        htmlLines.push('</ul>');
        inUnorderedList = false;
      }
      if (inOrderedList) {
        htmlLines.push('</ol>');
        inOrderedList = false;
      }
      const style = enableStyling ? 
        `style="background: #fff7e6; border: 1px solid #ffd666; border-radius: 6px; padding: 12px; margin: 8px 0; color: #d46b08;"` : '';
      htmlLines.push(`<div ${style}><strong>⚠️ </strong>${escapeHtml(trimmedLine)}</div>`);
      
    }
    // 处理成功信息
    else if (trimmedLine.startsWith('✅') || trimmedLine.startsWith('成功') || trimmedLine.startsWith('SUCCESS')) {
      if (inUnorderedList) {
        htmlLines.push('</ul>');
        inUnorderedList = false;
      }
      if (inOrderedList) {
        htmlLines.push('</ol>');
        inOrderedList = false;
      }
      const style = enableStyling ? 
        `style="background: #f6ffed; border: 1px solid #b7eb8f; border-radius: 6px; padding: 12px; margin: 8px 0; color: #389e0d;"` : '';
      htmlLines.push(`<div ${style}><strong>✅ </strong>${escapeHtml(trimmedLine)}</div>`);
      
    }
    // 处理错误信息
    else if (trimmedLine.startsWith('❌') || trimmedLine.startsWith('错误') || trimmedLine.startsWith('ERROR')) {
      if (inUnorderedList) {
        htmlLines.push('</ul>');
        inUnorderedList = false;
      }
      if (inOrderedList) {
        htmlLines.push('</ol>');
        inOrderedList = false;
      }
      const style = enableStyling ? 
        `style="background: #fff2f0; border: 1px solid #ffccc7; border-radius: 6px; padding: 12px; margin: 8px 0; color: #cf1322;"` : '';
      htmlLines.push(`<div ${style}><strong>❌ </strong>${escapeHtml(trimmedLine)}</div>`);
      
    }
    // 处理普通段落
    else {
      if (inUnorderedList) {
        htmlLines.push('</ul>');
        inUnorderedList = false;
      }
      if (inOrderedList) {
        htmlLines.push('</ol>');
        inOrderedList = false;
      }
      
      // 处理内联格式
      let processedLine = escapeHtml(line);
      
      // 粗体文本 **text** 或 __text__
      processedLine = processedLine.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      processedLine = processedLine.replace(/__(.*?)__/g, '<strong>$1</strong>');
      
      // 斜体文本 *text* 或 _text_
      processedLine = processedLine.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
      processedLine = processedLine.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');
      
      // 代码 `code`
      processedLine = processedLine.replace(/`([^`]+)`/g, 
        `<code style="background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: 'Monaco', 'Courier New', monospace; font-size: 0.9em;">$1</code>`);
      
      // 链接 [text](url)
      processedLine = processedLine.replace(/\[([^\]]+)\]\(([^)]+)\)/g, 
        (_match, text, url) => `<a href="${escapeHtml(sanitizeMarkdownUrl(url))}" style="color: ${linkColor}; text-decoration: none;" target="_blank" rel="noopener noreferrer">${text}</a>`);
      
      const style = enableStyling ? 
        `style="margin: 8px 0; color: ${textColor}; line-height: ${baseLineHeight}; font-size: ${baseFontSize};"` : '';
      htmlLines.push(`<p ${style}>${processedLine}</p>`);
    }
  }

  // 确保最后关闭所有列表
  if (inUnorderedList) {
    htmlLines.push('</ul>');
  }
  if (inOrderedList) {
    htmlLines.push('</ol>');
  }

  return htmlLines.join('');
};

/**
 * 简化版本的格式化函数，用于编辑器预览
 */
export const formatContentAsHtmlSimple = (content) => {
  return formatContentAsHtml(content, {
    enableStyling: true,
    baseLineHeight: '1.5',
    baseFontSize: '14px'
  });
};

/**
 * 增强版本的格式化函数，用于知识库预览
 */
export const formatContentAsHtmlEnhanced = (content) => {
  return formatContentAsHtml(content, {
    enableStyling: true,
    baseLineHeight: '1.6',
    baseFontSize: '15px',
    headingColor: '#262626',
    textColor: '#595959',
    linkColor: '#1890ff'
  });
};
