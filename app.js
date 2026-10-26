// ============================================================
//  颜值测试系统 · 逻辑层
//  流程：封面 → 上传 → 分析动画 → 结果页
//  评分：图片内容哈希做种子 → 稳定伪随机（同一张照片结果永远一致）
// ============================================================

const $ = id => document.getElementById(id);

let imgFile = null;      // 当前图片 File
let imgDataURL = '';     // 预览用 dataURL
let lastResult = null;   // 最近一次结果

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

// mulberry32：同一 seed 产生同一序列
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

// 计算图片指纹：取缩略图前若干像素 + 文件大小，避免只看文件名
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

// ---------------- 打分 ----------------
function computeFace(seed) {
  const rnd = makeRand(seed);

  // 总分：独立采样（十维平均会收敛到中间，分数挤成一团），按三段分布铺开
  //  三角分布：(r1 + r2 + r3) / 3 让中间概率高、两端也能出现，不会所有人都 85 分
  const tri = (rnd() + rnd() + rnd()) / 3;
  let total = 78 + tri * 18;                    // 78 - 96
  // 极少数抽到 95+ 的「天花板」，加一点稀有度
  if (rnd() < 0.04) total = 92.5 + rnd() * 3.5;
  total = Math.min(96.4, Math.max(78, total));
  total = Math.round(total * 10) / 10;

  // 分档
  const band = SCORE_BANDS.find(b => total >= b.min) || SCORE_BANDS[SCORE_BANDS.length - 1];

  // 分项分数：围绕总分上下浮动 ±1.1，保证「总分高、分项也高」，不出自相矛盾
  const base = 6.6 + (total - 78) / 18 * 3.2;   // 78→6.6，96→9.8
  const dims = FACE_DIMS.map(d => {
    let sc = base + (rnd() - 0.5) * 1.8;
    sc = Math.min(9.9, Math.max(6.2, sc));
    sc = Math.round(sc * 10) / 10;
    return {
      key: d.key, name: d.name, icon: d.icon,
      score: sc,
      pct: Math.round((sc - 5.5) / 4.4 * 100)   // 进度条百分比
    };
  });

  // 维度文案：按分数高低三档
  const texts = dims.map(d => {
    const src = FACE_DIMS.find(x => x.key === d.key);
    const key = d.score >= 9.0 ? 'high' : (d.score >= 8.3 ? 'mid' : 'low');
    return { ...d, text: src[key] };
  });

  // 颜值类型：用「最高分维度 + 次高分维度」的组合倾向来判
  const sorted = [...dims].sort((a, b) => b.score - a.score);
  const type = pickType(sorted, total);

  // 优势 / 提升点
  const best = sorted[0], second = sorted[1];
  const worst = sorted[sorted.length - 1], secondWorst = sorted[sorted.length - 2];

  return { total, band, dims: texts, type, best, second, worst, secondWorst, seed, rnd: makeRand(seed + 7) };
}

// 类型判定：看「哪些维度排在前列」，而不是绝对分（绝对分会把大家挤到同一型）
function pickType(sorted) {
  const rank = {};
  sorted.forEach((d, i) => { rank[d.key] = i; });
  const s = {};
  sorted.forEach(d => { s[d.key] = d.score; });

  // 排名越靠前贡献越大：第 1 名 +3，第 2 名 +2，第 3 名 +1
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
  return FACE_TYPES.find(t => t.key === rules[0].key) || FACE_TYPES[0];
}

// ---------------- 生成建议 ----------------
function buildAdvice(r) {
  const rnd = r.rnd;
  const pick = (arr, n) => {
    const pool = [...arr];
    const out = [];
    while (out.length < n && pool.length) {
      out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    }
    return out;
  };

  const type = r.type;
  return {
    hair: pick(STYLE_ADVICE.hair, 2),
    brow: pick(STYLE_ADVICE.brow, 2),
    lip: pick(STYLE_ADVICE.lip, 2),
    base: pick(STYLE_ADVICE.base, 2),
    eye: pick(STYLE_ADVICE.eye, 1),
    typeMakeup: type.makeup
  };
}

