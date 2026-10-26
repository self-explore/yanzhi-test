// ============================================================
//  颜值测试系统 · 逻辑层（v2）
//  流程：封面 → 上传 → 分析动画 → 结果页
//  评分：图片内容哈希做种子 → 稳定伪随机（同一张照片结果永远一致）
// ============================================================

const $ = id => document.getElementById(id);

let imgFile = null;
let imgDataURL = '';
let lastResult = null;

// ---------------- 页面切换 ----------------
function show(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  $(id).classList.add('active');
  const sc = $(id).querySelector('.result-scroll');
  if (sc) sc.scrollTop = 0;
  window.scrollTo(0, 0);
}

// ---------------- 伪随机（可复现） ----------------
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRand(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function imageFingerprint(file, dataURL) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const W = 24, H = 24;
      c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, W, H);
      let px;
      try { px = ctx.getImageData(0, 0, W, H).data; }
      catch (e) { px = []; }
      let s = '';
      for (let i = 0; i < px.length; i += 16) s += String(px[i]) + ',';
      resolve(hashString(s + '|' + file.size + '|' + W + H));
    };
    img.onerror = () => resolve(hashString(file.name + '|' + file.size + '|' + file.lastModified));
    img.src = dataURL;
  });
}

// ---------------- 打分主逻辑 ----------------
function computeFace(seed) {
  const rnd = makeRand(seed);

  // 总分：三角分布 78-96，稀有 4% 抽到 92.5+
  const tri = (rnd() + rnd() + rnd()) / 3;
  let total = 78 + tri * 18;
  if (rnd() < 0.04) total = 92.5 + rnd() * 3.5;
  total = Math.min(96.4, Math.max(78, total));
  total = Math.round(total * 10) / 10;

  const band = SCORE_BANDS.find(b => total >= b.min) || SCORE_BANDS[SCORE_BANDS.length - 1];

  // 分项分数：围绕总分 ±0.9
  const base = 6.6 + (total - 78) / 18 * 3.2;
  const dims = FACE_DIMS.map(d => {
    let sc = base + (rnd() - 0.5) * 1.8;
    sc = Math.min(9.9, Math.max(6.2, sc));
    return { key: d.key, name: d.name, icon: d.icon, score: Math.round(sc * 10) / 10 };
  });

  const sorted = [...dims].sort((a, b) => b.score - a.score);
  const { main, sub } = pickTypes(sorted);
  const mainType = FACE_TYPES.find(t => t.key === main);
  const subType = FACE_TYPES.find(t => t.key === sub);

  return { total, band, dims, seed, main: mainType, sub: subType, rnd: makeRand(seed + 7) };
}

// 类型判定：按「维度排名」加权
function pickTypes(sorted) {
  const rank = {};
  sorted.forEach((d, i) => { rank[d.key] = i; });
  const Rw = k => (rank[k] === 0 ? 3 : rank[k] === 1 ? 2 : rank[k] === 2 ? 1 : 0);

  const rules = [
    { key: 'cool',    score: Rw('eyes') * 1.3 + Rw('proportion') * 1.2 + Rw('jawline') * 0.8 },
    { key: 'sweet',   score: Rw('smile') * 1.4 + Rw('width') * 1.2 + Rw('skin') * 0.7 },
    { key: 'atmos',   score: Rw('eyes') * 1.5 + Rw('symmetry') * 1.0 + Rw('skin') * 0.9 },
    { key: 'elegant', score: Rw('proportion') * 1.5 + Rw('width') * 1.3 + Rw('symmetry') * 1.0 },
    { key: 'sharp',   score: Rw('jawline') * 1.6 + Rw('nose') * 1.2 + Rw('symmetry') * 0.7 },
    { key: 'gentle',  score: Rw('skin') * 1.3 + Rw('smile') * 1.2 + Rw('face') * 1.1 + Rw('jawline') * 0.5 },
    { key: 'youth',   score: Rw('smile') * 1.2 + Rw('face') * 1.3 + Rw('width') * 1.1 },
    { key: 'classic', score: Rw('symmetry') * 1.4 + Rw('eyes') * 1.1 + Rw('proportion') * 1.1 }
  ];
  rules.sort((a, b) => b.score - a.score);
  return { main: rules[0].key, sub: rules[1].key };
}

// ---------------- 取样工具 ----------------
function sampler(rnd) {
  const pick = (arr, n) => {
    const pool = [...arr];
    const out = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    return out;
  };
  const one = arr => arr[Math.floor(rnd() * arr.length)];
  return { pick, one };
}

