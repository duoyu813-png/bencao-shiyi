#!/usr/bin/env node
/**
 * generate-daily.js — 云端「本草日课」生成器
 *
 * 流程：定节气 → 挑当令药材（自动避重复）→ Tavily 搜热点 → DeepSeek 写文
 *       → 写 daily/YYYY-MM-DD.md → 跑 md2wechat.js 出公众号稿 → 跑 build-daily.js 更新站点
 *
 * 环境变量（GitHub Actions Secrets）：
 *   LLM_API_KEY       必填，模型密钥（智谱 / Gemini / DeepSeek 等）
 *   LLM_BASE_URL      选填，默认智谱 https://open.bigmodel.cn/api/paas/v4
 *   LLM_MODEL         选填，默认 glm-4.5-flash（智谱免费模型）
 *   TAVILY_API_KEY    选填（缺省则跳过热点，改纯节气科普）
 *   FORCE=1           选填，当天已有文章时强制覆盖
 *   DATE=YYYY-MM-DD   选填，指定日期（测试用），默认今天
 *   DRY_RUN=1         选填，只选题不调用 AI
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DAILY = path.join(ROOT, 'daily');

const LLM_KEY = process.env.LLM_API_KEY || process.env.ZHIPU_API_KEY || process.env.GEMINI_API_KEY || process.env.DEEPSEEK_API_KEY || '';
const LLM_BASE = (process.env.LLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '');
const LLM_MODEL = process.env.LLM_MODEL || 'glm-4.5-flash';
const TV_KEY = process.env.TAVILY_API_KEY || '';
const FORCE = process.env.FORCE === '1';

const TYPES = ['应季食材', '节气养生', '专题分析', '热点辨析'];

function todayStr() {
  if (process.env.DATE && /^\d{4}-\d{2}-\d{2}$/.test(process.env.DATE)) return process.env.DATE;
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

/* ---------- 加载 window 数据 ---------- */
function loadWindow(files) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  files.forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  });
  return sandbox.window;
}

const win = loadWindow([
  'data/jieqi.js', 'data/herbs-1.js', 'data/herbs-2.js', 'data/herbs-3.js', 'data/herbs-4.js'
]);
const JIEQI = win.JIEQI || [];
const HERBS = win.HERBS || [];

/* ---------- 节气 ---------- */
function key(md) { return md[0] * 100 + md[1]; }
function jieqiOf(dateStr) {
  const tk = key([+dateStr.slice(5, 7), +dateStr.slice(8, 10)]);
  return JIEQI.find(j => {
    const a = key(j.start), b = key(j.end);
    return a <= b ? (tk >= a && tk <= b) : (tk >= a || tk <= b);
  }) || JIEQI[0];
}

/* ---------- 已写过的文章 ---------- */
function history() {
  return fs.readdirSync(DAILY)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort().reverse()
    .map(f => {
      const raw = fs.readFileSync(path.join(DAILY, f), 'utf8');
      const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const meta = {};
      if (m) m[1].split(/\r?\n/).forEach(l => {
        const kv = l.match(/^([^:：]+)[:：]\s*(.*)$/);
        if (kv) meta[kv[1].trim()] = kv[2].trim();
      });
      return { date: f.replace(/\.md$/, ''), herb: meta['主角药材'] || '', type: meta['选题类型'] || '' };
    });
}

/* ---------- 基于日期的可复现随机 ---------- */
function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickHerb(jq, dateStr, recentHerbs) {
  const month = +dateStr.slice(5, 7);
  const rand = rng(dateStr);
  const seasonal = HERBS.filter(h => (h.months || []).includes(month));
  const inFoods = h => (jq.foods || []).some(f => h.name === f || (h.alias || []).includes(f));
  const fresh = list => list.filter(h =>
    !recentHerbs.has(h.name) && !(h.alias || []).some(a => recentHerbs.has(a)));
  let pool = fresh(seasonal.filter(inFoods));
  if (!pool.length) pool = fresh(seasonal);
  if (!pool.length) pool = seasonal;
  if (!pool.length) pool = fresh(HERBS);
  if (!pool.length) pool = HERBS;
  return pool[Math.floor(rand() * pool.length)];
}

function pickType(dateStr, recentTypes) {
  const rand = rng(dateStr + ':type');
  const recent = new Set(recentTypes.slice(0, 2));
  const pool = TYPES.filter(t => !recent.has(t));
  const list = pool.length ? pool : TYPES;
  return list[Math.floor(rand() * list.length)];
}

