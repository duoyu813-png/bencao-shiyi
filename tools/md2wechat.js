#!/usr/bin/env node
/**
 * md2wechat.js — 把 daily/YYYY-MM-DD.md 转成符合微信公众号规范的排版 HTML
 *
 * 用法：
 *   node tools/md2wechat.js            # 转换今天（或最新一篇）的文章
 *   node tools/md2wechat.js 2026-09-06 # 转换指定日期
 *
 * 输出：daily/YYYY-MM-DD-wechat.html —— 浏览器打开后 Ctrl+A 全选复制，
 *       直接粘贴进微信公众号后台编辑器，就是排好版的草稿。
 *
 * 微信规范约束（已遵守）：
 *   1. 全部样式内联在 style 属性，无 class / id / <style> / <script>
 *   2. 无外链 CSS、JS；图片若日后添加，必须先用微信接口上传换自家 URL
 *   3. 正文 < 20000 字符
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DAILY = path.join(ROOT, 'daily');

// ---------- 主题配色（与本草拾遗站点一致） ----------
const C = {
  title: '#7a5a3a',
  accent: '#a9743b',
  text: '#3f3f3f',
  muted: '#8c8c8c',
  recipeBg: '#faf6ef',
  recipeBd: '#e3d3b8',
  quoteBg: '#f6f1e7',
  quoteBd: '#c9a36a',
  rule: '#ece5d8'
};

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- 解析 frontmatter ----------
function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  m[1].split(/\r?\n/).forEach(line => {
    const kv = line.match(/^([^:]+):\s*(.*)$/);
    if (kv) meta[kv[1].trim()] = kv[2].trim();
  });
  return { meta, body: m[2] };
}

// ---------- 行内 markdown ----------
function inline(s) {
  return esc(s)
    // 加粗
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:' + C.accent + ';font-weight:600;">$1</strong>')
    // 斜体
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em style="color:' + C.muted + ';font-style:normal;font-size:14px;">$2</em>')
    // 书名号包的内容加色
    .replace(/《([^》]+)》/g, '<span style="color:' + C.title + ';">《$1》</span>');
}

// ---------- 主体转换 ----------
function convert(body, meta) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let para = [];

  const flush = () => {
    if (!para.length) return;
    out.push('<p style="margin:0 0 18px;font-size:16px;line-height:1.85;color:' +
      C.text + ';letter-spacing:0.3px;text-align:justify;">' +
      inline(para.join('')) + '</p>');
    para = [];
  };

  for (let raw of lines) {
    const line = raw.trim();

    if (!line) { flush(); continue; }

    // 一级标题（文章标题）
    if (/^#\s+/.test(line)) {
      flush();
      out.push('<h1 style="margin:0 0 20px;font-size:21px;line-height:1.5;font-weight:bold;color:' +
        C.title + ';letter-spacing:0.5px;text-align:center;">' +
        inline(line.replace(/^#\s+/, '')) + '</h1>');
      continue;
    }

    // 二级小标题
    if (/^##\s+/.test(line)) {
      flush();
      out.push('<section style="margin:30px 0 14px;padding-left:12px;border-left:4px solid ' +
        C.accent + ';font-size:17px;font-weight:bold;line-height:1.5;color:' + C.title + ';">' +
        inline(line.replace(/^##\s+/, '')) + '</section>');
      continue;
    }

    // 三级小标题
    if (/^###\s+/.test(line)) {
      flush();
      out.push('<section style="margin:22px 0 10px;font-size:16px;font-weight:bold;color:' +
        C.accent + ';">' + inline(line.replace(/^###\s+/, '')) + '</section>');
      continue;
    }

    // 「→」开头的食疗方：突出成卡片
    if (/^→\s*/.test(line)) {
      flush();
      out.push('<section style="margin:0 0 18px;padding:13px 15px;background:' + C.recipeBg +
        ';border:1px solid ' + C.recipeBd + ';border-radius:6px;font-size:15px;line-height:1.8;color:' +
        C.text + ';">' + inline(line.replace(/^→\s*/, '')) + '</section>');
      continue;
    }

    // 引用行（免责声明 / 古籍原文）
    if (/^>\s?/.test(line)) {
      flush();
      out.push('<section style="margin:22px 0;padding:13px 16px;background:' + C.quoteBg +
        ';border-left:4px solid ' + C.quoteBd + ';border-radius:0 4px 4px 0;font-size:14px;line-height:1.75;color:#6b6b6b;">' +
        inline(line.replace(/^>\s?/, '')) + '</section>');
      continue;
    }

    // 分隔线
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      flush();
      out.push('<section style="margin:26px 0;height:1px;background:' + C.rule + ';"></section>');
      continue;
    }

    // 列表
    if (/^[-*]\s+/.test(line)) {
      flush();
      out.push('<p style="margin:0 0 10px;padding-left:14px;font-size:15px;line-height:1.8;color:' +
        C.text + ';">· ' + inline(line.replace(/^[-*]\s+/, '')) + '</p>');
      continue;
    }

    // 普通正文行
    para.push(line);
  }
  flush();

  return out.join('\n');
}

