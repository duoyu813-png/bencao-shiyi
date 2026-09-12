#!/usr/bin/env node
/**
 * build-daily.js — 把 daily/*.md 汇总成网站可读的 daily/daily-data.js
 *
 * 用法：node tools/build-daily.js
 * 输出：daily/daily-data.js（window.DAILY，按日期倒序，含渲染好的正文 HTML）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DAILY = path.join(ROOT, 'daily');
const OUT = path.join(DAILY, 'daily-data.js');

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function mdToHtml(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>');
      continue;
    }
    let m;
    if ((m = line.match(/^###\s+(.*)$/))) { out.push('<h4>' + inline(m[1]) + '</h4>'); i++; continue; }
    if ((m = line.match(/^##\s+(.*)$/))) { out.push('<h3>' + inline(m[1]) + '</h3>'); i++; continue; }
    if ((m = line.match(/^#\s+(.*)$/))) { out.push('<h2>' + inline(m[1]) + '</h2>'); i++; continue; }
    if (/^→/.test(line)) { out.push('<p class="step">' + inline(line) + '</p>'); i++; continue; }
    out.push('<p>' + inline(line) + '</p>');
    i++;
  }
  return out.join('\n');
}

function parse(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  m[1].split(/\r?\n/).forEach(l => {
    const k = l.match(/^([^:：]+)[:：]\s*(.*)$/);
    if (k) meta[k[1].trim()] = k[2].trim();
  });
  let body = m[2].replace(/^#\s+.*\r?\n/, '');
  return { date: meta['日期'] || path.basename(file, '.md'), meta, body };
}

function excerpt(body) {
  const plain = body
    .replace(/^#+\s.*$/gm, '')
    .replace(/[*>→]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 78 ? plain.slice(0, 78) + '…' : plain;
}

function main() {
  const files = fs.readdirSync(DAILY).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse();
  const list = [];
  files.forEach(f => {
    const p = parse(path.join(DAILY, f));
    if (!p) return;
    const meta = p.meta;
    list.push({
      date: p.date,
      title: meta['标题'] || f.replace(/\.md$/, ''),
      jieqi: meta['节气'] || '',
      type: meta['选题类型'] || '',
      herb: meta['主角药材'] || '',
      excerpt: excerpt(p.body),
      html: mdToHtml(p.body)
    });
  });

  const js = JSON.stringify(list, null, 2).replace(/<\//g, '<\\/');
  const payload = '/* 本草日课 · 由 tools/build-daily.js 自动生成，请勿手改 */\n' +
    'window.DAILY = ' + js + ';\n';
  fs.writeFileSync(OUT, payload, 'utf8');
  console.log('已生成 ' + path.relative(ROOT, OUT) + '，共 ' + list.length + ' 篇');
}

main();
