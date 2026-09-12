/* 本草拾遗 · 交互逻辑 */
(function () {
  'use strict';

  var HERBS = window.HERBS || [];
  var JIEQI = window.JIEQI || [];
  var BOOKS = window.BOOKS || [];
  var DAILY = window.DAILY || [];

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function join(arr, sep) { return (arr || []).filter(Boolean).join(sep || '、'); }

  /* 症状 / 需求 → 检索扩展词 */
  var SYMPTOM = {
    '失眠': ['失眠', '不眠', '安神', '多梦', '睡眠', '惊悸', '卧不安'],
    '咳嗽': ['咳嗽', '咳喘', '干咳', '痰多', '肺燥', '喘咳'],
    '湿气': ['湿', '祛湿', '化湿', '利水', '水肿', '痰饮'],
    '痛经': ['痛经', '经闭', '月经', '调经', '腹痛'],
    '补气': ['补气', '益气', '气虚', '乏力', '倦怠'],
    '补血': ['补血', '养血', '血虚', '萎黄'],
    '补肾': ['补肾', '肾虚', '益精', '腰膝', '固精'],
    '健脾': ['健脾', '脾虚', '食少', '便溏', '运化'],
    '便秘': ['便秘', '润肠', '肠燥', '大便'],
    '上火': ['清热', '泻火', '解毒', '火毒', '烦渴'],
    '头痛': ['头痛', '头眩', '眩晕', '头目', '清利头目'],
    '降脂': ['降脂', '化浊', '消食', '肥胖'],
    '血压': ['肝阳', '平肝', '眩晕', '血压'],
    '消渴': ['消渴', '生津', '口渴', '血糖'],
    '胃寒': ['温中', '散寒', '胃寒', '腹痛', '脾胃虚寒'],
    '易感冒': ['固表', '益气', '虚羸', '补虚'],
    '明目': ['明目', '目赤', '目昏', '眼'],
    '咽痛': ['咽喉', '咽痛', '利咽', '喉痹', '失音'],
    '浮肿': ['水肿', '利水', '小便不利', '浮肿'],
    '出汗': ['止汗', '盗汗', '自汗', '敛汗'],
    '白发': ['须发', '乌发', '早白', '补肝肾', '益精血'],
    '解酒': ['酒毒', '解酒', '酒'],
    '没胃口': ['食少', '开胃', '消食', '不思饮食', '食欲'],
    '养颜': ['润燥', '养血', '面色', '肌肤'],
    '腹泻': ['泄泻', '止泻', '便溏', '久泻'],
    '疲劳': ['虚羸', '乏力', '补虚', '气短', '倦怠']
  };

  /* ---------- 检索 ---------- */
  function haystack(h) {
    if (h._hay) return h._hay;
    var parts = [h.name, join(h.alias), h.type, h.cat, h.nature, h.flavor,
      join(h.meridian), h.effect, h.indications, h.usage, h.caution];
    (h.recipes || []).forEach(function (r) { parts.push(r.name, r.material, r.method, r.effect); });
    (h.classic || []).forEach(function (c) { parts.push(c.book, c.text); });
    h._hay = parts.join(' ');
    return h._hay;
  }

  function expand(q) {
    var out = [q];
    for (var k in SYMPTOM) {
      if (q.indexOf(k) > -1) out = out.concat(SYMPTOM[k]);
    }
    return out;
  }

  function score(h, terms, raw) {
    var s = 0, hay = haystack(h);
    var name = h.name, alias = join(h.alias);
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      if (!t) continue;
      var w = (i === 0 && t === raw) ? 1 : 0.5;
      if (name === t) s += 100 * w;
      else if (name.indexOf(t) > -1) s += 40 * w;
      if (alias.indexOf(t) > -1) s += 18 * w;
      if ((h.effect || '').indexOf(t) > -1) s += 9 * w;
      if ((h.indications || '').indexOf(t) > -1) s += 7 * w;
      if ((h.cat || '').indexOf(t) > -1) s += 10 * w;
      if (join(h.meridian).indexOf(t) > -1) s += 8 * w;
      if (hay.indexOf(t) > -1) s += 3 * w;
    }
    return s;
  }

  function searchHerbs(q, cat) {
    var raw = (q || '').trim();
    var terms = raw ? expand(raw) : [];
    var list = HERBS.filter(function (h) { return !cat || h.cat === cat; });
    if (!raw) {
      return list.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'zh'); });
    }
    return list.map(function (h) { return { h: h, s: score(h, terms, raw) }; })
      .filter(function (o) { return o.s > 0; })
      .sort(function (a, b) { return b.s - a.s; })
      .map(function (o) { return o.h; });
  }

  function natureClass(n) {
    if (!n) return 'plain';
    if (n.indexOf('热') > -1 || n.indexOf('温') > -1) return 'nature-warm';
    if (n.indexOf('寒') > -1 || n.indexOf('凉') > -1) return 'nature-cool';
    return 'nature-neutral';
  }

  function hl(text, q) {
    var t = esc(text);
    if (!q) return t;
    try {
      return t.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
        function (m) { return '<span style="color:#A32D2D">' + m + '</span>'; });
    } catch (e) { return t; }
  }

  function renderResults(list, q) {
    var box = $('results');
    $('count-line').textContent = q
      ? '检索「' + q + '」命中 ' + list.length + ' 味'
      : '共收录 ' + list.length + ' 味 · 点击查看详情';
    if (!list.length) {
      box.innerHTML = '<div class="empty">未找到相关条目<br><span style="font-size:13px">试试「失眠」「湿气」「补气」等关键词</span></div>';
      return;
    }
    box.innerHTML = list.map(function (h) {
      return '<article class="card" data-name="' + esc(h.name) + '">' +
        '<span class="mark">' + esc(h.type) + '</span>' +
        '<h3>' + hl(h.name, q) + '</h3>' +
        '<div class="alias">' + esc(join(h.alias)) + '</div>' +
        '<div class="tags">' +
          '<span class="tag ' + natureClass(h.nature) + '">' + esc(h.nature) + '</span>' +
          '<span class="tag plain">' + esc(h.flavor) + '</span>' +
          (h.meridian || []).map(function (m) { return '<span class="tag plain">归' + esc(m) + '经</span>'; }).join('') +
        '</div>' +
        '<p class="effect">' + hl(h.effect, q) + '</p>' +
        '</article>';
    }).join('');
  }

  /* ---------- 详情 ---------- */
  function openHerb(name) {
    var h = HERBS.filter(function (x) { return x.name === name; })[0];
    if (!h) return;
    var html = '<div class="sheet-head"><div>' +
      '<h2>' + esc(h.name) + '</h2>' +
      '<div class="alias">' + esc(join(h.alias)) + ' · ' + esc(h.cat) + '</div>' +
      '</div><button class="close-x" id="close-x">✕</button></div>' +
      '<div class="sheet-body">';

    html += '<div class="prop-grid">' +
      prop('四气', h.nature) + prop('五味', h.flavor) +
      prop('归经', join(h.meridian, '、') + '经') + prop('类别', h.cat) +
      prop('属性', h.type) + prop('用法', h.usage) +
      '</div>';

    html += sec('功效', '<p>' + esc(h.effect) + '</p>');
    html += sec('主治', '<p>' + esc(h.indications) + '</p>');

    if ((h.months || []).length) {
      var mn = h.months.map(function (m) { return m + '月'; }).join('、');
      html += sec('应季', '<p>' + esc(mn) + '　（' + seasonOf(h.months) + '）</p>');
    }

    if ((h.recipes || []).length) {
      html += '<div class="sec"><h4>食疗方</h4>' + h.recipes.map(function (r) {
        return '<div class="recipe">' +
          '<div class="rn">' + esc(r.name) + '</div>' +
          '<div class="rl"><b>组成</b>' + esc(r.material) + '</div>' +
          '<div class="rl"><b>制法</b>' + esc(r.method) + '</div>' +
          '<div class="rl"><b>效用</b>' + esc(r.effect) + '</div>' +
          (r.tip ? '<div class="tip">⚠ ' + esc(r.tip) + '</div>' : '') +
          '</div>';
      }).join('') + '</div>';
    }

    if ((h.classic || []).length) {
      html += '<div class="sec"><h4>古籍原文</h4>' + h.classic.map(function (c) {
        return '<div class="quote"><div class="qb">《' + esc(c.book) + '》</div>' +
          '<div class="qt">' + esc(c.text) + '</div></div>';
      }).join('') + '</div>';
    }

    var rel = relatedChapters(h);
    if (rel.length) {
      html += '<div class="sec"><h4>食疗古籍记载</h4>' + rel.map(function (r) {
        return '<div class="quote"><div class="qb">《' + esc(r.book) + '》' + esc(r.title) +
          (r.note ? ' · ' + esc(r.note) : '') + '</div>' +
          '<div class="qt">' + esc(clip(r.text, 180)) + '</div></div>';
      }).join('') + '</div>';
    }

    if (h.caution) html += '<div class="sec"><h4>禁忌与注意</h4><div class="caution">' + esc(h.caution) + '</div></div>';

    html += '</div>';
    showSheet(html);
    if (history.replaceState) history.replaceState(null, '', '#h=' + encodeURIComponent(name));
  }

  function prop(k, v) {
    if (!v) return '';
    return '<div class="prop"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></div>';
  }
  function sec(title, body) {
    return '<div class="sec"><h4>' + title + '</h4>' + body + '</div>';
  }

  /* 从食疗古籍中自动关联该药材的同名条目 */
  function relatedChapters(h) {
    var names = [h.name].concat(h.alias || []);
    var out = [];
    BOOKS.forEach(function (b) {
      b.chapters.forEach(function (c) {
        var segs = c.title.split(/[·、,，]/).map(function (s) { return s.trim(); });
        var hit = segs.some(function (s) {
          if (!s) return false;
          return names.some(function (n) {
            return n && (n === s || n.indexOf(s) > -1 || s.indexOf(n) > -1);
          });
        });
        if (hit) out.push({ book: b.title, title: c.title, text: c.text, note: c.t });
      });
    });
    return out.slice(0, 3);
  }

  function clip(text, n) {
    var t = String(text).replace(/\n+/g, ' ');
    return t.length > n ? t.slice(0, n) + '……' : t;
  }
  function seasonOf(months) {
    var set = {};
    months.forEach(function (m) { set[m] = 1; });
    var s = [];
    if (set[3] || set[4] || set[5]) s.push('春');
    if (set[6] || set[7] || set[8]) s.push('夏');
    if (set[9] || set[10] || set[11]) s.push('秋');
    if (set[12] || set[1] || set[2]) s.push('冬');
    return s.join('') + '令';
  }

  function showSheet(html) {
    var sh = $('sheet');
    sh.innerHTML = html;
    sh.hidden = false;
    $('mask').hidden = false;
    document.body.style.overflow = 'hidden';
    var cx = $('close-x');
    if (cx) cx.onclick = closeSheet;
    sh.scrollTop = 0;
  }
  function closeSheet() {
    $('sheet').hidden = true;
    $('mask').hidden = true;
    document.body.style.overflow = '';
    if (history.replaceState) history.replaceState(null, '', location.pathname);
  }

  /* ---------- 食疗方 ---------- */
  var ALL_RECIPES = [];
  HERBS.forEach(function (h) {
    (h.recipes || []).forEach(function (r) {
      ALL_RECIPES.push({ name: r.name, from: h.name, material: r.material, method: r.method, effect: r.effect, tip: r.tip });
    });
  });

  function renderRecipes(q) {
    var raw = (q || '').trim();
    var list = ALL_RECIPES.filter(function (r) {
      if (!raw) return true;
      var hay = r.name + r.from + r.material + r.method + r.effect + (r.tip || '');
      return hay.indexOf(raw) > -1;
    });
    $('recipe-total').textContent = ALL_RECIPES.length;
    var box = $('recipe-list');
    box.innerHTML = list.length ? list.map(function (r) {
      return '<div class="recipe-full">' +
        '<div class="rn" data-herb="' + esc(r.from) + '">' + esc(r.name) + '</div>' +
        '<div class="rfrom">出自 · ' + esc(r.from) + '</div>' +
        '<div class="rl"><b>组成</b>' + esc(r.material) + '</div>' +
        '<div class="rl"><b>制法</b>' + esc(r.method) + '</div>' +
        '<div class="rl"><b>效用</b>' + esc(r.effect) + '</div>' +
        (r.tip ? '<div class="tip">⚠ ' + esc(r.tip) + '</div>' : '') +
        '</div>';
    }).join('') : '<div class="empty">没有找到相关食疗方</div>';
    Array.prototype.forEach.call(box.querySelectorAll('[data-herb]'), function (el) {
      el.onclick = function () { openHerb(el.getAttribute('data-herb')); };
    });
  }

  /* ---------- 本草日课 ---------- */
  function renderDaily() {
    var box = $('daily-list');
    if (!DAILY.length) {
      box.innerHTML = '<div class="empty">暂无日课</div>';
      return;
    }
    box.innerHTML = DAILY.map(function (d, i) {
      return '<article class="daily-card" data-day="' + i + '">' +
        '<div class="daily-meta">' +
          '<span class="daily-date">' + esc(d.date) + '</span>' +
          (d.jieqi ? '<span class="daily-tag">' + esc(d.jieqi) + '</span>' : '') +
          (d.type ? '<span class="daily-tag plain">' + esc(d.type) + '</span>' : '') +
        '</div>' +
        '<h3 class="daily-title">' + esc(d.title) + '</h3>' +
        '<p class="daily-excerpt">' + esc(d.excerpt) + '</p>' +
        '</article>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-day]'), function (el) {
      el.onclick = function () { openDaily(DAILY[+el.getAttribute('data-day')]); };
    });
  }

  function openDaily(d) {
    if (!d) return;
    var html = '<div class="sheet-head"><div>' +
      '<h2>' + esc(d.title) + '</h2>' +
      '<div class="alias">' + esc(d.date) +
        (d.jieqi ? ' · ' + esc(d.jieqi) : '') +
        (d.herb ? ' · 主角药材 ' + esc(d.herb) : '') +
      '</div>' +
      '</div><button class="close-x" id="close-x">✕</button></div>' +
      '<div class="sheet-body daily-article">' + d.html + '</div>';
    showSheet(html);
  }

  /* ---------- 节气 ---------- */
  function key(md) { return md[0] * 100 + md[1]; }
  function todayJieqi() {
    var d = new Date(), tk = (d.getMonth() + 1) * 100 + d.getDate();
    for (var i = 0; i < JIEQI.length; i++) {
      var j = JIEQI[i], a = key(j.start), b = key(j.end);
      if (a <= b ? (tk >= a && tk <= b) : (tk >= a || tk <= b)) return j;
    }
    return JIEQI[0];
  }
  function daysToNext(j) {
    var d = new Date(), y = d.getFullYear();
    var idx = JIEQI.indexOf(j);
    var nxt = JIEQI[(idx + 1) % JIEQI.length];
    var ny = nxt.start[0] < j.start[0] && d.getMonth() + 1 >= 11 ? y + 1 : y;
    var target = new Date(ny, nxt.start[0] - 1, nxt.start[1]);
    var cur = new Date(y, d.getMonth(), d.getDate());
    return Math.max(0, Math.round((target - cur) / 86400000));
  }

  function renderToday() {
    var j = todayJieqi(), d = new Date();
    var next = daysToNext(j);
    $('today-box').innerHTML = '<div class="today">' +
      '<div class="lbl">今日 · ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日</div>' +
      '<h2 class="jq">' + esc(j.name) + '</h2>' +
      '<div class="py">' + esc(j.pinyin) + ' · ' + esc(j.season) + '季 · 距下一节气约 ' + next + ' 天</div>' +
      '<div class="wh">' + esc(j.wuhou) + '</div>' +
      '<div class="row">' +
      row('养生', j.yangsheng) + row('起居', j.qiju) +
      row('饮食', j.yinshi) + row('经络', j.jingluo) +
      row('防病', j.caution) +
      '</div>' +
      '<div style="margin-top:12px">' +
        '<div class="lbl">应季食材</div>' +
        '<div class="food-mini">' + j.foods.map(function (f) {
          return '<span data-food="' + esc(f) + '">' + esc(f) + '</span>';
        }).join('') + '</div>' +
      '</div>' +
      '</div>';
    Array.prototype.forEach.call($('today-box').querySelectorAll('[data-food]'), function (el) {
      el.onclick = function () {
        switchView('search');
        $('q').value = el.getAttribute('data-food');
        doSearch();
        window.scrollTo(0, 0);
      };
    });
  }
  function row(k, v) {
    return '<div class="k">' + k + '</div><div class="v">' + esc(v) + '</div>';
  }

  function renderJieqiGrid() {
    var cur = todayJieqi();
    $('jq-grid').innerHTML = JIEQI.map(function (j) {
      return '<div class="jq-card' + (j.name === cur.name ? ' now' : '') + '" data-jq="' + esc(j.name) + '">' +
        '<div class="jn">' + esc(j.name) + '</div>' +
        '<div class="jd">' + j.start[0] + '/' + j.start[1] + ' – ' + j.end[0] + '/' + j.end[1] + '</div>' +
        '<div class="jy">' + esc(j.yangsheng) + '</div>' +
        '</div>';
    }).join('');
    Array.prototype.forEach.call($('jq-grid').querySelectorAll('[data-jq]'), function (el) {
      el.onclick = function () { openJieqi(el.getAttribute('data-jq')); };
    });
  }

  function openJieqi(name) {
    var j = JIEQI.filter(function (x) { return x.name === name; })[0];
    if (!j) return;
    var html = '<div class="sheet-head"><div>' +
      '<h2>' + esc(j.name) + '</h2>' +
      '<div class="alias">' + esc(j.pinyin) + ' · ' + j.start[0] + '/' + j.start[1] + ' – ' + j.end[0] + '/' + j.end[1] + '</div>' +
      '</div><button class="close-x" id="close-x">✕</button></div><div class="sheet-body">';
    html += sec('物候', '<p style="font-family:var(--serif);color:var(--cinnabar)">' + esc(j.wuhou) + '</p>');
    html += sec('养生要点', '<p>' + esc(j.yangsheng) + '</p>');
    html += sec('起居作息', '<p>' + esc(j.qiju) + '</p>');
    html += sec('饮食宜忌', '<p>' + esc(j.yinshi) + '</p>');
    html += sec('经络调养', '<p>' + esc(j.jingluo) + '</p>');
    html += sec('注意事项', '<div class="caution">' + esc(j.caution) + '</div>');
    html += '<div class="sec"><h4>应季食材</h4><div class="food-mini">' +
      j.foods.map(function (f) { return '<span data-food="' + esc(f) + '">' + esc(f) + '</span>'; }).join('') +
      '</div></div>';
    html += '</div>';
    showSheet(html);
    Array.prototype.forEach.call($('sheet').querySelectorAll('[data-food]'), function (el) {
      el.onclick = function () {
        closeSheet();
        switchView('search');
        $('q').value = el.getAttribute('data-food');
        doSearch();
        window.scrollTo(0, 0);
      };
    });
  }

  /* ---------- 古籍 ---------- */
  var curBook = BOOKS[0] ? BOOKS[0].id : null;

  /* 书目分组：医经本草 / 食疗专著 */
  var GROUP = [
    { name: '医经本草', ids: ['suwen', 'lingshu', 'shennong', 'shanghan', 'jingui', 'bencao', 'qianjin'] },
    { name: '食疗专著', ids: ['shiliao', 'yinshan', 'suixiju', 'yanglao', 'shanjia', 'zunsheng', 'laolao', 'shixian', 'diaoding'] }
  ];

  function renderBookList() {
    var html = '';
    GROUP.forEach(function (g) {
      var items = g.ids.map(function (id) {
        return BOOKS.filter(function (x) { return x.id === id; })[0];
      }).filter(Boolean);
      if (!items.length) return;
      html += '<div class="grp">' + esc(g.name) + ' · ' + items.length + ' 部</div>';
      html += items.map(function (b) {
        return '<div class="book-item' + (b.id === curBook ? ' on' : '') + '" data-book="' + esc(b.id) + '">' +
          '<div class="bt">' + esc(b.title) + '</div>' +
          '<div class="ba">' + esc(b.dynasty) + ' · ' + esc(b.author) + '</div>' +
          '</div>';
      }).join('');
    });
    $('book-list').innerHTML = html;
    Array.prototype.forEach.call($('book-list').querySelectorAll('[data-book]'), function (el) {
      el.onclick = function () { curBook = el.getAttribute('data-book'); renderBookList(); renderBook(); };
    });
  }

  function renderBook() {
    var q = ($('bq').value || '').trim();
    var b = BOOKS.filter(function (x) { return x.id === curBook; })[0];
    if (!b) return;
    var chapters = b.chapters.filter(function (c) {
      return !q || (c.title + c.text).indexOf(q) > -1;
    });
    var html = '<h2 class="ptitle">' + esc(b.title) + '</h2>' +
      '<div class="pmeta">' + esc(b.dynasty) + ' · ' + esc(b.author) + ' · 收录 ' + b.chapters.length + ' 章</div>' +
      '<div class="pintro">' + esc(b.intro) + '</div>';
    if (!chapters.length) {
      html += '<div class="empty">本经中未检索到「' + esc(q) + '」<br><span style="font-size:13px">可切换左侧其他典籍</span></div>';
    }
    html += chapters.map(function (c) {
      return '<div class="chapter"><h4>' + esc(c.title) +
        (c.t ? '<span class="ctag">' + esc(c.t) + '</span>' : '') + '</h4>' +
        '<div class="ctext">' + hlq(c.text, q) + '</div></div>';
    }).join('');
    $('book-panel').innerHTML = html;
  }

  function hlq(text, q) {
    var t = esc(text);
    if (!q) return t;
    try {
      return t.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
        function (m) { return '<span style="background:#FAEEDA;color:#633806">' + m + '</span>'; });
    } catch (e) { return t; }
  }

  /* ---------- 视图切换 ---------- */
  function switchView(v) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('on', t.getAttribute('data-view') === v);
    });
    ['search', 'recipes', 'jieqi', 'books', 'daily'].forEach(function (k) {
      $('view-' + k).hidden = (k !== v);
    });
    if (v === 'jieqi') { renderToday(); renderJieqiGrid(); }
    if (v === 'books') { renderBookList(); renderBook(); }
    if (v === 'recipes') renderRecipes($('rq').value);
    if (v === 'daily') renderDaily();
  }

  /* ---------- 分类 chips ---------- */
  function buildChips() {
    var cats = [];
    HERBS.forEach(function (h) { if (h.cat && cats.indexOf(h.cat) < 0) cats.push(h.cat); });
    var cur = null;
    var box = $('cat-chips');
    function paint() {
      box.innerHTML = '<span class="chip' + (cur ? '' : ' on') + '" data-cat="">全部</span>' +
        cats.map(function (c) {
          return '<span class="chip' + (cur === c ? ' on' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</span>';
        }).join('');
      Array.prototype.forEach.call(box.querySelectorAll('[data-cat]'), function (el) {
        el.onclick = function () {
          var c = el.getAttribute('data-cat');
          cur = cur === c ? null : c;
          paint(); doSearch();
        };
      });
    }
    paint();
    return function () { return cur; };
  }

  /* ---------- 启动 ---------- */
  function doSearch() {
    renderResults(searchHerbs($('q').value, getCat()), ($('q').value || '').trim());
  }

  var getCat = function () { return null; };

  document.addEventListener('DOMContentLoaded', function () {
    getCat = buildChips();
    doSearch();

    $('foot-n').textContent = HERBS.length;
    $('foot-r').textContent = ALL_RECIPES.length;
    $('foot-b').textContent = BOOKS.length;

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.onclick = function () { switchView(t.getAttribute('data-view')); };
    });

    $('btn-search').onclick = doSearch;
    $('q').oninput = doSearch;
    $('q').onkeydown = function (e) { if (e.key === 'Enter') doSearch(); };

    $('btn-rsearch').onclick = function () { renderRecipes($('rq').value); };
    $('rq').oninput = function () { renderRecipes($('rq').value); };

    $('bq').oninput = renderBook;

    $('mask').onclick = closeSheet;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('sheet').hidden) closeSheet();
    });

    $('results').addEventListener('click', function (e) {
      var card = e.target.closest ? e.target.closest('.card') : null;
      if (card) openHerb(card.getAttribute('data-name'));
    });

    var m = location.hash.match(/^#h=(.+)$/);
    if (m) openHerb(decodeURIComponent(m[1]));
  });
})();