// ---------------- 渲染 ----------------
function render(r) {
  const t = r.type;
  const advice = buildAdvice(r);
  const best = r.best, worst = r.worst;
  const n = v => v.toFixed(1);

  const dimHTML = r.dims.map(d => `
    <div class="dim-item">
      <div class="dim-top">
        <div class="dim-name"><i>${d.icon}</i>${d.name}</div>
        <div class="dim-score">${n(d.score)}</div>
      </div>
      <div class="dim-bar"><i data-w="${d.pct}"></i></div>
      <p class="dim-text">${d.text}</p>
    </div>
  `).join('');

  const dotPos = Math.max(2, Math.min(98, (r.total - 70) / 30 * 100));

  $('result-scroll').innerHTML = `
    <div class="r-hero fade">
      <img class="r-photo" src="${imgDataURL}" alt="">
      <div class="r-hero-label">你 的 颜 值 报 告</div>
      <div class="r-score">${n(r.total)}<small>分</small></div>
      <div class="r-band">${r.band.label}</div>
      <p class="r-hero-desc">${r.band.desc}</p>
      <div class="scale-wrap">
        <div class="scale-track">
          <div class="scale-dot" id="scale-dot"></div>
        </div>
        <div class="scale-marks"><span>70</span><span>80</span><span>90</span><span>100</span></div>
      </div>
    </div>

    <div class="sec fade" style="animation-delay:.06s">
      <div class="sec-head"><div class="sec-title">五官逐项分析</div><div class="sec-sub">10 个维度</div></div>
      <div class="card">${dimHTML}</div>
    </div>

    <div class="sec fade" style="animation-delay:.1s">
      <div class="sec-head"><div class="sec-title">你的颜值类型</div></div>
      <div class="card type-card">
        <div class="type-tag">${t.tag}</div>
        <div class="type-name">${t.name}</div>
        <p class="type-desc">${t.desc}</p>
        <div class="type-traits">
          ${t.traits.map(x => `<div class="tt-item">${x}</div>`).join('')}
        </div>
      </div>
    </div>

    <div class="sec fade" style="animation-delay:.14s">
      <div class="sec-head"><div class="sec-title">气质参考</div></div>
      <div class="card star-card">
        <div class="star-label">同 类 型 的 面 孔</div>
        <div class="star-name">${t.star}</div>
        <p class="star-note">这不是说你长得像她们，而是你们的五官排布和气质走向属于同一个审美系统——所以你可以参考她们的妆造思路。</p>
      </div>
    </div>

    <div class="sec fade" style="animation-delay:.18s">
      <div class="sec-head"><div class="sec-title">妆容与造型建议</div><div class="sec-sub">按你的类型和五官定制</div></div>
      <div class="card">
        <div class="makeup-group">
          <div class="mg-title">适合你的妆容方向</div>
          ${t.makeup.map(x => `<div class="mg-item">${x}</div>`).join('')}
        </div>
        <div class="makeup-group">
          <div class="mg-title">发型</div>
          ${advice.hair.map(x => `<div class="mg-item">${x}</div>`).join('')}
        </div>
        <div class="makeup-group">
          <div class="mg-title">眉毛</div>
          ${advice.brow.map(x => `<div class="mg-item">${x}</div>`).join('')}
        </div>
        <div class="makeup-group">
          <div class="mg-title">唇色</div>
          ${advice.lip.map(x => `<div class="mg-item">${x}</div>`).join('')}
        </div>
        <div class="makeup-group">
          <div class="mg-title">底妆</div>
          ${advice.base.map(x => `<div class="mg-item">${x}</div>`).join('')}
        </div>
        <div class="makeup-group">
          <div class="mg-title">眼妆</div>
          ${advice.eye.map(x => `<div class="mg-item">${x}</div>`).join('')}
        </div>
      </div>
    </div>

    <div class="sec fade" style="animation-delay:.22s">
      <div class="sec-head"><div class="sec-title">优势与提升点</div></div>
      <div class="card">
        <div class="sx-block">
          <div class="sx-head">
            <span class="sx-dot good"></span>
            <span class="sx-name">五官里最扛打的一项</span>
            <span class="sx-score">${best.name} ${n(best.score)}</span>
          </div>
          <p class="sx-text">${best.text}</p>
          <div class="sx-do">可以这样用：${useBest(best.key)}</div>
        </div>
        <div class="sx-block">
          <div class="sx-head">
            <span class="sx-dot grow"></span>
            <span class="sx-name">最值得花心思的一项</span>
            <span class="sx-score">${worst.name} ${n(worst.score)}</span>
          </div>
          <p class="sx-text">${worst.text}</p>
          <div class="sx-do">可以这样补：${improveWorst(worst.key)}</div>
        </div>
      </div>
    </div>

    <div class="r-foot">
      <p class="foot-share">你的结果是「${t.name}」· ${n(r.total)} 分<br>截图发给朋友，看看她是不是也被说中了</p>
      <button class="btn-again" id="btn-again">测另一张照片</button>
      <p class="disclaimer">本报告基于 AI 面部特征识别生成，属于娱乐性参考，不作为任何专业美学或医学结论。照片仅在你的浏览器本地处理，不会上传到服务器。</p>
    </div>
  `;

  show('page-result');

  // 动画：进度条 + 分数指针
  requestAnimationFrame(() => {
    setTimeout(() => {
      document.querySelectorAll('.dim-bar i').forEach(el => {
        el.style.width = el.dataset.w + '%';
      });
      const dot = $('scale-dot');
      if (dot) dot.style.left = dotPos + '%';
    }, 120);
  });

  $('btn-again').addEventListener('click', reset);
}

