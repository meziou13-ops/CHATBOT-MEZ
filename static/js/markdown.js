/* Rendu Markdown minimal et sûr : tout est échappé avant d'ajouter la moindre balise. */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => ESCAPES[c]);

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*\x60{3}([\w+#.-]{0,20})/;
const FENCE_END = /^\s*\x60{3}\s*$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export function renderMarkdown(source) {
  const lines = source.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').split('\n');
  return blocks(lines);
}

function isBlockStart(line) {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || /^\s*>/.test(line);
}

function isTableStart(lines, i) {
  const next = lines[i + 1];
  return next !== undefined && lines[i].includes('|') && next.includes('|') && TABLE_RULE.test(next);
}

function blocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const code = [];
      i += 1;
      while (i < lines.length && !FENCE_END.test(lines[i])) { code.push(lines[i]); i += 1; }
      i += 1;
      out.push(codeBlock(fence[1], code.join('\n')));
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length + 2, 6);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (RULE.test(line)) { out.push('<hr>'); i += 1; continue; }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, '')); i += 1; }
      out.push(`<blockquote>${blocks(quote)}</blockquote>`);
      continue;
    }

    if (isTableStart(lines, i)) {
      const [html, next] = table(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const [html, next] = list(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i]) && !LIST_ITEM.test(lines[i]) && !isTableStart(lines, i)) {
      para.push(lines[i].trim());
      i += 1;
    }
    out.push(`<p>${inline(para.join('\n'))}</p>`);
  }
  return out.join('');
}

function list(lines, start) {
  const first = LIST_ITEM.exec(lines[start]);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && parseInt(first[2], 10) !== 1 ? ` start="${parseInt(first[2], 10)}"` : '';
  const items = [];
  let i = start;

  while (i < lines.length) {
    const m = LIST_ITEM.exec(lines[i]);
    if (!m || m[1].length < indent || m[1].length >= indent + 2 || /\d/.test(m[2]) !== ordered) break;
    const parts = [m[3]];
    let nested = '';
    i += 1;

    while (i < lines.length) {
      const current = lines[i];
      if (!current.trim()) {
        let j = i;
        while (j < lines.length && !lines[j].trim()) j += 1;
        const upcoming = j < lines.length ? LIST_ITEM.exec(lines[j]) : null;
        if (upcoming && upcoming[1].length >= indent) { i = j; continue; }
        break;
      }
      const item = LIST_ITEM.exec(current);
      if (item) {
        if (item[1].length < indent + 2) break;
        const [html, next] = list(lines, i);
        nested += html;
        i = next;
        continue;
      }
      if (isBlockStart(current) || isTableStart(lines, i)) break;
      parts.push(current.trim());
      i += 1;
    }
    items.push(`<li>${inline(parts.join('\n'))}${nested}</li>`);
  }
  return [`<${tag}${startAttr}>${items.join('')}</${tag}>`, i];
}

function splitRow(line) {
  const cells = [];
  let current = '';
  const text = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let k = 0; k < text.length; k += 1) {
    if (text[k] === '\\' && text[k + 1] === '|') { current += '|'; k += 1; }
    else if (text[k] === '|') { cells.push(current.trim()); current = ''; }
    else current += text[k];
  }
  cells.push(current.trim());
  return cells;
}

function table(lines, start) {
  const head = splitRow(lines[start]);
  const aligns = splitRow(lines[start + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
  const cell = (tag, text, k) => `<${tag}${aligns[k] ? ` class="a-${aligns[k]}"` : ''}>${inline(text)}</${tag}>`;
  let html = `<div class="table-wrap"><table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>`;
  let i = start + 2;
  while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
    const row = splitRow(lines[i]);
    html += `<tr>${head.map((_, k) => cell('td', row[k] ?? '', k)).join('')}</tr>`;
    i += 1;
  }
  return [`${html}</tbody></table></div>`, i];
}

function codeBlock(lang, code) {
  const label = escapeHtml(lang || 'code');
  return `<div class="code"><div class="code-head"><span>${label}</span><button type="button" class="code-copy">Copier</button></div><pre><code>${escapeHtml(code)}</code></pre></div>`;
}

function link(url, text) {
  return `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${text}</a>`;
}

function emphasis(text) {
  return text
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([^~\n]*?\S)~~/g, '<del>$1</del>');
}

function inline(raw) {
  const stash = [];
  const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`;
  let text = escapeHtml(raw);
  text = text.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${code}</code>`));
  text = text.replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_, label, url) => keep(link(url, emphasis(label))));
  text = text.replace(/(^|[\s(])(https?:\/\/[^\s<]*[^\s<.,;:!?)])/g, (_, before, url) => before + keep(link(url, url)));
  text = emphasis(text).replace(/\n/g, '<br>');
  for (let round = 0; round < 3; round += 1) {
    text = text.replace(/\u0000(\d+)\u0000/g, (_, k) => stash[Number(k)]);
  }
  return text;
}