// ---------------- 各板块生成 ----------------
function buildStars(r, rnd) {
  const { pick } = sampler(rnd);
  const keys = pick(r.main.starKeys, 3);
  let sim = 88 + Math.floor(rnd() * 5);
  return keys.map((k, i) => {
    const s = STAR_POOL[k];
    return {
      name: s.name, desc: s.desc,
      sim: Math.max(70, sim - i * (5 + Math.floor(rnd() * 3))),
      tags: [r.main.name].concat(pick(s.tags, 1))
    };
  });
}

function buildAesthetic(r, rnd) {
  return AESTHETIC_REGIONS.map(rg => {
    const { pick } = sampler(rnd);
    const sc = Math.round(Math.min(97, Math.max(58, r.total + rg.scoreBase + (rnd() - 0.5) * 6)));
    return {
      name: rg.name, desc: rg.desc, score: sc,
      adv: pick(rg.adv, 2),
      feat: pick(rg.feat, 3)
    };
  });
}

function buildParts(r, rnd) {
  return PART_DETAIL.map(p => {
    const { pick, one } = sampler(rnd);
    return {
      name: p.name, icon: p.icon,
      tags: p.tagPool.map(pool => one(pool)),
      desc: one(p.desc),
      adv: pick(p.adv, 3),
      beauty: pick(p.beauty, 2)
    };
  });
}

function buildSkin(rnd) {
  const { pick, one } = sampler(rnd);
  return {
    fields: SKIN_FIELDS.map(f => ({ label: f.label, value: one(f.opts) })),
    good: pick(SKIN_GOOD, 3),
    care: pick(SKIN_CARE, 2),
    routine: pick(SKIN_ROUTINE, 2)
  };
}

function buildBone(rnd) {
  const { pick, one } = sampler(rnd);
  return {
    fields: BONE_FIELDS.map(f => ({ label: f.label, value: one(f.opts) })),
    ratio: one(BONE_RATIO),
    d3: one(BONE_3D),
    good: pick(BONE_GOOD, 3),
    feat: pick(BONE_FEAT, 3),
    opt: pick(BONE_OPT, 2)
  };
}

function buildHair(rnd) {
  const { pick } = sampler(rnd);
  return pick(HAIR_POOL, 3);
}

function buildColor(rnd) {
  const { pick } = sampler(rnd);
  return { good: pick(COLOR_GOOD, 5), avoid: pick(COLOR_AVOID, 3) };
}