/* ---------- Tavily 热点 ---------- */
async function tavily(query) {
  if (!TV_KEY) return null;
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TV_KEY },
    body: JSON.stringify({
      api_key: TV_KEY, query, search_depth: 'basic',
      include_answer: true, max_results: 5, topic: 'news', days: 7
    })
  });
  if (!res.ok) throw new Error('Tavily ' + res.status + ': ' + (await res.text()).slice(0, 200));
  const data = await res.json();
  return {
    answer: data.answer || '',
    items: (data.results || []).map(r => ({ title: r.title, url: r.url, content: (r.content || '').slice(0, 500) }))
  };
}

/* ---------- 调用 LLM ---------- */
async function chat(messages) {
  const res = await fetch(LLM_BASE + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LLM_KEY },
    body: JSON.stringify({ model: LLM_MODEL, messages, temperature: 1.0, max_tokens: 2600, stream: false })
  });
  if (!res.ok) throw new Error('LLM ' + res.status + ': ' + (await res.text()).slice(0, 300));
  const data = await res.json();
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('LLM 返回为空：' + JSON.stringify(data).slice(0, 300));
  return text.trim();
}

function buildMessages(dateStr, jq, herb, type, hot) {
  const system = [
    '你是「本草拾遗」的中医食疗专栏作者，文风：口语、克制、有据可查，不夸大、不恐吓。',
    '只用药食同源知识，全程不得做医疗诊断、不得开处方、不得承诺疗效。',
    '禁止编造古籍原文与出处；引用必须来自下方给定的「药材资料」，引用不到的不要引用。',
    '严禁编造新闻、数据、专家姓名与媒体名称；热点只能化用下方给出的搜索结果，且不得杜撰细节。',
    '全文约 1000 字，简体中文。'
  ].join('\n');

  const mb = (herb.recipes || []).map(r => `- ${r.name}｜组成：${r.material}｜制法：${r.method}｜效用：${r.effect}`).join('\n');
  const classic = (herb.classic || []).map(c => `《${c.book}》：${c.text}`).join('\n');

  const hotText = hot
    ? ('【今日热点搜索结果】\n' + (hot.answer ? '摘要：' + hot.answer + '\n' : '') +
       hot.items.map(i => `- ${i.title}（${i.url}）\n  ${i.content}`).join('\n'))
    : '【今日热点】无（未配置搜索），请纯以节气与药材知识切入。';

  const user = [
    `请写一篇 ${dateStr} 的「本草日课」。`,
    '',
    `【节气】${jq.name}（${jq.start[0]}/${jq.start[1]}–${jq.end[0]}/${jq.end[1]}）`,
    `养生要点：${jq.yangsheng}`,
    `饮食宜忌：${jq.yinshi}`,
    `应季食材：${(jq.foods || []).join('、')}`,
    '',
    `【主角药材】${herb.name}（别名：${(herb.alias || []).join('、') || '无'}；${herb.nature}，${herb.flavor}，归${(herb.meridian || []).join('、')}经）`,
    `功效：${herb.effect}`,
    `主治：${herb.indications}`,
    `禁忌：${herb.caution}`,
    classic ? '古籍：\n' + classic : '',
    mb ? '现有食疗方：\n' + mb : '',
    '',
    hotText,
    '',
    `【选题类型】${type}（请围绕这个角度组织文章：${typeDesc(type)}）`,
    '',
    '【输出格式】只输出文章正文本身，不要 frontmatter、不要代码块、不要任何说明文字。',
    '第一行写成「# 标题」，标题一句话，可含疑问或反差，不要带书名号，然后空一行再写正文。',
    '',
    '正文严格照下面结构写（小标题文字可自拟，但层级和符号必须一致）：',
    '# 标题',
    '开篇 1–2 段，从 ' + dateStr + ' 的节气或热点切入，约 150 字。',
    '## 它到底是什么',
    '讲清药性、功效、可引用的古籍，约 200 字。',
    '## 两道方子',
    '→ 方名：组成（写清用量）；制法；适用人群',
    '→ 方名：组成（写清用量）；制法；适用人群',
    '## 禁忌提醒',
    '写清哪些人不能吃、慎吃，约 150 字。',
    '> 本内容仅供学习参考，不替代医生诊断……（免责声明必须用 > 顶格开头，不要写成 ## 标题）',
    '*素材参考：……*',
    '',
    '硬性要求：食疗方必须以「→ 」顶格单独成行，2 道，用量明确；不要把方名写成 ### 标题。',
    '全文约 1000 字；资料不足时宁可少写，也不要编造古籍、新闻、专家或数据。'
  ].filter(Boolean).join('\n');

  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function typeDesc(t) {
  return {
    '应季食材': '从当下最当令的一味食材讲起，纠正一个常见误区',
    '节气养生': '讲清这个节气的身体变化与调养重点，药材是落点',
    '专题分析': '针对一个常见症状/体质做辨证分型，给出对应吃法',
    '热点辨析': '针对近期流传的养生说法，先摆出再辨析'
  }[t] || '围绕节气与药材展开';
}

/* ---------- 解析模型输出 ---------- */
function normalize(text, meta) {
  let t = text.trim();
  const fence = t.match(/^```[a-zA-Z]*\r?\n([\s\S]*?)\r?\n```$/);
  if (fence) t = fence[1].trim();

  const hm = t.match(/^#\s+(.+)$/m);
  let title;
  if (hm) {
    title = hm[1].trim();
    t = t.slice(t.indexOf(hm[0])).trim();
  } else {
    title = meta.fallbackTitle;
    t = '# ' + title + '\n\n' + t;
  }
  if (t.replace(/\s/g, '').length < 300) throw new Error('正文过短，疑似生成失败');

  return '---\n' +
    '标题: ' + title + '\n' +
    '日期: ' + meta.date + '\n' +
    '节气: ' + meta.jieqi + '\n' +
    '选题类型: ' + meta.type + '\n' +
    '主角药材: ' + meta.herb + '\n' +
    '---\n\n' + t + '\n';
}

/* ---------- 主流程 ---------- */
(async () => {
  if (!LLM_KEY && process.env.DRY_RUN !== '1') { console.error('缺少 LLM_API_KEY'); process.exit(1); }

  const dateStr = todayStr();
  const mdPath = path.join(DAILY, dateStr + '.md');
  if (fs.existsSync(mdPath) && !FORCE) {
    console.log(dateStr + ' 已有文章，跳过（FORCE=1 可覆盖）');
    return;
  }

  const jq = jieqiOf(dateStr);
  const hist = history();
  const recentHerbs = new Set();
  hist.slice(0, 12).forEach(h => {
    String(h.herb || '').split(/[、,，/／]/).forEach(s => {
      const base = s.replace(/[（(].*$/, '').trim();
      if (base) recentHerbs.add(base);
    });
  });
  const herb = pickHerb(jq, dateStr, recentHerbs);
  const type = pickType(dateStr, hist.map(h => h.type).filter(Boolean));
  if (!herb) { console.error('没有可选药材'); process.exit(1); }

  console.log(`日期 ${dateStr}｜节气 ${jq.name}｜药材 ${herb.name}｜选题 ${type}`);

  if (process.env.DRY_RUN === '1') {
    console.log('DRY_RUN：仅做选题，不调用 AI。已用药材 ' + [...recentHerbs].join('、'));
    return;
  }

  let hot = null;
  try {
    hot = await tavily(`${jq.name} 养生 时令 ${herb.name} 热点`);
    if (hot) console.log('热点结果 ' + hot.items.length + ' 条' + (hot.answer ? '（含摘要）' : ''));
    else console.log('未配置 TAVILY_API_KEY，跳过热点');
  } catch (e) {
    console.error('热点检索失败，降级为纯节气科普：' + e.message);
  }

  const content = await chat(buildMessages(dateStr, jq, herb, type, hot));
  fs.writeFileSync(mdPath, normalize(content, {
    date: dateStr,
    jieqi: `${jq.name}（${jq.start[0]}/${jq.start[1]}–${jq.end[0]}/${jq.end[1]}）`,
    type: type,
    herb: herb.name,
    fallbackTitle: `${jq.name}·${herb.name}：今日本草日课`
  }), 'utf8');
  console.log('已写入 ' + path.relative(ROOT, mdPath));

  execFileSync(process.execPath, [path.join(__dirname, 'md2wechat.js'), dateStr], { stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(__dirname, 'build-daily.js')], { stdio: 'inherit' });
  console.log('完成');
})().catch(e => { console.error('✗ ' + e.message); process.exit(1); });