// ---------- 组装完整预览页 ----------
function buildPage(meta, contentHtml) {
  const title = meta['标题'] || '本草日课';
  const date = meta['日期'] || '';
  const jieqi = meta['节气'] || '';
  const topic = meta['选题类型'] || '';
  const herb = meta['主角药材'] || '';

  const chips = [date, jieqi, topic, herb ? '主角：' + herb : ''].filter(Boolean);

  // 头部信息条：本草日课 · 日期 · 节气 · 选题类型 · 主角药材
  const headBar = chips.length
    ? '<section style="margin:0 0 22px;padding-bottom:14px;border-bottom:1px solid ' +
      C.rule + ';text-align:center;font-size:13px;line-height:1.7;color:' + C.muted +
      ';letter-spacing:0.5px;">本草日课 · ' + esc(chips.join(' · ')) + '</section>\n'
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · 公众号排版稿</title>
<style>
  body{margin:0;padding:32px 16px 64px;background:#e9e5de;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;}
  .tip{max-width:520px;margin:0 auto 20px;padding:14px 16px;background:#fff8e6;border:1px solid #e5d5a8;border-radius:8px;font-size:13px;line-height:1.7;color:#7a6a48;}
  .tip b{color:#a9743b;}
  .phone{max-width:520px;margin:0 auto;background:#fff;border-radius:10px;padding:30px 22px;box-shadow:0 2px 14px rgba(0,0,0,.07);}
  .btn{max-width:520px;margin:20px auto 0;text-align:center;}
  .btn button{background:#a9743b;color:#fff;border:0;border-radius:6px;padding:11px 26px;font-size:15px;cursor:pointer;}
  .btn button:hover{background:#8d5e2c;}
  .done{display:none;max-width:520px;margin:12px auto 0;text-align:center;color:#3a7a3a;font-size:14px;}
</style>
</head>
<body>

<div class="tip">
  <b>怎么用：</b>点下方「一键复制排版」按钮 → 打开微信公众号后台 → 新建图文 → 在正文区 <b>Ctrl+V</b> 粘贴。<br>
  粘贴后格式（标题色块、方子卡片、引用条）会完整保留，检查无误后存为草稿即可。<br>
  <b>注意：</b>文章里的图片需先在微信后台单独上传，外部图片链接会被过滤。
</div>

<div class="phone" id="article">
${headBar}${contentHtml}
</div>

<div class="btn"><button onclick="copyArticle()">一键复制排版</button></div>
<div class="done" id="done">已复制到剪贴板，去公众号后台粘贴吧</div>

<script>
function copyArticle(){
  var el = document.getElementById('article');
  var sel = window.getSelection(), range = document.createRange();
  range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range);
  try {
    document.execCommand('copy');
    var d = document.getElementById('done');
    d.style.display = 'block';
    setTimeout(function(){ d.style.display='none'; }, 2500);
  } catch(e) { alert('复制失败，请手动全选正文区域复制'); }
  sel.removeAllRanges();
}
</script>
</body>
</html>`;
}

// ---------- 主流程 ----------
function pickDate() {
  const arg = process.argv[2];
  if (arg) return arg;
  const files = fs.readdirSync(DAILY).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
  if (!files.length) { console.error('daily/ 下没有文章'); process.exit(1); }
  return files[files.length - 1].replace(/\.md$/, '');
}

const date = pickDate();
const srcPath = path.join(DAILY, date + '.md');
if (!fs.existsSync(srcPath)) { console.error('找不到 ' + srcPath); process.exit(1); }

const raw = fs.readFileSync(srcPath, 'utf8');
const { meta, body } = parseFrontmatter(raw);
const contentHtml = convert(body, meta);
const page = buildPage(meta, contentHtml);

const outPath = path.join(DAILY, date + '-wechat.html');
fs.writeFileSync(outPath, page, 'utf8');

// 字数统计（微信限制 20000 字符）
const plainLen = contentHtml.replace(/<[^>]+>/g, '').length;
console.log('已生成：' + outPath);
console.log('标题  ：' + (meta['标题'] || ''));
console.log('正文字数（不含标签）：' + plainLen + ' 字符' + (plainLen > 20000 ? '  ⚠ 超出微信 20000 限制' : '  ✓ 未超限'));