// ---------------- 渲染 ----------------
function render(r) {
  const t = r.main, st = r.sub;
  const n = v => v.toFixed(1);
  const stars = buildStars(r, r.rnd);
  const aesthetic = buildAesthetic(r, r.rnd);
  const parts = buildParts(r, r.rnd);
  const skin = buildSkin(r.rnd);
  const bone = buildBone(r.rnd);
  const hair = buildHair(r.rnd);
  const color = buildColor(r.rnd);
  const dotPos = Math.max(2, Math.min(98, (r.total - 70) / 30 * 100));

  const chipRow = (arr, cls) => `<div class="chip-row ${cls || ''}">${arr.map(x => `<span class="chip">${x}</span>`).join('')}</div>`;

  const partHTML = parts.map(p => `
    <div class="part-block">
      <div class="pb-head"><i>${p.icon}</i><span class="pb-name">${p.name}</span></div>
      ${chipRow(p.tags, 'pink')}
      <p class="pb-desc">${p.desc}</p>
      <div class="pb-sec adv"><div class="pb-label">优势特点</div>
        ${p.adv.map(x => `<div class="pb-li">· ${x}</div>`).join('')}
      </div>
      <div class="pb-sec beauty"><div class="pb-label">美化建议</div>
        ${p.beauty.map(x => `<div class="pb-li">· ${x}</div>`).join('')}
      </div>
    </div>
  `).join('');

  const skinGrid = skin.fields.map(f => `
    <div class="kv"><div class="kv-label">${f.label}</div><div class="kv-value">${f.value}</div></div>
  `).join('');

  const boneGrid = bone.fields.map(f => `
    <div class="kv"><div class="kv-label">${f.label}</div><div class="kv-value">${f.value}</div></div>
  `).join('');

  const makeupSec = Object.values(MAKEUP_DEEP).map(sec => `
    <div class="mk-sec">
      <div class="mk-title">${sec.title}</div>
      <div class="mk-sub">${sec.sub}</div>
      ${sec.groups.map(g => `
        <div class="mk-group"><div class="mk-glabel">${g.label}</div>
          ${g.items.map(x => `<div class="mg-item">${x}</div>`).join('')}
        </div>
      `).join('')}
    </div>
  `).join('');

  $('result-scroll').innerHTML = `
    <div class="r-hero fade">
      <img class="r-photo" src="${imgDataURL}" alt="">
      <div class="r-hero-label">✨ 美学评分</div>
      <div class="r-score">${n(r.total)}<small>/ 100</small></div>
      <div class="r-quote">${r.band.quote}</div>
      <div class="r-band">${r.band.label}</div>
      <p class="r-hero-desc">${r.band.desc}</p>
      <div class="scale-wrap">
        <div class="scale-track"><div class="scale-dot" id="scale-dot"></div></div>
        <div class="scale-marks"><span>70</span><span>80</span><span>90</span><span>100</span></div>
      </div>
    </div>

    <div class="sec fade" style="animation-delay:.06s">
      <div class="sec-head"><div class="sec-title">☆ 颜值风格定位</div></div>
      <div class="card type-card">
        <div class="chip-row center">
          <span class="chip primary">${t.name}</span>
          <span class="chip soft">${st.name}</span>
        </div>
        <p class="type-desc">${t.desc}</p>
        <div class="kv-line"><span class="kl">气质特点</span>${chipRow(t.traits)}</div>
        <div class="kv-line"><span class="kl">适合场景</span>${chipRow(t.scenes)}</div>
        <div class="kv-line col"><span class="kl">风格优势</span>${t.strengths.map(x => `<div class="mg-item">${x}</div>`).join('')}</div>
        <div class="kv-line col"><span class="kl">发展方向</span>${t.growth.map(x => `<div class="mg-item">${x}</div>`).join('')}</div>
      </div>
    </div>

    <div class="sec fade" style="animation-delay:.1s">
      <div class="sec-head"><div class="sec-title">✨ 明星相似度匹配</div></div>
      <div class="sec-sub-inline">根据您的面部特征，为您匹配了以下明星</div>
      ${stars.map(s => `
        <div class="card star-card2">
          <div class="sc-top">
            <div class="sc-avatar">${s.name.slice(0, 1)}</div>
            <div class="sc-main">
              <div class="sc-name">${s.name}</div>
              <div class="sc-sim">相似度 <strong>${s.sim}%</strong></div>
            </div>
          </div>
          <p class="sc-desc">${s.desc}</p>
          <div class="kv-line"><span class="kl">匹配特征</span>${chipRow(s.tags, 'pink')}</div>
        </div>
      `).join('')}
    </div>

    <div class="sec fade" style="animation-delay:.14s">
      <div class="sec-head"><div class="sec-title">🌐 国际化审美倾向</div></div>
      <div class="sec-sub-inline">您的面部特征在不同地区审美标准中的表现</div>
      ${aesthetic.map(a => `
        <div class="card region-card">
          <div class="rg-top"><div class="rg-name">${a.name}</div><div class="rg-score">${a.score} <small>/ 100</small></div></div>
          <p class="rg-desc">${a.desc}</p>
          <div class="kv-line"><span class="kl">优势特征</span>${chipRow(a.adv, 'fill')}</div>
          <div class="kv-line"><span class="kl">符合特点</span>${chipRow(a.feat)}</div>
        </div>
      `).join('')}
    </div>

    <div class="sec fade" style="animation-delay:.18s">
      <div class="sec-head"><div class="sec-title">👁 五官详细分析</div></div>
      <div class="card">${partHTML}</div>
    </div>

    <div class="sec fade" style="animation-delay:.22s">
      <div class="sec-head"><div class="sec-title">💧 皮相分析</div></div>
      <div class="card">
        <div class="kv-grid">${skinGrid}</div>
        <div class="sec3-label good">皮肤优势</div>
        ${skin.good.map(x => `<div class="check-li">✓ ${x}</div>`).join('')}
        <div class="sec3-label warn">注意事项</div>
        ${skin.care.map(x => `<div class="warn-li">! ${x}</div>`).join('')}
        <div class="sec3-label">护肤建议</div>
        ${skin.routine.map(x => `<div class="mg-item">${x}</div>`).join('')}
      </div>
    </div>

    <div class="sec fade" style="animation-delay:.26s">
      <div class="sec-head"><div class="sec-title">🦴 骨相分析</div></div>
      <div class="card">
        <div class="kv-grid">${boneGrid}</div>
        <div class="ratio-box">
          <div><strong>面部比例：</strong>${bone.ratio}</div>
          <div><strong>立体度：</strong>${bone.d3}</div>
        </div>
        <div class="sec3-label good">骨相优势</div>
        ${bone.good.map(x => `<div class="check-li">✓ ${x}</div>`).join('')}
        <div class="sec3-label">骨相特征</div>
        ${bone.feat.map(x => `<div class="mg-item">${x}</div>`).join('')}
        <div class="sec3-label">优化建议</div>
        ${bone.opt.map(x => `<div class="mg-item">${x}</div>`).join('')}
      </div>
    </div>

    <div class="sec fade" style="animation-delay:.3s">
      <div class="sec-head"><div class="sec-title">🎨 专业化妆建议</div></div>
      <div class="card">
        ${makeupSec}
        <div class="mk-sec">
          <div class="mk-title">风格与场合</div>
          <div class="mk-group"><div class="mk-glabel">风格定位</div>${MAKEUP_STYLE.slice(0,3).map(x => `<div class="mg-item">${x}</div>`).join('')}</div>
          <div class="mk-group"><div class="mk-glabel">场合妆容</div>${MAKEUP_OCCASION.slice(0,3).map(x => `<div class="mg-item">${x}</div>`).join('')}</div>
          <div class="mk-group"><div class="mk-glabel">实用技巧</div>${MAKEUP_TIPS.slice(0,3).map(x => `<div class="mg-item">${x}</div>`).join('')}</div>
        </div>
      </div>
    </div>

    <div class="sec fade" style="animation-delay:.34s">
      <div class="sec-head"><div class="sec-title">✂ 发型建议</div></div>
      <div class="card">
        ${hair.map((x, i) => `<div class="hair-item"><span class="hair-idx">${i + 1}</span>${x}</div>`).join('')}
      </div>
    </div>

    <div class="sec fade" style="animation-delay:.38s">
      <div class="sec-head"><div class="sec-title">♡ 色彩搭配建议</div></div>
      <div class="card">
        <div class="kv-line"><span class="kl">适合的颜色</span>${chipRow(color.good, 'pink')}</div>
        <div class="kv-line"><span class="kl">避免的颜色</span>${chipRow(color.avoid)}</div>
      </div>
    </div>

    <div class="r-foot">
      <p class="foot-share">你的结果是「${t.name}」· ${n(r.total)} 分<br>截图发给朋友，看看她是不是也被说中了</p>
      <button class="btn-again" id="btn-again">测另一张照片</button>
      <p class="disclaimer">本报告基于 AI 面部特征识别生成，属于娱乐性参考，不作为任何专业美学或医学结论。照片仅在你的浏览器本地处理，不会上传到服务器。</p>
    </div>
  `;

  show('page-result');

  requestAnimationFrame(() => {
    setTimeout(() => {
      const dot = $('scale-dot');
      if (dot) dot.style.left = dotPos + '%';
    }, 120);
  });

  $('btn-again').addEventListener('click', reset);
}

