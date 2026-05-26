const SECTIONS = [
  { label: 'Aeneid I 1–11',  url: './aeneid_i_1-11.json' },
  { label: 'Aeneid I 12–22', url: './aeneid_i_12-22.json' },
];
const STORAGE_KEY = 'latin-quiz-v1';

let currentSection = 0;

let words = [];
let byLine = {};
let ablatives = [];
let ablUses = [];

let activeView = 'reading';
let question = null;

function freshStore() {
  return { streak: 0, total: 0, words: {}, cats: {}, queue: [] };
}

function normalizeUse(use) {
  if (!use) return use;
  if (/\bobject of\b/i.test(use)) return 'object of a preposition';
  if (/\bmodifying\b/i.test(use)) return 'modifying a noun';
  return use.replace(/"/g, '').trim();
}

function loadStore() {
  try {
    const s = { ...freshStore(), ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
    // Migrate old specific category keys (e.g. 'modifying "nūmine"') to normalized ones.
    const cats = {};
    for (const [cat, val] of Object.entries(s.cats || {})) {
      const key = normalizeUse(cat);
      if (cats[key]) { cats[key].c += val.c; cats[key].w += val.w; }
      else cats[key] = { ...val };
    }
    s.cats = cats;
    return s;
  } catch {
    return freshStore();
  }
}

function saveStore(s) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

// find "abl." anywhere in note.
function parseAblative(note) {
  if (!note || !note.includes('abl.')) {
    return { isAblative: false, ablativeUse: null };
  }

  // match "abl." + gender + number + use
  const m = note.match(/abl\.\s+(?:[nmf]\.\s+)?(?:s\.|pl\.)?\s*(.*)/);
  if (!m) return { isAblative: true, ablativeUse: null };

  let use = m[1].trim() || null;
  if (use) {
    use = use.replace(/\bobject of\b.*/i, 'object of a preposition');
    use = use.replace(/\bmodifying\b.*/i, 'modifying a noun');
    use = use.replace(/"/g, '').trim();
  }
  return { isAblative: true, ablativeUse: use };
}

async function loadData(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();

  words = raw.map((w, i) => {
    const { isAblative, ablativeUse } = parseAblative(w.note);
    return { ...w, id: `${w.line}-${i}`, isAblative, ablativeUse };
  });

  byLine = {};
  for (const w of words) {
    (byLine[w.line] ??= []).push(w);
  }

  ablatives = words.filter(w => w.isAblative);
  ablUses   = [...new Set(ablatives.map(w => w.ablativeUse).filter(Boolean))].sort();
}

// string helper methods
function decodeEntities(str) {
  return (str || '')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function esc(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// strip trailing punctuation for use in quiz prompts.
function bare(word) {
  return word.replace(/[,;.:!?]+$/, '');
}

// nav
function showView(name) {
  activeView = name;

  document.querySelectorAll('.view').forEach(el =>
    el.classList.toggle('hidden', el.id !== `view-${name}`)
  );
  document.querySelectorAll('.nav-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.view === name)
  );

  if (name === 'quizA') nextQuestion('A');
  if (name === 'quizB') nextQuestion('B');
  if (name === 'stats') renderStats();
}

// section picker
function renderSectionPicker() {
  const picker = document.getElementById('section-picker');
  picker.innerHTML = SECTIONS.map((s, i) =>
    `<button class="section-btn${i === currentSection ? ' active' : ''}" data-section="${i}">${esc(s.label)}</button>`
  ).join('');
}

async function switchSection(idx) {
  currentSection = idx;
  renderSectionPicker();
  await loadData(SECTIONS[idx].url);
  renderPassage();
}

// reading view
function renderPassage() {
  const lineNums = Object.keys(byLine).map(Number).sort((a, b) => a - b);
  document.getElementById('passage').innerHTML = lineNums.map(n => {
    const spans = byLine[n].map(w =>
      `<span class="word" data-id="${w.id}">${esc(w.word)}</span>`
    ).join(' ');
    return `<div class="line"><span class="ln">${n}</span>${spans}</div>`;
  }).join('\n');
}

// quiz helpers
// Pick a word from pool; words in the review queue get 3x weight.
function pickWord(pool) {
  if (!pool.length) return null;
  const inQueue = new Set(loadStore().queue);
  const weighted = pool.flatMap(w => inQueue.has(w.id) ? [w, w, w] : [w]);
  return weighted[Math.floor(Math.random() * weighted.length)];
}

// 2 lines before and after
function contextHTML(target) {
  const ctx = [target.line - 2, target.line - 1, target.line, target.line + 1, target.line + 2].filter(n => byLine[n]);
  return ctx.map(n =>
    `<div class="line">` +
    `<span class="ln">${n}</span>` +
    byLine[n].map(w =>
      `<span class="word${w.id === target.id ? ' hl' : ''}">${esc(w.word)}</span>`
    ).join(' ') +
    `</div>`
  ).join('\n');
}

function recordAnswer(word, correct) {
  const s = loadStore();

  if (!s.words[word.id]) s.words[word.id] = { c: 0, w: 0 };
  s.words[word.id][correct ? 'c' : 'w']++;

  if (word.ablativeUse) {
    if (!s.cats[word.ablativeUse]) s.cats[word.ablativeUse] = { c: 0, w: 0 };
    s.cats[word.ablativeUse][correct ? 'c' : 'w']++;
  }

  if (correct) {
    s.streak++;
    s.queue = s.queue.filter(id => id !== word.id);
  } else {
    s.streak = 0;
    if (!s.queue.includes(word.id)) s.queue.push(word.id);
  }

  s.total++;
  saveStore(s);
}

function updateStreak(mode) {
  const el = document.getElementById(`streak-${mode}`);
  if (el) el.textContent = `Streak: ${loadStore().streak}`;
}

// next question
function nextQuestion(mode) {
  updateStreak(mode);

  let pool;
  if (mode === 'A') {
    // Roughly 50/50 ablative vs non-ablative so "yes" and "no" are equally common.
    const nonAbl = words.filter(w => !w.isAblative);
    pool = Math.random() < 0.5 ? ablatives : nonAbl;
    if (!pool.length) pool = words;
  } else {
    pool = ablatives.filter(w => w.ablativeUse);
    if (!pool.length) {
      document.getElementById('quizB-content').innerHTML =
        '<p class="empty">No ablative words with identified uses in this dataset.</p>';
      return;
    }
  }

  const word = pickWord(pool);
  if (!word) return;
  question = { word, mode };

  const container = document.getElementById(`quiz${mode}-content`);

  if (mode === 'A') {
    container.innerHTML =
      `<div class="quiz-layout">` +
        `<div class="quiz-text"><div class="ctx">${contextHTML(word)}</div></div>` +
        `<div class="quiz-questions">` +
          `<p class="prompt">Is <em>${esc(bare(word.word))}</em> ablative?</p>` +
          `<div class="ans-row">` +
            `<button class="btn btn-yn yes" data-ans="yes">Yes</button>` +
            `<button class="btn btn-yn no"  data-ans="no">No</button>` +
          `</div>` +
          `<div class="result hidden"></div>` +
        `</div>` +
      `</div>`;
  } else {
    const btns = ablUses.map(u =>
      `<button class="btn btn-use" data-ans="${esc(u)}">${esc(u)}</button>`
    ).join('');
    container.innerHTML =
      `<div class="quiz-layout">` +
        `<div class="quiz-text"><div class="ctx">${contextHTML(word)}</div></div>` +
        `<div class="quiz-questions">` +
          `<p class="prompt">What is the ablative use of <em>${esc(bare(word.word))}</em>?</p>` +
          `<div class="ans-col">${btns}</div>` +
          `<div class="result hidden"></div>` +
        `</div>` +
      `</div>`;
  }
}

function handleQuizClick(mode, e) {
  const nextBtn = e.target.closest('[data-next]');
  if (nextBtn) { nextQuestion(mode); return; }

  const ansBtn = e.target.closest('[data-ans]');
  if (!ansBtn || !question || question.mode !== mode) return;

  // ignore clicks if answers are already disabled (already answered).
  if (ansBtn.disabled) return;

  const answer = ansBtn.dataset.ans;
  const { word } = question;
  const correct = mode === 'A'
    ? (answer === 'yes') === word.isAblative
    : answer === word.ablativeUse;

  recordAnswer(word, correct);
  updateStreak(mode);

  const container = document.getElementById(`quiz${mode}-content`);
  container.querySelectorAll('[data-ans]').forEach(b => {
    b.disabled = true;
    const isCorrectChoice = mode === 'A'
      ? (b.dataset.ans === 'yes') === word.isAblative
      : b.dataset.ans === word.ablativeUse;
    if (isCorrectChoice) b.classList.add('btn-correct');
    else if (b === ansBtn) b.classList.add('btn-wrong');
  });

  const correctLabel = word.isAblative
    ? (word.ablativeUse ? `ablative — ${word.ablativeUse}` : 'ablative')
    : 'not ablative';

  const result = container.querySelector('.result');
  result.classList.remove('hidden');
  result.innerHTML =
    `<div class="verdict ${correct ? 'ok' : 'err'}">` +
      (correct ? 'Correct!' : `Incorrect. Answer: <strong>${esc(correctLabel)}</strong>`) +
    `</div>` +
    `<div class="detail">` +
      `<span class="d-dict">${esc(decodeEntities(word.dictionary))}</span><br>` +
      `<span class="d-en">${esc(decodeEntities(word.english))}</span>` +
      (word.note ? `<br><span class="d-note">${esc(word.note)}</span>` : '') +
    `</div>` +
    `<button class="btn btn-next" data-next>Next →</button>`;
}

function renderStats() {
  const s  = loadStore();
  const wv = Object.values(s.words);
  const tc = wv.reduce((n, v) => n + v.c, 0);
  const tw = wv.reduce((n, v) => n + v.w, 0);
  const tt = tc + tw;
  const pct = tt ? Math.round(100 * tc / tt) : 0;

  const catRows = Object.entries(s.cats)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, v]) => {
      const t = v.c + v.w;
      const p = t ? Math.round(100 * v.c / t) : 0;
      return `<tr>` +
        `<td>${esc(cat)}</td>` +
        `<td>${v.c}/${t}</td>` +
        `<td><div class="bar-wrap"><div class="bar" style="width:${p}%"></div></div> ${p}%</td>` +
        `</tr>`;
    }).join('');

  document.getElementById('stats-content').innerHTML =
    `<div class="card">` +
      `<h3>Overall</h3>` +
      `<p>Questions answered: <strong>${tt}</strong></p>` +
      `<p>Accuracy: <strong>${pct}%</strong> (${tc} correct of ${tt})</p>` +
      `<p>Current streak: <strong>${s.streak}</strong></p>` +
      `<p>Review queue: <strong>${s.queue.length}</strong> word${s.queue.length !== 1 ? 's' : ''}</p>` +
    `</div>` +
    (catRows
      ? `<div class="card">` +
          `<h3>By ablative use</h3>` +
          `<table class="stat-tbl">` +
            `<thead><tr><th>Category</th><th>Score</th><th>Accuracy</th></tr></thead>` +
            `<tbody>${catRows}</tbody>` +
          `</table>` +
        `</div>`
      : `<p class="empty">Answer Abl. Case Quiz questions to see per-category stats.</p>`
    ) +
    `<div class="card">` +
      `<button class="btn btn-danger" id="btn-reset">Reset all statistics</button>` +
    `</div>`;

  document.getElementById('btn-reset').addEventListener('click', () => {
    if (confirm('Reset all quiz statistics and the review queue?')) {
      saveStore(freshStore());
      renderStats();
    }
  });
}

function init() {
  renderSectionPicker();
  renderPassage();

  document.getElementById('section-picker').addEventListener('click', e => {
    const btn = e.target.closest('[data-section]');
    if (btn) switchSection(Number(btn.dataset.section));
  });

  // Navigation
  document.getElementById('nav').addEventListener('click', e => {
    const btn = e.target.closest('[data-view]');
    if (btn) showView(btn.dataset.view);
  });

  document.getElementById('quizA-content').addEventListener('click', e => handleQuizClick('A', e));
  document.getElementById('quizB-content').addEventListener('click', e => handleQuizClick('B', e));

  showView('reading');
}

loadData(SECTIONS[0].url)
  .then(init)
  .catch(err => {
    document.body.innerHTML =
      `<div style="padding:2rem;font-family:sans-serif;color:#9b2226">` +
      `Failed to load word data: ${err.message}` +
      `</div>`;
  });
