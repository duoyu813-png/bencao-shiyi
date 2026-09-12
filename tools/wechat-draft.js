#!/usr/bin/env node
/**
 * wechat-draft.js — 可选：通过微信官方 API 把文章直接推到公众号草稿箱
 *
 * ⚠️ 使用前提（缺一不可）：
 *   1. 公众号具备 draft/add 接口权限（个人订阅号实测可能返回 48001）
 *   2. 在公众号后台 → 设置与开发 → 基本配置 拿到 AppID / AppSecret
 *   3. 把本机公网出口 IP 加进 IP 白名单（家宽 IP 会变，变了要重加，否则 40165）
 *   4. 准备一张封面图（JPG/PNG，建议 900×500，≤5MB）—— thumb_media_id 是必填项
 *
 * 命令：
 *   node tools/wechat-draft.js init   生成配置模板 tools/.wechat-config.json
 *   node tools/wechat-draft.js test   只测连通性（拿 token + 查权限），不建草稿
 *   node tools/wechat-draft.js        推送最新一篇文章
 *   node tools/wechat-draft.js 2026-09-06   推送指定日期
 *
 * 配置文件不会上传、不进版本库，密钥只存在你本机。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DAILY = path.join(ROOT, 'daily');
const CONF = path.join(__dirname, '.wechat-config.json');

const API = 'https://api.weixin.qq.com';

// ---------- 配置 ----------
function loadConf() {
  if (!fs.existsSync(CONF)) {
    console.error('未找到配置文件。请先运行：node tools/wechat-draft.js init');
    process.exit(1);
  }
  const c = JSON.parse(fs.readFileSync(CONF, 'utf8'));
  if (!c.appid || !c.appsecret) {
    console.error('配置里 appid / appsecret 还没填：' + CONF);
    process.exit(1);
  }
  return c;
}

function initConf() {
  if (fs.existsSync(CONF)) { console.log('配置已存在：' + CONF); return; }
  fs.writeFileSync(CONF, JSON.stringify({
    appid: '',
    appsecret: '',
    cover: 'tools/cover.jpg',
    author: '本草拾遗',
    sourceUrl: ''
  }, null, 2), 'utf8');
  console.log('已生成配置模板：' + CONF);
  console.log('请填入 appid / appsecret，并准备封面图放到 tools/cover.jpg');
}

// ---------- HTTP ----------
function req(url, bodyBuf, contentType) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search, method: bodyBuf ? 'POST' : 'GET',
      headers: {}
    };
    if (bodyBuf) {
      opts.headers['Content-Type'] = contentType || 'application/json';
      opts.headers['Content-Length'] = bodyBuf.length;
    }
    const r = https.request(opts, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    });
    r.on('error', reject);
    if (bodyBuf) r.write(bodyBuf);
    r.end();
  });
}

// ---------- 错误码说明 ----------
function explain(code) {
  const map = {
    40001: 'access_token 无效或已过期',
    40007: '无效媒体 ID（封面图上传失败或 media_id 不对）',
    40165: '无效 IP —— 本机公网出口 IP 没加进公众号后台的 IP 白名单',
    45009: '接口调用超过限额',
    48001: 'API 未授权 —— 当前账号类型不具备 draft/add 权限（个人订阅号常见）',
    53404: '账号已被限制发布能力',
    40003: '无效 AppID'
  };
  return map[code] ? map[code] + '（errcode ' + code + '）' : 'errcode ' + code;
}

// ---------- 步骤 1：access_token ----------
async function getToken(conf) {
  const r = await req(API + '/cgi-bin/token?grant_type=client_credential&appid=' +
    encodeURIComponent(conf.appid) + '&secret=' + encodeURIComponent(conf.appsecret));
  if (r.errcode) throw new Error('获取 token 失败：' + explain(r.errcode));
  return r.access_token;
}

// ---------- 步骤 2：上传封面（永久素材） ----------
async function uploadCover(token, coverPath) {
  if (!fs.existsSync(coverPath)) {
    throw new Error('找不到封面图：' + coverPath + '\n请放一张 JPG/PNG（建议 900×500，≤5MB）到该路径');
  }
  const file = fs.readFileSync(coverPath);
  const ext = path.extname(coverPath).toLowerCase();
  const mime = (ext === '.png') ? 'image/png' : 'image/jpeg';
  const name = path.basename(coverPath);
  const boundary = '----BenCaoBoundary' + Date.now();

  const head = Buffer.from(
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="media"; filename="' + name + '"\r\n' +
    'Content-Type: ' + mime + '\r\n\r\n', 'utf8');
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8');
  const body = Buffer.concat([head, file, tail]);

  const r = await req(API + '/cgi-bin/material/add_material?access_token=' + token +
    '&type=image', body, 'multipart/form-data; boundary=' + boundary);
  if (r.errcode) throw new Error('上传封面失败：' + explain(r.errcode));
  return r.media_id;
}

// ---------- 步骤 3：建草稿 ----------
async function addDraft(token, article) {
  const body = Buffer.from(JSON.stringify({ articles: [article] }), 'utf8');
  const r = await req(API + '/cgi-bin/draft/add?access_token=' + token, body);
  if (r.errcode) throw new Error('创建草稿失败：' + explain(r.errcode));
  return r.media_id;
}

// ---------- 抽内容区 HTML ----------
function contentOf(htmlFile) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const m = html.match(/<div class="phone" id="article">([\s\S]*?)\n<\/div>/);
  if (!m) throw new Error('排版稿里找不到正文区，请先跑 md2wechat.js 重新生成');
  return m[1].trim();
}

function pickDate() {
  const arg = process.argv[2];
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) return arg;
  const files = fs.readdirSync(DAILY).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
  if (!files.length) { console.error('daily/ 下没有文章'); process.exit(1); }
  return files[files.length - 1].replace(/\.md$/, '');
}

// ---------- 主流程 ----------
(async () => {
  const cmd = process.argv[2];

  if (cmd === 'init') { initConf(); return; }

  const conf = loadConf();

  if (cmd === 'test') {
    console.log('测试连通性……');
    let token;
    try {
      token = await getToken(conf);
      console.log('✓ access_token 获取成功（说明 AppID/AppSecret 正确、IP 已在白名单）');
    } catch (e) {
      console.error('✗ ' + e.message);
      process.exit(1);
    }
    // 用一个空草稿试探权限（会因缺封面失败，但能区分 48001 和其他错误）
    try {
      await addDraft(token, { title: '权限测试', content: 'test', thumb_media_id: 'x' });
      console.log('✓ draft/add 可调');
    } catch (e) {
      console.error(e.message);
      if (/48001/.test(e.message)) {
        console.error('\n结论：你的账号不具备草稿箱权限，建议用手动粘贴方案（md2wechat.js）。');
      } else if (/40007/.test(e.message)) {
        console.error('\n结论：draft/add 权限正常（40007 只是因为用了假封面 ID）。');
      }
    }
    return;
  }

  const date = pickDate();
  const mdPath = path.join(DAILY, date + '.md');
  const htmlPath = path.join(DAILY, date + '-wechat.html');

  if (!fs.existsSync(mdPath)) { console.error('找不到 ' + mdPath); process.exit(1); }
  if (!fs.existsSync(htmlPath)) {
    console.error('找不到排版稿，请先跑：node tools/md2wechat.js ' + date);
    process.exit(1);
  }

  const raw = fs.readFileSync(mdPath, 'utf8');
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let title = '本草日课 ' + date;
  if (fm) {
    const t = fm[1].match(/^标题:\s*(.*)$/m);
    if (t) title = t[1].trim();
  }
  const digest = raw.replace(/^---[\s\S]*?---/, '').replace(/[#>*`]/g, '').trim().slice(0, 54);

  console.log('准备推送：' + title);
  const token = await getToken(conf);
  const coverPath = path.resolve(ROOT, conf.cover || 'tools/cover.jpg');
  const thumb = await uploadCover(token, coverPath);
  console.log('封面已上传，media_id: ' + thumb);

  const mediaId = await addDraft(token, {
    title,
    author: conf.author || '',
    digest,
    content: contentOf(htmlPath),
    content_source_url: conf.sourceUrl || '',
    thumb_media_id: thumb,
    need_open_comment: 0,
    only_fans_can_comment: 0
  });

  console.log('✓ 草稿已创建，media_id: ' + mediaId);
  console.log('  去公众号后台 → 素材管理 → 草稿箱 查看');
  console.log('  注意：个人订阅号无法用 API 自动发布，需手动点发布');
})().catch(e => {
  console.error('✗ ' + e.message);
  process.exit(1);
});