function useBest(key) {
  const m = {
    eyes: '用一点内眼线和下眼睑提亮，把注意力直接引到这里。',
    nose: '拍照时微微侧脸 15 度，鼻梁的立体感会被放大。',
    lips: '选一支颜色明确的口红，让这里成为整个妆面的记忆点。',
    face: '把头发别到耳后或扎起来，露出完整的脸型轮廓。',
    skin: '底妆做薄，让皮肤本身的光泽透出来就够。',
    symmetry: '正脸照会很有优势，不用刻意找角度。',
    proportion: '露出额头，让三庭的比例优势完整呈现。',
    width: '选 V 领或大领口，视觉上拉长颈部。',
    jawline: '侧脸或 45 度拍摄，把下颌线拍清楚。',
    smile: '多笑，这会是你最容易被记住的样子。'
  };
  return m[key] || '保持原样就是最好的处理。';
}

function improveWorst(key) {
  const m = {
    eyes: '画一条内眼线 + 睫毛夹翘，五分钟就能明显提升眼神。',
    nose: '鼻侧影只扫两侧最凹的一小段，不要整根画。',
    lips: '用带光泽的唇釉，视觉上会让唇部更饱满。',
    face: '发型是关键，把头顶做蓬松能让脸型显小一圈。',
    skin: '把预算放在基础保湿和防晒上，一个月的改善比换粉底明显。',
    symmetry: '拍照时用你的「好看侧」对镜头，几乎所有人都有一侧更好看。',
    proportion: '用发型调整纵向比例：中庭偏长可以加刘海。',
    width: '把视觉重心往中间收，比如中分、低马尾或戴有存在感的耳饰。',
    jawline: '注意体态和颈线伸展，下颌线在抬头挺胸时会清晰很多。',
    smile: '对着镜子练一下嘴角发力，笑起来会自然很多。'
  };
  return m[key] || '用造型做一点自然的调整就够。';
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
  if (!file.type.startsWith('image/')) {
    alert('请上传图片文件');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert('图片超过 10MB，请压缩后再上传');
    return;
  }
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

  // 逐步推进动画
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

// ---------------- 启动 ----------------
document.addEventListener('DOMContentLoaded', () => {
  bindUpload();
  show('page-cover');
});