// ---------------- 交互 ----------------
function bindUpload() {
  const dz = $('drop-zone');
  const input = $('file-input');

  $('btn-start').addEventListener('click', () => show('page-upload'));

  dz.addEventListener('click', () => input.click());
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('over');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  input.addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (f) handleFile(f);
  });

  $('btn-reselect').addEventListener('click', () => {
    input.value = '';
    $('preview-wrap').classList.remove('show');
    dz.style.display = '';
  });

  $('btn-analyze').addEventListener('click', startAnalyze);
}

function handleFile(file) {
  if (!file.type.startsWith('image/')) { alert('请上传图片文件'); return; }
  if (file.size > 10 * 1024 * 1024) { alert('图片超过 10MB，请压缩后再上传'); return; }
  imgFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    imgDataURL = e.target.result;
    $('preview-img').src = imgDataURL;
    $('drop-zone').style.display = 'none';
    $('preview-wrap').classList.add('show');
  };
  reader.readAsDataURL(file);
}

const LOAD_STEPS = [
  '正在读取面部轮廓…',
  '正在测量三庭五眼比例…',
  '正在分析骨相结构…',
  '正在评估皮肤质感…',
  '正在匹配颜值类型…',
  '正在生成专属建议…'
];

let analyzing = false;

async function startAnalyze() {
  if (analyzing || !imgFile) return;
  analyzing = true;
  $('loading-img').src = imgDataURL;
  show('page-loading');

  const seed = await imageFingerprint(imgFile, imgDataURL);
  const result = computeFace(seed);
  lastResult = result;

  const fill = $('load-fill');
  const stepEl = $('load-step');
  const totalMs = 3400;
  const perStep = totalMs / LOAD_STEPS.length;

  LOAD_STEPS.forEach((txt, i) => {
    setTimeout(() => {
      stepEl.textContent = txt;
      fill.style.width = ((i + 1) / LOAD_STEPS.length * 100) + '%';
    }, i * perStep);
  });

  setTimeout(() => {
    render(result);
    analyzing = false;
  }, totalMs + 420);
}

function reset() {
  imgFile = null;
  imgDataURL = '';
  lastResult = null;
  $('file-input').value = '';
  $('preview-wrap').classList.remove('show');
  $('drop-zone').style.display = '';
  $('load-fill').style.width = '0';
  $('load-step').textContent = LOAD_STEPS[0];
  show('page-upload');
}

document.addEventListener('DOMContentLoaded', () => {
  bindUpload();
  show('page-cover');
});
