// 画面・入力・描画
(function () {
  'use strict';

  const { GoGame, RULES, BLACK, WHITE, EMPTY, MAX_HANDICAP } = Go;
  // 碁盤の大きさと星の位置
  const BOARDS = {
    19: [[3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15]],
    13: [[3, 3], [3, 9], [9, 3], [9, 9], [6, 6]],
    9: [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]],
  };
  let SIZE = 19;
  const NAMES = { [BLACK]: '黒', [WHITE]: '白' };
  const $ = (s) => document.querySelector(s);

  const canvas = $('#board');
  const g2 = canvas.getContext('2d');
  const gameEl = $('#game');

  let game, clock;
  let phase = 'title'; // title | play | paused | scoring | over
  let dead = new Set();
  let wiped = new Set(); // 勝ちの演出で消した石（盤には残っているが描かない）
  let terrGlow = null; // 地の総攻撃中に見せる地 { map, color }
  let pending = -1;     // 2回タップモードで仮置きしている交点
  let hover = -1;
  let lockUntil = 0;    // 演出中は着手できない
  let geo = { css: 0, margin: 0, cell: 0 };

  const opt = {
    confirm: $('#opt-confirm'),
    face: $('#opt-face'),
    trace: $('#opt-trace'),
    coords: $('#opt-coords'),
  };
  opt.confirm.checked = window.matchMedia('(pointer: coarse)').matches;
  // 座標の表示は前回の設定を使う（座標の分だけ盤の外側を広げる）
  try { const c = localStorage.getItem('destroy-go-coords'); if (c !== null) opt.coords.checked = c === '1'; } catch (e) { /* 無視 */ }
  opt.coords.onchange = () => {
    try { localStorage.setItem('destroy-go-coords', opt.coords.checked ? '1' : '0'); } catch (e) { /* 無視 */ }
    if (game) layout();
  };
  // 座標の文字：横は A〜T（I は 1 と紛らわしいので使わないのが囲碁の決まり）、縦は下から 1〜19
  const COLS = 'ABCDEFGHJKLMNOPQRST';

  // ---------- 演出テーマ（プレイヤーごと） ----------
  // 無料版で使える演出（製品版では全部）
  const ED = window.EDITION || { free: false, version: '' };
  const FREE = !!ED.free;
  // 無料版の隠し要素：条件を満たすと、その端末でほかの演出も使えるようになる（製品版は最初から全部）
  const SECRETS = {
    fire: 'タイトルのロゴを壊した',
    thunder: 'デストロイルールで KO 勝ちした',
    dark: '一度に 20 子以上取った',
    light: 'コンピューター Lv9 に勝った',
  };
  const secretUnlocked = new Set();
  try { for (const k of JSON.parse(localStorage.getItem('destroy-go-unlocks') || '[]')) if (SECRETS[k]) secretUnlocked.add(k); } catch (e) { /* 無視 */ }
  const unlocked = (key) => !FREE || ED.freeThemes.includes(key) || secretUnlocked.has(key);
  const themeKeys = () => FX.themes.map((t) => t.key).filter(unlocked);
  const themeOf = (key) => FX.themes.find((t) => t.key === key) || FX.themes[0];
  // 黒と白で同じ演出は選べない（どちらの演出か一目でわかるように）
  const themes = { [BLACK]: 'default', [WHITE]: FREE ? 'ice' : 'fire' };
  try {
    const saved = JSON.parse(localStorage.getItem('destroy-go-themes') || '{}');
    for (const c of [BLACK, WHITE]) {
      const k = saved[c] === 'explosion' ? 'dark' : saved[c]; // 「爆発」は「闇」に作り替えた
      if (themeKeys().includes(k)) themes[c] = k;
    }
  } catch (e) { /* 保存できない環境ではデフォルトのまま */ }
  const otherColor = (c) => (c === BLACK ? WHITE : BLACK);
  // 前に保存した設定が同じ演出なら、白を空いている演出に変える
  if (themes[BLACK] === themes[WHITE]) themes[WHITE] = themeKeys().find((k) => k !== themes[BLACK]);
  let previewColor = BLACK;

  // ---------- ルール（日本／中国） ----------
  const RULE_DESC = {
    japanese: '地＋アゲハマ（取った石・死に石）で計算',
    chinese: '地＋盤上の自分の石で計算',
  };
  let rules = 'japanese';
  try { const r = localStorage.getItem('destroy-go-rules'); if (RULES[r]) rules = r; } catch (e) { /* 無視 */ }

  // 対戦相手：2 人で対局か、コンピューター（強さ 1〜9、あなたが黒か白か）
  // 勝ち負けの決め方：ふつうの囲碁（地の多さ）か、デストロイルール（HP バトル）
  let mode = 'go';
  try { if (localStorage.getItem('destroy-go-mode') === 'destroy') mode = 'destroy'; } catch (e) { /* 無視 */ }
  // HP ハンデ（デストロイルールのとき）：なし／+25%／+50%／+100%、もらうのは黒か白
  let hpBonus = 0, hpBonusColor = BLACK;
  try { const h = JSON.parse(localStorage.getItem('destroy-go-hpbonus') || '{}'); if ([0.25, 0.5, 1].includes(h.rate)) hpBonus = h.rate; if (h.color === WHITE) hpBonusColor = WHITE; } catch (e) { /* 無視 */ }
  // デストロイルールの種類：初級（基本だけ。中ではシンプル版と呼ぶ）か上級（倍率・反動あり）
  let dAdvanced = false;
  try { dAdvanced = localStorage.getItem('destroy-go-dlevel') === 'advanced'; } catch (e) { /* 無視 */ }
  function renderMode() {
    document.querySelectorAll('#dlevel-chips .chip').forEach((c) => c.setAttribute('aria-pressed', (c.dataset.level === 'advanced') === dAdvanced));
    $('#dlevel-row').hidden = mode !== 'destroy';
    document.querySelectorAll('#mode-chips .chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.mode === mode));
    document.querySelectorAll('#hpb-chips .chip').forEach((c) => c.setAttribute('aria-pressed', +c.dataset.rate === hpBonus));
    document.querySelectorAll('#hpb-who-chips .chip').forEach((c) => c.setAttribute('aria-pressed', +c.dataset.color === hpBonusColor));
    $('#hpb-row').hidden = mode !== 'destroy';
    $('#hpb-who-row').hidden = mode !== 'destroy' || !hpBonus;
  }
  const saveHpBonus = () => { try { localStorage.setItem('destroy-go-hpbonus', JSON.stringify({ rate: hpBonus, color: hpBonusColor })); } catch (e) { /* 無視 */ } };
  for (const [rate, label] of [[0, 'なし'], [0.25, '+25%'], [0.5, '+50%'], [1, '+100%']]) {
    const chip = document.createElement('button');
    chip.className = 'chip rule-chip'; chip.dataset.rate = rate; chip.textContent = label;
    chip.onclick = () => { hpBonus = rate; saveHpBonus(); renderMode(); renderRules(); };
    $('#hpb-chips').appendChild(chip);
  }
  for (const [color, label] of [[BLACK, '黒'], [WHITE, '白']]) {
    const chip = document.createElement('button');
    chip.className = 'chip rule-chip'; chip.dataset.color = color; chip.textContent = label;
    chip.onclick = () => { hpBonusColor = color; saveHpBonus(); renderMode(); renderRules(); };
    $('#hpb-who-chips').appendChild(chip);
  }
  for (const [key, label] of [['simple', '初級'], ['advanced', '上級（倍率・反動あり）']]) {
    const chip = document.createElement('button');
    chip.className = 'chip rule-chip'; chip.dataset.level = key; chip.textContent = label;
    chip.onclick = () => { dAdvanced = key === 'advanced'; try { localStorage.setItem('destroy-go-dlevel', key); } catch (e) { /* 無視 */ } renderMode(); renderRules(); showRuleTab('destroy'); };
    $('#dlevel-chips').appendChild(chip);
  }
  for (const [key, label] of [['go', 'ふつうの囲碁（地の多さ）'], ['destroy', 'デストロイルール（HPバトル）【調整中】']]) {
    const chip = document.createElement('button');
    chip.className = 'chip rule-chip'; chip.dataset.mode = key; chip.textContent = label;
    chip.onclick = () => { mode = key; try { localStorage.setItem('destroy-go-mode', key); } catch (e) { /* 無視 */ } renderMode(); renderRules(); showRuleTab(key); };
    $('#mode-chips').appendChild(chip);
  }
  renderMode();

  // 置き石（ハンデ）：0（なし）か 2〜9 子。コンピューター戦では、置くのがあなたかコンピューターかも選ぶ（置く側が黒）
  let opponent = 'human', cpuLevel = 3, humanColor = BLACK, handicap = 0, hcWho = 'human', cpuResign = true;
  try {
    const o = JSON.parse(localStorage.getItem('destroy-go-opponent') || '{}');
    if (o.opponent === 'cpu') opponent = 'cpu';
    if (o.level >= 1 && o.level <= 9) cpuLevel = o.level;
    if (o.human === WHITE) humanColor = WHITE;
    if (o.handicap >= 2 && o.handicap <= 9) handicap = o.handicap;
    if (o.hcWho === 'cpu') hcWho = 'cpu';
    if (o.resign === false) cpuResign = false;
  } catch (e) { /* 無視 */ }
  const saveOpponent = () => { try { localStorage.setItem('destroy-go-opponent', JSON.stringify({ opponent, level: cpuLevel, human: humanColor, handicap, hcWho, resign: cpuResign })); } catch (e) { /* 無視 */ } };
  // 今の碁盤で実際に置く数（9 路は 5 子まで）
  const effectiveHandicap = () => Math.min(handicap, MAX_HANDICAP[SIZE] || 9);
  // コンピューター戦であなたが持つ色（置き石があれば、置く側が黒）
  const gameHumanColor = () => (effectiveHandicap() ? (hcWho === 'human' ? BLACK : WHITE) : humanColor);
  function renderOpponent() {
    const hc = effectiveHandicap();
    document.querySelectorAll('#opp-chips .chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.opp === opponent));
    document.querySelectorAll('#level-chips .chip').forEach((c) => c.setAttribute('aria-pressed', +c.dataset.level === cpuLevel));
    document.querySelectorAll('#side-chips .chip').forEach((c) => c.setAttribute('aria-pressed', +c.dataset.side === humanColor));
    document.querySelectorAll('#hc-chips .chip').forEach((c) => {
      const n = +c.dataset.hc;
      c.setAttribute('aria-pressed', n === hc);
      c.disabled = n > (MAX_HANDICAP[SIZE] || 9); // 9 路では 6 子以上は選べない
    });
    document.querySelectorAll('#hc-who-chips .chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.who === hcWho));
    document.querySelectorAll('#resign-chips .chip').forEach((c) => c.setAttribute('aria-pressed', (c.dataset.resign === '1') === cpuResign));
    $('#level-row').hidden = $('#resign-row').hidden = opponent !== 'cpu';
    $('#side-row').hidden = opponent !== 'cpu' || hc > 0; // 置き石があるときは置く側で色が決まる
    $('#hc-who-row').hidden = opponent !== 'cpu' || hc === 0;
  }
  const addChip = (box, text, data, onclick) => {
    const chip = document.createElement('button');
    chip.className = 'chip rule-chip'; chip.textContent = text;
    Object.assign(chip.dataset, data);
    chip.onclick = () => { onclick(); saveOpponent(); renderOpponent(); renderRules(); };
    $(box).appendChild(chip);
  };
  addChip('#opp-chips', '2人で対局', { opp: 'human' }, () => { opponent = 'human'; });
  addChip('#opp-chips', 'コンピューター', { opp: 'cpu' }, () => { opponent = 'cpu'; });
  { // オンライン対戦は製品版で準備中（押してもお知らせだけ）
    const chip = document.createElement('button');
    chip.className = 'chip rule-chip soon'; chip.textContent = 'オンライン対戦（製品版）【coming soon】';
    chip.onclick = () => toast('オンライン対戦は製品版で準備中です。お楽しみに！');
    $('#opp-chips').appendChild(chip);
  }
  for (let lv = 1; lv <= 9; lv++) addChip('#level-chips', `Lv${lv}`, { level: lv }, () => { cpuLevel = lv; });
  addChip('#side-chips', '黒（先手）', { side: BLACK }, () => { humanColor = BLACK; });
  addChip('#side-chips', '白（後手）', { side: WHITE }, () => { humanColor = WHITE; });
  addChip('#resign-chips', 'する', { resign: '1' }, () => { cpuResign = true; });
  addChip('#resign-chips', 'しない', { resign: '0' }, () => { cpuResign = false; });
  addChip('#hc-chips', 'なし', { hc: 0 }, () => { handicap = 0; });
  for (let n = 2; n <= 9; n++) addChip('#hc-chips', `${n}子`, { hc: n }, () => { handicap = n; });
  addChip('#hc-who-chips', 'あなた（黒）', { who: 'human' }, () => { hcWho = 'human'; });
  addChip('#hc-who-chips', 'コンピューター（黒）', { who: 'cpu' }, () => { hcWho = 'cpu'; });
  renderOpponent();

  // 持ち時間：おすすめ（碁盤の大きさに合わせる）か、分数を選ぶ。上限も同じ時間
  const AUTO_MINUTES = { 19: 7, 13: 5, 9: 3 };
  const TIME_CHOICES = ['auto', 3, 5, 7, 10];
  let timeChoice = 'auto';
  try { const t = localStorage.getItem('destroy-go-time'); if (t && TIME_CHOICES.includes(t === 'auto' ? t : +t)) timeChoice = t === 'auto' ? t : +t; } catch (e) { /* 無視 */ }
  const minutes = () => (timeChoice === 'auto' ? AUTO_MINUTES[SIZE] : timeChoice);
  TIME_CHOICES.forEach((t) => {
    const chip = document.createElement('button');
    chip.className = 'chip rule-chip'; chip.dataset.time = t;
    chip.onclick = () => {
      timeChoice = t;
      try { localStorage.setItem('destroy-go-time', t); } catch (e) { /* 無視 */ }
      renderRules();
    };
    $('#time-chips').appendChild(chip);
  });

  // ルールの説明は「ノーマル」と「デストロイ」をタブで切り替えて見られる（選んでいる勝ち負けの決め方とは別に見られる）
  let ruleTab = null;
  function showRuleTab(tab) {
    ruleTab = tab;
    document.querySelectorAll('.rule-tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
    $('#rules-go').hidden = tab !== 'go';
    $('#rules-destroy').hidden = tab !== 'destroy';
  }
  document.querySelectorAll('.rule-tabs button').forEach((b) => { b.onclick = () => showRuleTab(b.dataset.tab); });
  function renderDestroyRules(start) {
    const c = DestroyRule.config(SIZE, dAdvanced);
    const bonus = hpBonus ? `（${NAMES[hpBonusColor]}はHPハンデで+${hpBonus * 100}%）` : '';
    const items = [
      `<b>${dAdvanced ? '上級' : '初級'}</b>：${SIZE}路盤・${start}・<b>HP${c.hp}</b>で勝負${c.white ? `（白は先手の差の分 +${c.white}）` : ''}${bonus}`,
      '相手の石を取ると相手のHPが減る：1〜3子は1子<b>2</b>、4〜6子は1子<b>3</b>、7子以上は1子<b>4</b>ダメージ',
      `<b>${c.crit}子以上</b>まとめて取ると<b>クリティカル</b>（${c.hp / 2}ダメージ）、<b>${c.ko}子以上</b>で<b>即KO</b>`,
      ...(dAdvanced ? [
        '倍率：ため撃ちMAX 1.5倍／背水（自分のHPが4分の1以下）1.2倍／<b>カウンター</b>（取りに来た石ごと取り返す）1.5倍／<b>コンボ</b>（続けて取る）2連続1.2倍〜／<b>ラストスパート</b>（盤の7割が埋まるか持ち時間1分以下）1.5倍。全部重なっても2.5倍まで',
        '<b>反動</b>：ため撃ちMAXで増えたダメージと同じだけ自分のHPも減る（HPは1で止まる。相手をKOしたら受けない）。とどめや、わざと背水に入りたいときに使う',
      ] : []),
      ...(dAdvanced ? ['2眼で取られなくなった石（<b>盾マーク</b>）4子ごとにHPが1回復。余りは最大HPを増やす（最初の2倍まで）'] : []),
      'HPが0で<b>KO負け</b>。2人連続パスで終局したら<b>地の総攻撃</b>：お互いに地1目につき相手に1ダメージを同時に与え、HPが0以下になったらKO。両方残ったら残りHPの多いほうの勝ち',
      dAdvanced ? '持ち時間・5秒ルール・演出はノーマルルールと同じ' : '持ち時間・5秒ルール・演出はノーマルルールと同じ。ため撃ちは演出だけ（ダメージは変わらない）',
      ...(dAdvanced ? [] : ['上級では、ため撃ち・背水・カウンター・コンボ・ラストスパートの倍率、反動、2眼の回復が加わる']),
    ];
    $('#rules-destroy').innerHTML = items.map((t) => `<li>${t}</li>`).join('');
    if (!ruleTab) showRuleTab(mode);
  }

  function renderRules() {
    document.querySelectorAll('#time-chips .chip').forEach((c) => {
      const t = c.dataset.time === 'auto' ? 'auto' : +c.dataset.time;
      c.setAttribute('aria-pressed', t === timeChoice);
      c.textContent = t === 'auto' ? `おすすめ（${AUTO_MINUTES[SIZE]}分）` : `${t}分`;
    });
    $('#time-line').innerHTML = `持ち時間 <b>${minutes()}分</b>（上限も${minutes()}分）`;
    document.querySelectorAll('#rule-chips .chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.key === rules));
    document.querySelectorAll('#size-chips .chip').forEach((c) => c.setAttribute('aria-pressed', +c.dataset.size === SIZE));
    const hc = effectiveHandicap();
    const start = hc ? `置き石${hc}子・白番から` : '黒番から';
    $('#rule-line').textContent = `${SIZE}路盤・${start}・${RULES[rules].label}（${RULE_DESC[rules]}）・コミ${hc ? 0.5 : RULES[rules].komi}目`;
    renderDestroyRules(start);
    renderOpponent();
  }
  // 今の設定を 1 行で（不具合の報告に入れる）
  function setupSummary() {
    const hc = effectiveHandicap();
    const parts = [mode === 'destroy' ? `デストロイ（${dAdvanced ? '上級' : '初級'}）` : 'ふつうの囲碁',
      opponent === 'cpu' ? `CPU Lv${cpuLevel}` : '2人', `${SIZE}路`, `${minutes()}分`];
    if (hc) parts.push(`置き石${hc}`);
    if (mode === 'destroy' && hpBonus) parts.push(`${NAMES[hpBonusColor]}HP+${hpBonus * 100}%`);
    parts.push(`黒:${themeOf(themes[BLACK]).label} 白:${themeOf(themes[WHITE]).label}`);
    return parts.join('・');
  }
  // 版番号と、不具合・感想の送り先（版・設定・端末を書き込んだ状態で開く）
  $('#version').textContent = ED.version ? `v${ED.version}${FREE ? '（無料版）' : ''}` : '';
  if (ED.feedback) {
    $('#feedback').onclick = (e) => {
      const body = [
        '## 内容', '（不具合なら、何をしたら・どうなったかを書いてください。感想も大歓迎です）', '', '',
        '## 環境（自動で入ります）',
        `- 版：${$('#version').textContent}`,
        `- 設定：${setupSummary()}`,
        `- 端末：${navigator.userAgent}`,
        `- 画面：${screen.width}×${screen.height}`,
      ].join('\n');
      e.currentTarget.href = `${ED.feedback}?title=${encodeURIComponent('【不具合・感想】')}&body=${encodeURIComponent(body)}`;
    };
  } else $('#feedback').hidden = true;
  Object.keys(RULES).forEach((key) => {
    const chip = document.createElement('button');
    chip.className = 'chip rule-chip'; chip.dataset.key = key;
    chip.textContent = `${RULES[key].label}（コミ${RULES[key].komi}）`;
    chip.onclick = () => {
      rules = key;
      try { localStorage.setItem('destroy-go-rules', key); } catch (e) { /* 無視 */ }
      renderRules();
    };
    $('#rule-chips').appendChild(chip);
  });

  try { const n = +localStorage.getItem('destroy-go-size'); if (BOARDS[n]) SIZE = n; } catch (e) { /* 無視 */ }
  Object.keys(BOARDS).sort((a, b) => b - a).forEach((n) => {
    const chip = document.createElement('button');
    chip.className = 'chip rule-chip'; chip.dataset.size = n;
    chip.textContent = `${n}路`;
    chip.onclick = () => {
      SIZE = +n;
      try { localStorage.setItem('destroy-go-size', n); } catch (e) { /* 無視 */ }
      renderRules();
    };
    $('#size-chips').appendChild(chip);
  });

  // 陣地ヒント：にじみ（勢力）とつながりの線
  const HINTS = { both: '両方', aura: 'にじみだけ', links: 'つながりだけ', none: 'なし' };
  let hintMode = 'both';
  try { const h = localStorage.getItem('destroy-go-hint'); if (HINTS[h]) hintMode = h; } catch (e) { /* 無視 */ }
  function renderHints() {
    document.querySelectorAll('#hint-chips .chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.key === hintMode));
  }
  Object.keys(HINTS).forEach((key) => {
    const chip = document.createElement('button');
    chip.className = 'chip rule-chip'; chip.dataset.key = key;
    chip.textContent = HINTS[key];
    chip.onclick = () => {
      hintMode = key;
      try { localStorage.setItem('destroy-go-hint', key); } catch (e) { /* 無視 */ }
      renderHints();
    };
    $('#hint-chips').appendChild(chip);
  });

  function setTheme(color, key) {
    themes[color] = key;
    try { localStorage.setItem('destroy-go-themes', JSON.stringify(themes)); } catch (e) { /* 無視 */ }
    renderThemes();
    if (game) draw();
  }

  function renderThemes() {
    document.querySelectorAll('.theme-row').forEach((row) => {
      const color = +row.dataset.color;
      row.querySelectorAll('.chip').forEach((chip) => {
        if (chip.classList.contains('locked')) return;
        const taken = chip.dataset.key === themes[otherColor(color)];
        chip.setAttribute('aria-pressed', chip.dataset.key === themes[color]);
        chip.classList.toggle('taken', taken);
        chip.title = taken ? `${NAMES[otherColor(color)]}が使用中（押すと入れ替え）` : '';
      });
    });
    for (const color of [BLACK, WHITE]) {
      const t = themeOf(themes[color]);
      const badge = $('#p' + color + ' .p-theme');
      badge.textContent = t.mark;
      badge.style.setProperty('--tc', t.color);
      badge.title = `演出：${t.label}（タップで切替）`;
    }
    $('#preview-label').textContent = `${NAMES[previewColor]}：${themeOf(themes[previewColor]).label}`;
  }

  // 演出の選択肢を作る（隠し要素を解放したら作り直す）
  function buildThemeChips() {
  document.querySelectorAll('.theme-row').forEach((row) => {
    const color = +row.dataset.color;
    const box = row.querySelector('.chips');
    box.textContent = '';
    FX.themes.forEach((t) => {
      const chip = document.createElement('button');
      chip.className = 'chip'; chip.dataset.key = t.key;
      chip.style.setProperty('--tc', t.color);
      chip.innerHTML = `<span class="mk"></span>`;
      chip.querySelector('.mk').textContent = t.mark;
      chip.appendChild(document.createTextNode(t.label));
      if (!unlocked(t.key)) { // 無料版では選べない（プレビューでは見られる）
        chip.classList.add('locked'); chip.title = '製品版（準備中）で使えます';
        chip.onclick = () => toast(`「${t.label}」は製品版（準備中）で使えます。演出プレビューで見られます`);
        box.appendChild(chip);
        return;
      }
      chip.onclick = () => {
        // 相手が使っている演出を選んだら、相手と入れ替える（黒と白で同じ演出は使えないため）
        if (themes[otherColor(color)] === t.key) themes[otherColor(color)] = themes[color];
        previewColor = color; setTheme(color, t.key);
      };
      box.appendChild(chip);
    });
  });
  }
  buildThemeChips();
  // ---------- BGM（音楽：魔王魂 https://maou.audio/ 商用利用可） ----------
  // 無料版は最初の 2 曲。ほかの曲は演出とは別の条件で解放される（when が条件）。製品版は全部
  const BGMS = [
    { key: 'medley02', label: 'メドレー', file: 'assets/bgm/maou_game_medley02.mp3' },
    { key: 'fantasy13', label: 'ファンタジー', file: 'assets/bgm/maou_bgm_fantasy13.mp3' },
    { key: 'fantasy15', label: '冒険', file: 'assets/bgm/maou_bgm_fantasy15.mp3', when: '対局を 10 回終えた' },
    { key: 'boss03', label: 'ボス戦', file: 'assets/bgm/maou_game_boss03.mp3', when: 'コンピューター Lv5 以上に勝った' },
    { key: 'lastboss01', label: 'ラスボス', file: 'assets/bgm/maou_game_lastboss01.mp3', when: 'デストロイルールでクリティカルを出した' },
    { key: 'random', label: 'ランダム' }, // 解放されている曲の中から、対局ごとに選ぶ
    { key: 'off', label: 'なし' },
  ];
  const bgmUnlocked = new Set();
  try { for (const k of JSON.parse(localStorage.getItem('destroy-go-bgm-unlocks') || '[]')) bgmUnlocked.add(k); } catch (e) { /* 無視 */ }
  const bgmOk = (b) => !FREE || !b.when || bgmUnlocked.has(b.key);
  function unlockBgm(key) {
    const b = BGMS.find((x) => x.key === key);
    if (!b || bgmOk(b)) return;
    bgmUnlocked.add(key);
    try { localStorage.setItem('destroy-go-bgm-unlocks', JSON.stringify([...bgmUnlocked])); } catch (e) { /* 無視 */ }
    buildBgmChips();
    const el = $('#unlock-pop');
    el.innerHTML = `<b>🎵 BGM「${b.label}」が解放された！</b><small>${b.when}。BGM の選択で使えるようになりました</small>`;
    el.style.setProperty('--tc', '#7fe3ff');
    el.className = ''; void el.offsetWidth; el.className = 'show';
    FX.heal();
  }
  let bgmKey = 'medley02';
  try { const k = localStorage.getItem('destroy-go-bgm'); const b = BGMS.find((x) => x.key === k); if (b && bgmOk(b)) bgmKey = k; } catch (e) { /* 無視 */ }
  const bgmAudio = new Audio();
  bgmAudio.loop = true; bgmAudio.preload = 'none';
  // 音量（0〜100）。効果音と BGM を別々に変えられる。BGM は控えめ（最初の 40 で 0.1、100 でも 0.25）
  // 目盛りを変えたら、保存する名前も変える（前の目盛りで保存した値は読まない）
  const vol = { se: 100, bgm: 40, seMute: false, bgmMute: false }; // seMute・bgmMute はそれぞれの消音
  try { Object.assign(vol, JSON.parse(localStorage.getItem('destroy-go-volume4') || '{}')); } catch (e) { /* 無視 */ }
  const saveVolume = () => { try { localStorage.setItem('destroy-go-volume4', JSON.stringify(vol)); } catch (e) { /* 無視 */ } };
  function applyVolume() {
    FX.setVolume(vol.se / 100); FX.setMuted(vol.seMute);
    bgmAudio.volume = 0.25 * vol.bgm / 100;
    if (vol.bgmMute) bgmAudio.pause();
    document.querySelectorAll('.vol-mute-se').forEach((b) => { b.textContent = vol.seMute ? '🔇' : '🔊'; b.setAttribute('aria-pressed', vol.seMute); });
    document.querySelectorAll('.vol-mute-bgm').forEach((b) => { b.textContent = vol.bgmMute ? '🔇' : '🔊'; b.setAttribute('aria-pressed', vol.bgmMute); });
    const all = vol.seMute && vol.bgmMute;
    $('#btn-mute').textContent = all ? '🔇' : '🔊';
    $('#vol-mute').textContent = all ? '🔊 音を全部出す' : '🔇 音を全部消す';
    document.querySelectorAll('.vol-se').forEach((r) => { r.value = vol.se; });
    document.querySelectorAll('.vol-bgm').forEach((r) => { r.value = vol.bgm; });
    document.querySelectorAll('.vol-num-se').forEach((n) => { n.textContent = vol.se; });
    document.querySelectorAll('.vol-num-bgm').forEach((n) => { n.textContent = vol.bgm; });
  }
  document.querySelectorAll('.vol-se, .vol-bgm').forEach((r) => {
    r.oninput = () => {
      vol[r.classList.contains('vol-se') ? 'se' : 'bgm'] = +r.value;
      saveVolume(); applyVolume();
    };
    if (r.classList.contains('vol-se')) r.onchange = () => FX.stoneClick(); // 離したときに試しに鳴らす
  });
  // 効果音・BGM それぞれの消音ボタン
  document.querySelectorAll('.vol-mute-se, .vol-mute-bgm').forEach((b) => {
    b.onclick = () => {
      const k = b.classList.contains('vol-mute-se') ? 'seMute' : 'bgmMute';
      vol[k] = !vol[k]; saveVolume(); applyVolume();
      if (k === 'bgmMute' && !vol.bgmMute && phase !== 'title') playBgm();
    };
  });
  applyVolume();
  let bgmPick = null; // ランダムのときに選んだ曲（対局ごとに選び直す）
  const bgmSongs = () => BGMS.filter((b) => b.file && bgmOk(b));
  function nowSong() {
    if (bgmKey !== 'random') return BGMS.find((x) => x.key === bgmKey);
    if (!bgmPick || !bgmOk(bgmPick)) { const list = bgmSongs(); bgmPick = list[Math.floor(Math.random() * list.length)]; }
    return bgmPick;
  }
  function playBgm() {
    const b = nowSong();
    renderNowPlaying();
    if (!b || !b.file || vol.bgmMute) { bgmAudio.pause(); return; }
    if (bgmAudio.dataset.key !== b.key) { bgmAudio.src = b.file; bgmAudio.dataset.key = b.key; }
    const r = bgmAudio.play(); if (r && r.catch) r.catch(() => {}); // 曲のファイルがない環境では鳴らさない
  }
  const stopBgm = () => bgmAudio.pause();
  function renderNowPlaying() {
    const b = bgmKey === 'off' ? null : nowSong();
    document.querySelectorAll('.bgm-now').forEach((el) => { el.textContent = b && b.file ? `♪ ${b.label}${bgmKey === 'random' ? '（ランダム）' : ''}` : ''; });
  }
  // BGM の選択肢。タイトルと、対局中の 🔊 の窓の両方に作る（どちらで選んでも同じ）
  function buildBgmChips() {
    document.querySelectorAll('.bgm-chips').forEach((box) => {
      box.textContent = '';
      for (const b of BGMS) {
        const chip = document.createElement('button');
        chip.className = 'chip rule-chip'; chip.dataset.bgm = b.key; chip.textContent = b.label;
        chip.setAttribute('aria-pressed', b.key === bgmKey);
        if (!bgmOk(b)) {
          chip.classList.add('locked'); chip.title = '製品版（準備中）で使えます';
          chip.onclick = () => toast(`BGM「${b.label}」は製品版（準備中）で使えます`);
        } else chip.onclick = () => { // 選ぶと試しに鳴らす（タイトルでも）。対局中ならそのまま切り替わる
          bgmKey = b.key; bgmPick = null;
          try { localStorage.setItem('destroy-go-bgm', b.key); } catch (e) { /* 無視 */ }
          buildBgmChips(); playBgm();
        };
        box.appendChild(chip);
      }
    });
    renderNowPlaying();
  }
  buildBgmChips();
  // 隠し要素の解放：その端末に記録して、演出の選択肢を作り直し、派手に知らせる
  function unlockSecret(key) {
    if (!FREE || unlocked(key)) return;
    secretUnlocked.add(key);
    try { localStorage.setItem('destroy-go-unlocks', JSON.stringify([...secretUnlocked])); } catch (e) { /* 無視 */ }
    buildThemeChips(); renderThemes();
    document.querySelectorAll('#pv-themes button').forEach((b) => { b.textContent = themeOf(b.dataset.key).label + (unlocked(b.dataset.key) ? '' : '🔒'); });
    const t = themeOf(key), el = $('#unlock-pop');
    el.innerHTML = `<b>🔓 「${t.label}」が解放された！</b><small>${SECRETS[key]}。演出の選択で使えるようになりました</small>`;
    el.style.setProperty('--tc', t.color);
    el.className = ''; void el.offsetWidth; el.className = 'show';
    FX.heal();
  }
  for (const color of [BLACK, WHITE]) {
    $('#p' + color + ' .p-theme').onclick = () => {
      // 相手が使っている演出は飛ばして次へ
      const keys = themeKeys();
      let i = keys.indexOf(themes[color]);
      do { i = (i + 1) % keys.length; } while (keys[i] === themes[otherColor(color)]);
      setTheme(color, keys[i]);
      toast(`${NAMES[color]}の演出：${themeOf(themes[color]).label}`);
    };
  }

  // ---------- レイアウト ----------
  // スマホのアプリの中で開いているか（埋め込まれていて、指で操作する端末）
  const EMBEDDED = window.self !== window.top && window.matchMedia('(pointer: coarse)').matches;
  if (EMBEDDED) document.documentElement.classList.add('embedded');
  function layout() {
    // 埋め込まれていると、ページの下のほうが画面の外にはみ出して作られる。見えている高さは
    // 画面の高さから、上のアプリの欄（約 100px）と一番下のホームバーの分（約 40px）を引いたくらい
    const vw = window.innerWidth, vh = EMBEDDED ? Math.min(window.innerHeight, screen.height - 140) : window.innerHeight;
    // 碁盤以外（タイトルへ戻る欄・プレイヤー欄・ボタン欄など）の実際の高さを測り、残りに碁盤が収まる大きさにする。
    // ボタン欄は碁盤の幅で折り返しが変わるので、2 回測って合わせる。画面が出ていないときは目安の高さを使う
    const others = () => {
      const kids = [...gameEl.children].filter((e) => e.id !== 'board-wrap' && getComputedStyle(e).display !== 'none');
      const cs = getComputedStyle(gameEl);
      return kids.reduce((h, e) => h + e.getBoundingClientRect().height, 0) + 8 * kids.length
        + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    };
    const fit = (other) => Math.floor(Math.max(200, Math.min(vw - 16, vh - other - 4, 900)));
    let size = fit(2 * 66 + 52 + 38 + 40 + (gameEl.classList.contains('previewing') ? 30 : 0));
    document.documentElement.style.setProperty('--board-size', size + 'px');
    if (gameEl.classList.contains('active')) {
      for (let k = 0; k < 2; k++) {
        size = fit(others());
        document.documentElement.style.setProperty('--board-size', size + 'px');
      }
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = size * dpr; canvas.height = size * dpr;
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = opt.coords.checked ? 1.3 : 0.8; // 盤の端の線から外枠までの幅（マス目の何倍か）
    const cell = size / (SIZE - 1 + pad * 2);
    geo = { css: size, cell, margin: cell * pad, size: SIZE };
    BoardFX.resize(size);
    draw();
  }
  window.addEventListener('resize', layout);

  const px = (i) => geo.margin + i * geo.cell;

  // ---------- 描画 ----------
  // アタリ（次の 1 手で取られる）の石に入れるひび。形は石の位置ごとに固定する
  function drawAtariCrack(i) {
    const [gx, gy] = game.xy(i), x = px(gx), y = px(gy), r = geo.cell * 0.48;
    let seed = (i + 1) * 2654435761 >>> 0;
    const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % 10000) / 10000; };
    g2.save();
    g2.beginPath(); g2.arc(x, y, r * 0.95, 0, Math.PI * 2); g2.clip();
    g2.strokeStyle = game.board[i] === BLACK ? 'rgba(235,235,235,0.8)' : 'rgba(60,45,30,0.85)';
    g2.lineWidth = Math.max(1, geo.cell * 0.04); g2.lineJoin = 'round'; g2.lineCap = 'round';
    const start = rand() * Math.PI * 2;
    for (let k = 0; k < 3; k++) {
      let a = start + (k * Math.PI * 2) / 3 + (rand() - 0.5) * 0.8, cx = x + (rand() - 0.5) * r * 0.2, cy = y + (rand() - 0.5) * r * 0.2;
      g2.beginPath(); g2.moveTo(cx, cy);
      for (let s = 0; s < 4; s++) {
        a += (rand() - 0.5) * 0.9;
        cx += Math.cos(a) * r * 0.3; cy += Math.sin(a) * r * 0.3;
        g2.lineTo(cx, cy);
      }
      g2.stroke();
    }
    g2.restore();
  }

  // ---------- 2 眼で取られない石 ----------
  const showShields = () => game && (phase === 'play' || phase === 'paused' || phase === 'over' || phase === 'replay') && (dstate || hintMode !== 'none');
  let aliveCache = { key: '', sets: null };
  function aliveSets() {
    const key = SIZE + ':' + game.board.join('');
    if (aliveCache.key !== key) aliveCache = { key, sets: { [BLACK]: DestroyRule.aliveStones(game.board, SIZE, BLACK), [WHITE]: DestroyRule.aliveStones(game.board, SIZE, WHITE) } };
    return aliveCache.sets;
  }
  // 石の右下に小さな盾（持ち主の演出の色）。石が小さい 19 路でも見えるよう、最小の大きさを決めておく
  function drawShield(x, y, color) {
    const c = geo.cell, s = Math.max(c * 0.24, 5), sx = x + c * 0.2, sy = y + c * 0.15;
    g2.save(); g2.translate(sx, sy);
    g2.beginPath(); g2.moveTo(0, -s); g2.lineTo(s * 0.85, -s * 0.6); g2.lineTo(s * 0.7, s * 0.35);
    g2.quadraticCurveTo(0, s * 1.1, 0, s * 1.1); g2.quadraticCurveTo(0, s * 1.1, -s * 0.7, s * 0.35); g2.lineTo(-s * 0.85, -s * 0.6); g2.closePath();
    { const t = themeOf(themes[color]); g2.fillStyle = t.shield || t.color; } g2.fill();
    g2.strokeStyle = '#fff'; g2.lineWidth = Math.max(1, s * 0.14); g2.stroke();
    g2.restore();
  }
  // 打ったあと、新しく 2 眼ができた色があれば「二眼完成！」を出す
  let prevAlive = { [BLACK]: new Set(), [WHITE]: new Set() };
  function checkNewEyes(delay) {
    if (!showShields()) { prevAlive = { [BLACK]: new Set(), [WHITE]: new Set() }; return; }
    const al = aliveSets();
    for (const c of [BLACK, WHITE]) {
      let fresh = 0;
      for (const i of al[c]) if (!prevAlive[c].has(i)) fresh++;
      if (fresh) later(() => {
        const el = $('#eyes');
        el.textContent = `${NAMES[c]} 二眼完成！`;
        { const t = themeOf(themes[c]); el.style.setProperty('--ec', t.shield || t.color); } // 盾マークと同じ色
        el.className = ''; void el.offsetWidth; el.className = 'show';
      }, delay);
    }
    prevAlive = { [BLACK]: new Set(al[BLACK]), [WHITE]: new Set(al[WHITE]) };
  }
  const resetEyes = () => { prevAlive = game && showShields() ? (() => { const al = aliveSets(); return { [BLACK]: new Set(al[BLACK]), [WHITE]: new Set(al[WHITE]) }; })() : { [BLACK]: new Set(), [WHITE]: new Set() }; };

  function drawStone(x, y, color, alpha = 1) {
    const r = geo.cell * 0.48;
    g2.globalAlpha = alpha;
    g2.fillStyle = 'rgba(0,0,0,0.3)';
    g2.beginPath(); g2.arc(x + r * 0.12, y + r * 0.15, r, 0, Math.PI * 2); g2.fill();
    const grd = g2.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    if (color === BLACK) { grd.addColorStop(0, '#6b6b6b'); grd.addColorStop(1, '#070707'); }
    else { grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, '#c9c3b6'); }
    g2.fillStyle = grd;
    g2.beginPath(); g2.arc(x, y, r, 0, Math.PI * 2); g2.fill();
    g2.globalAlpha = 1;
  }

  function draw() {
    if (!game || !geo.css) return;
    const S = geo.css, c = geo.cell;
    // 盤
    const wood = g2.createLinearGradient(0, 0, S, S);
    wood.addColorStop(0, '#e6c06e'); wood.addColorStop(0.5, '#d9ad57'); wood.addColorStop(1, '#c99a45');
    g2.fillStyle = wood; g2.fillRect(0, 0, S, S);

    g2.strokeStyle = '#3b2a10'; g2.lineWidth = Math.max(0.7, c / 26);
    g2.beginPath();
    for (let i = 0; i < SIZE; i++) {
      g2.moveTo(px(0), px(i)); g2.lineTo(px(SIZE - 1), px(i));
      g2.moveTo(px(i), px(0)); g2.lineTo(px(i), px(SIZE - 1));
    }
    g2.stroke();
    g2.lineWidth *= 2; g2.strokeRect(px(0), px(0), px(SIZE - 1) - px(0), px(SIZE - 1) - px(0));
    if (opt.coords.checked) {
      // 外枠から少し内側（端の石にかからない位置）に座標を書く
      const d = c * 0.42;
      g2.fillStyle = 'rgba(59,42,16,0.85)';
      g2.font = `700 ${Math.round(c * 0.34)}px system-ui, sans-serif`;
      g2.textAlign = 'center'; g2.textBaseline = 'middle';
      for (let i = 0; i < SIZE; i++) {
        g2.fillText(COLS[i], px(i), d); g2.fillText(COLS[i], px(i), S - d);
        g2.fillText(String(SIZE - i), d, px(i)); g2.fillText(String(SIZE - i), S - d, px(i));
      }
    }
    g2.fillStyle = '#3b2a10';
    for (const [a, b] of BOARDS[SIZE]) { g2.beginPath(); g2.arc(px(a), px(b), c * 0.12, 0, Math.PI * 2); g2.fill(); }

    // 計算モードでの地の表示
    let terr = null;
    if (phase === 'scoring') {
      const s = game.score(dead);
      terr = s.territory;
      $('#score-live').textContent = `　黒 ${s.black} ／ 白 ${s.white}`;
    } else if (terrGlow) terr = terrGlow.map.map((v) => (v === terrGlow.color ? v : EMPTY)); // 総攻撃中は攻撃する側の地だけ

    // 石
    for (let i = 0; i < game.board.length; i++) {
      const col = game.board[i];
      const [x, y] = game.xy(i);
      if (col !== EMPTY) {
        if (wiped.has(i)) continue;
        const isDead = dead.has(i);
        // ため撃ち中は、取られる石がカタカタ揺れる（段階が上がるほど大きく）
        const j = charge && charge.stones.has(i) ? c * [0.03, 0.06, 0.1, 0.14][charge.level] : 0;
        drawStone(px(x) + (j ? (Math.random() * 2 - 1) * j : 0), px(y) + (j ? (Math.random() * 2 - 1) * j : 0), col, isDead ? 0.35 : 1);
        if (isDead) {
          g2.strokeStyle = '#e0001b'; g2.lineWidth = 2; const d = c * 0.22;
          g2.beginPath(); g2.moveTo(px(x) - d, px(y) - d); g2.lineTo(px(x) + d, px(y) + d);
          g2.moveTo(px(x) + d, px(y) - d); g2.lineTo(px(x) - d, px(y) + d); g2.stroke();
        }
      }
      if (terr && (terr[i] === BLACK || terr[i] === WHITE) && (col === EMPTY || dead.has(i))) {
        const s = c * 0.32;
        g2.fillStyle = terr[i] === BLACK ? '#111' : '#fff';
        g2.fillRect(px(x) - s / 2, px(y) - s / 2, s, s);
      }
    }

    BoardFX.renderLayers({
      board: wiped.size ? game.board.map((v, i) => (wiped.has(i) ? EMPTY : v)) : game.board, size: SIZE, cell: geo.cell, margin: geo.margin,
      influence: () => game.influence(), links: () => game.hintLinks(),
      themes, hint: phase === 'scoring' || wiped.size ? 'none' : hintMode,
    });

    // 2 眼で取られない石に盾マーク（デストロイルールでは常に、ふつうの囲碁では陣地ヒントがオンのとき）
    if (showShields()) {
      const al = aliveSets();
      for (const c of [BLACK, WHITE]) for (const i of al[c]) { if (wiped.has(i)) continue; const [x, y] = game.xy(i); drawShield(px(x), px(y), c); }
    }
    // アタリの石にひび（陣地ヒントがオンのとき）
    if (hintMode !== 'none' && (phase === 'play' || phase === 'paused' || phase === 'preview')) {
      game.atariStones().forEach(drawAtariCrack);
    }

    // 最終手マーク
    if (game.lastMove >= 0) {
      const [x, y] = game.xy(game.lastMove);
      g2.fillStyle = '#ff2b2b';
      g2.beginPath(); g2.arc(px(x), px(y), c * 0.16, 0, Math.PI * 2); g2.fill();
    }

    // ため撃ち中：打とうとしている石と、ための進み具合（MAX までの円）
    if (charge && phase === 'play') {
      const [x, y] = game.xy(charge.p);
      drawStone(px(x), px(y), game.turn, 0.85);
      // ゲージはその手の上限で一周する。色は段階が上がるごとに黄→オレンジ、最後の段階（MAX 直前）は赤
      const last = charge.steps[charge.steps.length - 1], f = Math.min(1, (performance.now() - charge.t0) / last);
      const left = charge.steps.length - charge.level;
      g2.strokeStyle = left <= 1 ? (charge.level ? '#ff2b2b' : '#ffd23f') : ['#ffffff', '#ffd23f', '#ff8a1f'][charge.level]; g2.lineWidth = c * 0.12; g2.lineCap = 'round';
      g2.beginPath(); g2.arc(px(x), px(y), c * 0.68, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); g2.stroke();
      g2.lineCap = 'butt';
    }
    // 仮置き・ホバー
    if (phase === 'play' && !charge) {
      const p = pending >= 0 ? pending : hover;
      if (p >= 0 && game.board[p] === EMPTY) {
        const [x, y] = game.xy(p);
        drawStone(px(x), px(y), game.turn, pending >= 0 ? 0.75 : 0.4);
        if (pending >= 0) {
          g2.strokeStyle = '#ff2b2b'; g2.lineWidth = 2;
          g2.beginPath(); g2.arc(px(x), px(y), c * 0.55, 0, Math.PI * 2); g2.stroke();
        }
      }
    }
  }

  BoardFX.setStoneSource(() => {
    const out = [];
    if (game) for (let i = 0; i < game.board.length; i++) if (game.board[i] !== EMPTY) { const [x, y] = game.xy(i); out.push({ x: px(x), y: px(y), r: geo.cell * 0.48 }); }
    return out;
  });

  // ---------- 入力 ----------
  function pointAt(e) {
    const r = canvas.getBoundingClientRect();
    const k = geo.css / r.width;
    const x = Math.round(((e.clientX - r.left) * k - geo.margin) / geo.cell);
    const y = Math.round(((e.clientY - r.top) * k - geo.margin) / geo.cell);
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return -1;
    return game.idx(x, y);
  }

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || phase !== 'play') return;
    const p = pointAt(e);
    if (p !== hover) { hover = p; draw(); }
  });
  canvas.addEventListener('pointerleave', () => { hover = -1; draw(); });

  canvas.addEventListener('pointerdown', (e) => {
    FX.unlock();
    const p = pointAt(e);
    if (p < 0) return;
    if (phase === 'scoring') { toggleDead(p); return; }
    if (phase !== 'play' || performance.now() < lockUntil || isCpuTurn()) return;
    if (opt.confirm.checked && e.pointerType !== 'mouse' && p !== pending) {
      const r = game.tryPlay(p);
      if (!r.ok) { toast(r.reason); FX.blip(140, 0.12, 'sawtooth', 0.08); return; }
      pending = p; draw(); return;
    }
    pending = -1;
    // 相手の石が取れる手なら、長押しで「ため撃ち」できる（離したときに打つ）
    const t = game.tryPlay(p);
    if (t.ok && chargeSteps(t.captured.length).length) { startCharge(p, t.captured, e); return; }
    playAt(p);
  });

  // ---------- ため撃ち ----------
  // 取れる手を長押しすると、取られる石がカタカタ揺れて、離したときに勢いよく取れる。
  // 1 秒・3 秒・5 秒で段階が上がる。ためられる長さは取る石の数で決まり、上限（MAX）になったら自動で打つ。
  // ため中も自分の時計は進む。段階は盤上のゲージ（円）だけで見せ、文字は MAX の「DESTROY!!!」だけ出す
  //   1 子：ためなし（コウの取り合いなどでテンポを崩さない）／2〜3 子：1 秒／4〜11 子：3 秒／12 子〜：5 秒
  function chargeSteps(n) {
    if (n >= 12) return [1000, 3000, 5000];
    if (n >= 4) return [1000, 3000];
    if (n >= 2) return [1000];
    return [];
  }
  let charge = null; // { p, stones, steps, pointerId, t0, level, nextRattle }
  function startCharge(p, stones, e) {
    clearTimeout(releaseCharge.t); hideChargeLabel();
    charge = { p, stones: new Set(stones), steps: chargeSteps(stones.length), pointerId: e.pointerId, t0: performance.now(), level: 0, nextRattle: 0 };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 古いブラウザ */ }
    requestAnimationFrame(chargeLoop);
  }
  function startCpuCharge(p, stones, target) {
    clearTimeout(releaseCharge.t); hideChargeLabel();
    charge = { p, stones: new Set(stones), steps: chargeSteps(stones.length), pointerId: null, t0: performance.now(), level: 0, nextRattle: 0, cpu: true, target };
    requestAnimationFrame(chargeLoop);
  }
  function chargeLevel(ms) { let l = 0; charge.steps.forEach((s, i) => { if (ms >= s) l = i + 1; }); return l; }
  const chargeMax = (c) => c.level > 0 && c.level >= c.steps.length;
  function chargeLoop() {
    if (!charge) return;
    if (phase !== 'play') { cancelCharge(); return; }
    const now = performance.now(), ms = now - charge.t0, level = chargeLevel(ms);
    if (level > charge.level) {
      charge.level = level;
      FX.chargeUp(level);
      if (chargeMax(charge)) { showChargeLabel(); releaseCharge(); return; }
      if (charge.cpu && level >= charge.target) { releaseCharge(); return; } // コンピューターは決めた段階で打つ
    }
    // 1 秒を過ぎたら石がカタカタ鳴り始める（段階が上がるほど速く）
    if (ms > 250 && now >= charge.nextRattle) { FX.rattle(charge.level); charge.nextRattle = now + [140, 100, 70, 50][charge.level]; }
    draw();
    requestAnimationFrame(chargeLoop);
  }
  function showChargeLabel() {
    const el = $('#charge');
    el.textContent = 'DESTROY!!!';
    el.className = ''; void el.offsetWidth;
    el.className = 'show';
  }
  function hideChargeLabel() { $('#charge').className = ''; }
  function releaseCharge() {
    if (!charge) return;
    const { p, level } = charge, max = chargeMax(charge);
    charge = null;
    // MAX の「DESTROY!!!」は打ったあとも少し残す
    if (max) { clearTimeout(releaseCharge.t); releaseCharge.t = setTimeout(hideChargeLabel, 1000); } else hideChargeLabel();
    // MAX まで溜めきったら、短いためでも一段強く飛ばす
    if (phase === 'play') playAt(p, Math.min(3, max ? level + 1 : level), max);
  }
  function cancelCharge() {
    if (!charge) return;
    charge = null; hideChargeLabel();
    draw();
  }
  canvas.addEventListener('pointerup', (e) => { if (charge && e.pointerId === charge.pointerId) releaseCharge(); });
  canvas.addEventListener('pointercancel', (e) => { if (charge && e.pointerId === charge.pointerId) { cancelCharge(); toast('ため撃ちをやめました'); } });
  // 指を盤の外までずらすとキャンセル
  canvas.addEventListener('pointermove', (e) => {
    if (!charge || e.pointerId !== charge.pointerId) return;
    const r = canvas.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { cancelCharge(); toast('ため撃ちをやめました'); }
  });

  function stoneScreenPos(i) {
    const r = canvas.getBoundingClientRect();
    const k = r.width / geo.css;
    const [x, y] = game.xy(i);
    return { x: r.left + px(x) * k, y: r.top + px(y) * k };
  }

  function playAt(i, chargeLv = 0, maxCharge = false) {
    const mover = game.turn;
    const [x, y] = game.xy(i);
    const before = dstate ? dstate.snapshot() : null;
    const r = game.play(x, y);
    if (!r.ok) { toast(r.reason); FX.blip(140, 0.12, 'sawtooth', 0.08); return; }
    if (dstate) ruleHist.push(before);
    FX.stoneClick();
    let hold = 0;
    if (r.captured.length) {
      const k = canvas.getBoundingClientRect().width / geo.css;
      hold = FX.capture(r.captured.map(stoneScreenPos), mover === BLACK ? WHITE : BLACK, geo.cell * 0.96 * k, themes[mover], chargeLv);
      const onBoard = r.captured.map((c) => { const [cx, cy] = game.xy(c); return { x: px(cx), y: px(cy) }; });
      BoardFX.apply(themes[mover], FX.tierIndex(r.captured.length), onBoard, geo);
      if (opt.trace.checked) BoardFX.addTrace(themes[mover], FX.tierIndex(r.captured.length), onBoard, geo, mover, game.moveNumber);
    }
    if (dstate) destroyAfterMove(mover, r.captured, i, maxCharge, hold);
    if (kifu) kifu.moves.push({ p: i, c: chargeLv, x: maxCharge ? 1 : 0, s: dstate && dstate.lastSpurt ? 1 : 0, t: themes[mover] });
    if (r.captured.length >= 20 && !(cpuSide && mover === cpuSide)) later(() => unlockSecret('dark'), hold); // 隠し要素
    if (dstate && dstate.lastHit === 'critical' && !(cpuSide && mover === cpuSide)) later(() => unlockBgm('lastboss01'), hold + 4500);
    checkNewEyes(Math.min(hold, 900) + 200);
    finishTurn(mover, hold);
  }

  // ---------- デストロイルール（HP バトル） ----------
  let dstate = null, ruleHist = [];
  function popDamage(color, text, cls, tags = []) {
    const el = document.createElement('div');
    el.className = 'dmg-pop ' + cls;
    // 倍率の名前（COUNTER!! など）を小さく上に並べる
    for (const t of tags) { const s = document.createElement('span'); s.className = 'tag'; s.textContent = t; el.appendChild(s); }
    el.appendChild(document.createTextNode(text));
    $('#p' + color).appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }
  // 盤の真ん中に、付いた倍率（COUNTER!! など）を大きく、ダメージの計算式をその下に出す
  // 例：5子×3 ×1.5（ため撃ち）×1.5（カウンター）＝ 34
  const fmtMult = (m) => String(Math.round(m * 100) / 100);
  function showFormula(victim, h, n) {
    const el = $('#dmg-formula');
    let html;
    if (h.kind === 'ko') html = `<div class="f-tags">即 K.O.!!</div><div class="f-calc">${n}子 まとめて取ったので一撃</div>`;
    else {
      const head = h.per ? `${n}子×${h.per}` : `クリティカル ${h.base}`;
      const mults = h.parts.map((p) => ` ×${fmtMult(p.mult)}<small>（${p.name}）</small>`).join('');
      const cap = h.capped ? ` <small>→ 倍率は${DestroyRule.MAX_MULT}倍まで</small>` : '';
      html = (h.tags.length ? `<div class="f-tags">${h.tags.join('　')}</div>` : '')
        + `<div class="f-calc">${head}${mults}${cap} ＝ <b>${h.amount}</b></div>`
        + `<div class="f-dmg">${NAMES[victim]}に ${h.amount} ダメージ</div>`;
    }
    el.innerHTML = html; el._t = performance.now();
    const r = canvas.getBoundingClientRect(); // 盤の真ん中より少し下
    el.style.left = (r.left + r.width / 2) + 'px'; el.style.top = (r.top + r.height * (h.recoil > 0 ? 0.4 : 0.58)) + 'px'; // 反動も出すときは、下にはみ出さないよう上から
    el.className = ''; void el.offsetWidth; el.className = 'show';
  }
  // ---------- ダメージの履歴（デストロイルール） ----------
  // { move: 何手目, color: 誰に起きたか, kind: 'dmg' | 'crit' | 'ko' | 'recoil' | 'heal' | 'final', text }
  let dlog = [];
  const calcText = (h, n) => (h.per ? `${n}子×${h.per}` : `クリティカル ${h.base}`)
    + h.parts.map((p) => ` ×${fmtMult(p.mult)}（${p.name}）`).join('') + (h.capped ? ` → ${DestroyRule.MAX_MULT}倍まで` : '') + ` ＝ ${h.amount}`;
  function logDamage(entry) { dlog.push({ move: game.moveNumber, ...entry }); if (!$('#log-pop').hidden) renderLog(); }
  function renderLog() {
    const list = $('#log-list');
    if (!dlog.length) { list.innerHTML = '<li class="log-empty">まだダメージは起きていません</li>'; return; }
    list.innerHTML = dlog.slice().reverse().map((e) => `<li class="log-${e.kind}"><span class="log-move">${e.move}手目</span>`
      + `<i class="p-stone ${e.color === BLACK ? 'black' : 'white'}"></i><span class="log-text">${e.text}</span></li>`).join('');
  }
  // ---------- ？ ルール：対局中もいつでも見られる。ノーマル・初級・上級と、碁盤（9・13・19 路）をタブで切り替える ----------
  const rp = { tab: 'go', size: 19 };
  function renderRulesPop() {
    const tabs = [['go', 'ノーマル'], ['basic', 'デストロイ初級'], ['adv', 'デストロイ上級']]
      .map(([k, l]) => `<button data-rp-tab="${k}" aria-selected="${rp.tab === k}">${l}</button>`).join('');
    let html = `<div class="rp-tabs">${tabs}</div>`;
    if (rp.tab === 'go') {
      html += `<ul class="rp-list">${$('#rules-go').innerHTML}</ul>`;
    } else {
      const adv = rp.tab === 'adv', n = rp.size, c = DestroyRule.config(n, adv);
      html += `<div class="rp-tabs rp-sizes">${[9, 13, 19].map((z) => `<button data-rp-size="${z}" aria-selected="${n === z}">${z}路</button>`).join('')}</div>`;
      const rows = [
        ['最初の HP', `${c.hp}${c.white ? `（白は +${c.white}）` : ''}`],
        ['1子あたりのダメージ', '1〜3子 2／4〜6子 3／7子〜 4'],
        ['クリティカル', `${c.crit}子以上 → ${c.hp / 2} ダメージ`],
        ['即 KO', `${c.ko}子以上まとめて取る`],
        ...(adv ? [['背水になる HP', `${Math.floor(c.hp / 4)} 以下（最大 HP の 4 分の 1）`]] : []),
      ];
      html += `<table class="rp-table">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
      html += `<ul class="rp-list">
        <li>相手の石を取ると、相手の HP が減る。まとめて取るほど 1子あたりのダメージが大きい</li>
        <li>HP が 0 になったら <b>KO 負け</b></li>
        <li>2人がパスしたら<b>地の総攻撃</b>：お互いに地 1目につき相手に 1 ダメージを同時に与え、HP が 0 以下なら KO。両方残ったら残り HP の多いほうの勝ち</li>
        <li>${adv ? 'ため撃ち MAX はダメージ 1.5 倍（反動あり。下を見てね）' : 'ため撃ちは演出だけ（ダメージは変わらない）'}</li>
        <li>持ち時間・5秒ルールはノーマルと同じ</li></ul>`;
      if (adv) {
        const fx = [
          ['ため撃ち', '×1.5', '石が取れる手を長押しして、ゲージを MAX まで溜めてから離すとダメージが 1.5 倍。', '例：5子取り 15 → 23'],
          ['反動', '自分にも', 'ため撃ち MAX で増えた分だけ、自分の HP も減る。HP は 1 で止まり、相手を KO したときは受けない。溜めて得するのは、とどめを刺すときや、わざと背水に入るとき。', '例：6（ため撃ち）− 4（溜めない）＝ 自分に 2'],
          ['背水', '×1.2', `自分の HP が最大 HP の 4 分の 1 以下のとき、攻撃が 1.2 倍。HP バーが赤く光る（${n}路なら HP ${Math.floor(c.hp / 4)} 以下）。`, ''],
          ['カウンター', '×1.5', '相手に石を取られた直後に、その取りに来た石ごと取り返すと 1.5 倍（うってがえしなど）。別の場所の石を取り返すだけではならない。', ''],
          ['コンボ', '×1.2〜2', '自分の手番で続けて石を取ると、2 連続 1.2 倍・3 連続 1.4 倍…と上がる（2 倍まで）。取れなかった手やパスで途切れる。', ''],
          ['ラストスパート', '×1.5', '盤の 7 割が石で埋まるか、打つ側の持ち時間が 1 分以下になると 1.5 倍。最初に入ったとき「LAST SPURT!!」と出る。', ''],
          ['倍率の上限', '2.5倍まで', 'いくつ重なっても、全部掛け合わせて 2.5 倍まで。', '例：ため撃ち×カウンター×ラストスパート＝3.375 → 2.5倍'],
          ['2眼で回復', '+1', '2 眼ができて取られなくなった石（盾マーク）4子ごとに HP が 1 回復。最大 HP を超えたら最大 HP も増える（最初の 2 倍まで）。', ''],
        ];
        html += '<h3>上級で加わる効果</h3>' + fx.map(([k, m, d, ex]) => `<div class="rp-card"><div class="rp-name">${k}<span>${m}</span></div><p>${d}</p>${ex ? `<p class="rp-ex">${ex}</p>` : ''}</div>`).join('');
      } else html += '<p class="rp-note">上級では、ため撃ち・反動・背水・カウンター・コンボ・ラストスパート・2眼の回復が加わる（HP も多い）。</p>';
    }
    $('#rules-body').innerHTML = html;
    $('#rules-body').querySelectorAll('[data-rp-tab]').forEach((b) => { b.onclick = () => { rp.tab = b.dataset.rpTab; renderRulesPop(); }; });
    $('#rules-body').querySelectorAll('[data-rp-size]').forEach((b) => { b.onclick = () => { rp.size = +b.dataset.rpSize; renderRulesPop(); }; });
  }
  $('#btn-rules').onclick = (e) => {
    e.stopPropagation();
    if ($('#rules-pop').hidden) { rp.tab = dstate ? (dstate.advanced ? 'adv' : 'basic') : 'go'; rp.size = SIZE; } // 開くときは今の対局に合わせる
    renderRulesPop(); $('#rules-pop').hidden = !$('#rules-pop').hidden; $('#log-pop').hidden = true; };
  $('#rules-close').onclick = () => { $('#rules-pop').hidden = true; };
  $('#btn-log').onclick = (e) => { e.stopPropagation(); renderLog(); $('#log-pop').hidden = !$('#log-pop').hidden; $('#rules-pop').hidden = true; };
  $('#log-close').onclick = () => { $('#log-pop').hidden = true; };
  // 2 眼の回復も、盤の真ん中に大きく（取られない石 4 子ごとに HP 1）
  function showHealFormula(c, gain) {
    const el = $('#dmg-formula'), r = canvas.getBoundingClientRect();
    const body = `<div class="f-tags">回復！</div>`
      + `<div class="f-calc">取られない石（盾マーク）${gain * DestroyRule.HEAL_STONES}子 ÷ ${DestroyRule.HEAL_STONES} ＝ <b>+${gain}</b></div>`
      + `<div class="f-dmg">${NAMES[c]}の HP が ${gain} 回復</div>`;
    if (el.className.startsWith('show') && performance.now() - (el._t || 0) < 2300) { // ダメージの計算式が出ている最中なら、その下に足す
      el.insertAdjacentHTML('beforeend', `<div class="f-recoil f-heal">${body}</div>`);
      el.className = ''; void el.offsetWidth; el.className = 'show again';
      return;
    }
    el.innerHTML = body; el._t = performance.now();
    el.style.left = (r.left + r.width / 2) + 'px'; el.style.top = (r.top + r.height * 0.5) + 'px';
    el.className = ''; void el.offsetWidth; el.className = 'show heal';
  }
  // 反動：ダメージの計算式の下に、同じ見た目で足す（例：6（ため撃ち）− 4（溜めない）＝ 2）
  function showRecoilFormula(mover, h) {
    const el = $('#dmg-formula'), full = h.amount - h.plain;
    const stop = h.recoil < full ? `<small>（HPは1で止まる）</small>` : '';
    el.insertAdjacentHTML('beforeend', `<div class="f-recoil"><div class="f-tags">反動</div>`
      + `<div class="f-calc">${h.amount}<small>（ため撃ち）</small> − ${h.plain}<small>（溜めない）</small> ＝ <b>${full}</b></div>`
      + `<div class="f-dmg">${NAMES[mover]}に ${h.recoil} ダメージ${stop}</div></div>`);
    el.className = ''; void el.offsetWidth; el.className = 'show again'; // 表示を延ばす
  }
  // carryFull: その色の「あと何子で回復」の 4 つを、回復の瞬間だけ全部光らせる
  // unpaid: まだ見せていない反動 { [色]: 量 }（その分を足して表示する）
  function renderHp(carryFull = 0, unpaid = {}) {
    for (const c of [BLACK, WHITE]) {
      const box = $('#p' + c + ' .p-hp');
      box.hidden = !dstate;
      if (!dstate) continue;
      const carry = box.querySelector('.hp-carry');
      carry.hidden = !dstate.advanced; // 回復は上級版だけ
      carry.classList.toggle('full', carryFull === c);
      carry.querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', carryFull === c || k < dstate.carry[c]));
      const hp = dstate.hp[c] + (unpaid[c] || 0);
      box.querySelector('.hp-fill').style.width = (100 * hp / dstate.max[c]) + '%';
      box.querySelector('.hp-num').textContent = `HP ${hp}/${dstate.max[c]}`;
      box.classList.toggle('low', dstate.advanced && hp <= dstate.max[c] / 4);
    }
  }
  // 石を取ったらダメージ、2 眼で取られなくなった石が増えたら回復。HP が 0 なら演出が終わってから KO
  let spurtShown = false;
  // ラストスパート：盤の 7 割が石で埋まるか、打つ側の持ち時間が 1 分以下
  function isSpurt(mover) {
    if (!dstate || !dstate.advanced) return false;
    let stones = 0; for (const v of game.board) if (v) stones++;
    return stones >= SIZE * SIZE * DestroyRule.SPURT_FILL || clock.remaining(mover) <= DestroyRule.SPURT_TIME;
  }
  function destroyAfterMove(mover, capturedStones, point, maxCharge, hold) {
    const captured = capturedStones.length;
    const spurt = isSpurt(mover);
    if (spurt && !spurtShown) { // 最初にラストスパートに入ったときに知らせる
      spurtShown = true;
      later(() => showBigNote('LAST SPURT!! ダメージ1.5倍', '#ff3b3b'), Math.min(hold, 900) + 1200);
    }
    const h = dstate.hit(mover, captured, { maxCharge, spurt, point, stones: capturedStones }); // 取れなかった手も記録する（コンボ・カウンターのため）
    dstate.lastSpurt = spurt; // 棋譜に残す（再生で同じダメージにするため）
    dstate.lastHit = h.kind; // BGM の解放（クリティカル）に使う
    if (captured) {
      const victim = otherColor(mover);
      if (h.kind === 'ko') logDamage({ color: victim, kind: 'ko', text: `${NAMES[mover]}が ${captured}子 まとめて取って 即 K.O.!!` });
      else logDamage({ color: victim, kind: h.kind === 'critical' ? 'crit' : 'dmg',
        text: `${NAMES[mover]}が ${captured}子取り → ${NAMES[victim]} <b>-${h.amount}</b>${h.tags.length ? `（${h.tags.join('・')}）` : ''}<small>${calcText(h, captured)}</small>` });
      if (h.recoil > 0) logDamage({ color: mover, kind: 'recoil', text: `反動 → ${NAMES[mover]} <b>-${h.recoil}</b><small>${h.amount}（ため撃ち）− ${h.plain}（溜めない）</small>` });
      later(() => {
        if (h.kind === 'ko') popDamage(victim, 'K.O.!!', 'ko');
        else popDamage(victim, `${h.kind === 'critical' ? 'CRITICAL!! ' : ''}-${h.amount}`, h.kind, h.tags);
        showFormula(victim, h, captured);
        renderHp(0, { [mover]: h.recoil || 0 });
      }, Math.min(hold, 900));
      // 反動は、相手へのダメージが出てから自分の側に出す（HP はそのとき減らして見せる）
      if (h.recoil > 0) later(() => {
        popDamage(mover, `反動 -${h.recoil}`, 'recoil');
        showRecoilFormula(mover, h);
        renderHp();
        const box = $('#p' + mover + ' .p-hp');
        box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
      }, Math.min(hold, 900) + 450);
    }
    const healed = dstate.heal(game.board);
    // 回復は「二眼完成！」（+200ms）より少し遅らせて、表示と音が重ならないようにする
    for (const c of [BLACK, WHITE]) if (healed[c]) logDamage({ color: c, kind: 'heal', text: `2眼で回復 → ${NAMES[c]} <b>+${healed[c]}</b>` });
    for (const c of [BLACK, WHITE]) if (healed[c]) later(() => {
      popDamage(c, `+${healed[c]}`, 'heal'); FX.heal();
      showHealFormula(c, healed[c]);
      renderHp(c); // 4 つそろって光ってから、残りの端数の表示に戻す
      later(() => renderHp(), 600);
    }, Math.min(hold, 900) + 650);
    if (!captured) renderHp();
    if (dstate.ko) {
      const loser = dstate.ko, winner = otherColor(loser);
      lockUntil = Infinity; cpuToken++;
      later(() => endGame(`K.O.!! ${NAMES[winner]}の勝ち`, `${NAMES[loser]}のHPが0になりました`, winner), hold + 900);
    }
  }
  // 演出に合わせて少し遅らせる（タイトルに戻ったら出さない）
  function later(fn, ms) { const g = gameSerial; setTimeout(() => { if (g === gameSerial && phase !== 'title') fn(); }, ms); }
  let gameSerial = 0;
  // パスで終局したとき：デストロイルールなら「地の総攻撃」。地 1 目につき相手に 1 ダメージを同時に与える。
  // 計算は同時だが、見せるのは地の少ないほうから（逆転があるかどうかを最後まで引っぱる）。同じなら地で計算
  // 地は、死に石をコンピューターに推定させてから数える
  function endByPasses() {
    if (!dstate) { enterScoring(); return; }
    phase = 'over'; clock.stop();
    const serial = gameSerial;
    askAI({ type: 'dead', state: aiState() }).then((r) => {
      if (serial !== gameSerial) return;
      const sc = game.score(new Set(r.dead));
      const terr = { [BLACK]: sc.detail[BLACK].territory, [WHITE]: sc.detail[WHITE].territory };
      const hp0 = { ...dstate.hp };
      const { left, winner: w, ko } = dstate.finalAttack(terr);
      if (!w) { phase = 'play'; toast('同点なので地で勝負を決めます'); enterScoring(); return; }
      const order = terr[BLACK] <= terr[WHITE] ? [BLACK, WHITE] : [WHITE, BLACK];
      for (const c of order) logDamage({ color: otherColor(c), kind: 'final', text: `地の総攻撃：${NAMES[c]}の地 ${terr[c]}目 → ${NAMES[otherColor(c)]} <b>-${terr[c]}</b>` });
      showBigNote('地の総攻撃！', '#ffd23f');
      // 攻撃する側の地が光ってから、地の点が光の弾になって相手の HP バーに降り注ぐ
      const STEP = 2300;
      order.forEach((c, k) => later(() => {
        const victim = otherColor(c);
        terrGlow = { map: sc.territory, color: c }; draw();
        later(() => {
          const pts = [];
          for (let i = 0; i < sc.territory.length; i++) if (sc.territory[i] === c) pts.push(stoneScreenPos(i));
          const bar = $('#p' + victim + ' .p-hp').getBoundingClientRect();
          const ms = FX.volley(pts, { x: bar.left + bar.width * 0.3, y: bar.top + bar.height / 2 }, themes[c]);
          terrGlow = null; draw();
          later(() => {
            popDamage(victim, `地${terr[c]}目 -${terr[c]}`, terr[c] ? 'critical' : 'normal');
            dstate.hp[victim] = Math.max(0, left[victim]);
            renderHp(); FX.boom(0.3 + Math.min(0.5, terr[c] / 60));
            const box = $('#p' + victim + ' .p-hp');
            box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
          }, Math.max(600, ms - 200));
        }, 500);
      }, 1200 + k * STEP));
      later(() => {
        terrGlow = null; draw();
        const line = (c) => `${NAMES[c]} HP ${hp0[c]} − ${NAMES[otherColor(c)]}の地 ${terr[otherColor(c)]}目 ＝ ${left[c]}`;
        const body = `${line(BLACK)}\n${line(WHITE)}`;
        if (ko) {
          showBigNote('K.O.!!', '#ff3b3b');
          later(() => endGame(`K.O.!! ${NAMES[w]}の勝ち`, `地の総攻撃で${NAMES[ko]}のHPが0になりました\n${body}`, w), 900);
        } else endGame(`${NAMES[w]}の判定勝ち`, `地の総攻撃のあと、残りHPが多いほうの勝ち\n${body}`, w);
      }, 1200 + 2 * STEP + 300);
    });
  }
  function showBigNote(text, color) {
    const el = $('#eyes');
    el.textContent = text; el.style.setProperty('--ec', color);
    el.className = ''; void el.offsetWidth; el.className = 'show';
  }

  // 演出が画面に残っている間は、次の手番の時計を止めて盤も触れないようにする（最大 FX_HOLD_MAX まで）
  const FX_HOLD_MAX = 10000;
  let fxHoldStart = 0;
  function finishTurn(mover, hold = 0) {
    const delta = clock.endTurn(game.turn, hold);
    lockUntil = performance.now() + hold;
    fxHoldStart = hold > 0 ? performance.now() : 0;
    showDelta(mover, delta);
    hover = -1; pending = -1;
    disarmResign();
    updatePanels(); draw();
    maybeCpuTurn();
  }

  // ---------- コンピューター ----------
  // 考える計算は別のスレッドで行う（画面や演出が止まらないように）。使えない環境ではその場で計算する
  let cpuSide = 0, cpuLevelInGame = 3, cpuToken = 0, aiSeq = 0, cpuLow = 0, cpuResignInGame = true;
  const aiWorker = GoAI.createWorker(), aiWaiting = new Map();
  if (aiWorker) aiWorker.onmessage = (e) => { const f = aiWaiting.get(e.data.id); aiWaiting.delete(e.data.id); if (f) f(e.data); };
  function askAI(msg) {
    return new Promise((resolve) => {
      const id = ++aiSeq;
      if (aiWorker) { aiWaiting.set(id, resolve); aiWorker.postMessage({ ...msg, id }); return; }
      setTimeout(() => resolve(msg.type === 'dead' ? { dead: GoAI.estimateDead(msg.state) } : GoAI.chooseMove(msg.state, msg.level)), 30);
    });
  }
  const aiState = () => ({ size: SIZE, board: Array.from(game.board), turn: game.turn, ko: game.koPoint, komi: game.komi, opponentPassed: game.passes > 0 });
  const isCpuTurn = () => cpuSide && phase === 'play' && game && game.turn === cpuSide;
  function setThinking(on) { for (const c of [BLACK, WHITE]) $('#p' + c).classList.toggle('thinking', on && c === cpuSide); }
  function renderNames() {
    for (const c of [BLACK, WHITE]) {
      const who = !cpuSide ? '' : c === cpuSide ? `（CPU Lv${cpuLevelInGame}）` : '（あなた）';
      $('#p' + c + ' .p-name').firstChild.nodeValue = NAMES[c] + who + ' ';
    }
  }
  // コンピューターの手番なら考えて打つ。演出が終わるまで待ち、最低 0.6 秒は考えているように見せる
  function maybeCpuTurn() {
    if (!isCpuTurn()) return;
    const token = ++cpuToken;
    const step = () => {
      if (token !== cpuToken || !isCpuTurn()) { setThinking(false); return; }
      if (performance.now() < lockUntil || charge) { setTimeout(step, 100); return; }
      setThinking(true);
      const t0 = performance.now();
      askAI({ type: 'move', state: aiState(), level: cpuLevelInGame }).then((r) => {
        setTimeout(() => {
          setThinking(false);
          if (token !== cpuToken || !isCpuTurn()) return;
          // 勝ちやすさがほぼゼロの見積もりが 2 手続いたら投了する（序盤は見積もりがぶれるので、盤の 4 分の 1 が埋まるまでは投了しない）
          cpuLow = r.rate < 0.05 && game.moveNumber > SIZE * SIZE / 4 ? cpuLow + 1 : 0;
          if (cpuResignInGame && !dstate && cpuLow >= 2) { // 「投了しない」設定や、デストロイルール（HP で勝負が決まる）なら最後まで打つ
            endGame(`${NAMES[otherColor(cpuSide)]}（あなた）の中押し勝ち`, `${NAMES[cpuSide]}（CPU Lv${cpuLevelInGame}）が投了しました`, otherColor(cpuSide));
            return;
          }
          cpuPlay(r.move);
        }, Math.max(0, 600 - (performance.now() - t0)));
      });
    };
    step();
  }
  // ため撃ち MAX なら相手を KO できて、溜めないと KO できない取りか
  function cpuFinishes(stones) {
    const me = game.turn, foe = otherColor(me), l = dstate.last, n = stones.length;
    const opts = { desperate: dstate.desperate(me), combo: dstate.combo[me] + 1, spurt: isSpurt(me),
      counter: !!l && l.mover === foe && l.captured > 0 && stones.includes(l.point) };
    const hp = dstate.hp[foe];
    return DestroyRule.damage(n, SIZE, opts).amount < hp && DestroyRule.damage(n, SIZE, { ...opts, maxCharge: true }).amount >= hp;
  }
  function cpuPlay(move) {
    const t = move >= 0 ? game.tryPlay(move) : null;
    if (!t || !t.ok) { // パス
      const mover = game.turn;
      if (dstate) { ruleHist.push(dstate.snapshot()); dstate.pass(mover); }
      const r = game.pass(); if (kifu) kifu.moves.push({ p: -1 });
      toast(`${NAMES[mover]}（CPU）がパスしました`);
      finishTurn(mover);
      if (r.ended) endByPasses();
      return;
    }
    // 取れる手ならため撃ちで煽る（強いほど長くためる。レベル 1〜3 はためない）
    const steps = chargeSteps(t.captured.length);
    let target = cpuLevelInGame <= 3 ? 0 : cpuLevelInGame <= 6 ? 1 : steps.length;
    // デストロイルールでは MAX に反動があるので、MAX まで溜めるのはとどめを刺せるとき（Lv7〜9）だけ
    if (dstate && dstate.advanced && target >= steps.length && !(cpuLevelInGame >= 7 && cpuFinishes(t.captured))) target = steps.length - 1;
    if (steps.length && target > 0) startCpuCharge(move, t.captured, Math.min(target, steps.length));
    else playAt(move);
  }

  // ---------- ボタン ----------
  $('#btn-pass').onclick = () => {
    if (phase !== 'play' || performance.now() < lockUntil || isCpuTurn()) return;
    cancelCharge();
    const mover = game.turn;
    if (dstate) { ruleHist.push(dstate.snapshot()); dstate.pass(mover); }
    const r = game.pass(); if (kifu) kifu.moves.push({ p: -1 });
    toast(`${NAMES[mover]}がパスしました`);
    finishTurn(mover);
    if (r.ended) endByPasses();
  };

  function undoOne() {
    game.undo(); if (kifu) kifu.moves.pop(); if (dstate && ruleHist.length) dstate.restore(ruleHist.pop());
    dlog = dlog.filter((e) => e.move <= game.moveNumber); // 待ったした手の履歴も消す
  }
  $('#btn-undo').onclick = () => {
    if (phase !== 'play' || !game.history.length) return;
    cancelCharge();
    if (cpuSide) {
      // コンピューター戦：考え中ならやめて自分の手だけ戻す。自分の手番なら、コンピューターの手と自分の手を戻す
      cpuToken++; setThinking(false); cpuLow = 0;
      const back = game.turn === cpuSide ? 1 : 2;
      if (game.history.length < back) { toast('これ以上は戻せません'); return; }
      for (let i = 1; i < back; i++) undoOne();
    }
    undoOne();
    renderHp(); resetEyes();
    BoardFX.clear();
    BoardFX.dropTraces(game.moveNumber);
    clock.start(game.turn);
    pending = -1;
    toast('待った！');
    updatePanels(); draw();
    maybeCpuTurn();
  };

  $('#btn-pause').onclick = () => {
    if (phase !== 'play') return;
    phase = 'paused'; clock.pause();
    $('#pause-cover').classList.add('show');
  };
  $('#btn-resume').onclick = () => {
    if (phase !== 'paused') return;
    phase = 'play'; clock.resume();
    $('#pause-cover').classList.remove('show');
    maybeCpuTurn();
  };

  // 誤操作防止のため 2 回押しで投了（confirm() は埋め込み環境で使えないことがある）
  let resignArmed = 0;
  function disarmResign() {
    resignArmed = 0;
    $('#btn-resign').textContent = '投了';
    $('#btn-resign').classList.remove('accent');
  }
  $('#btn-resign').onclick = () => {
    if (phase !== 'play') return;
    const loser = game.turn;
    if (performance.now() > resignArmed) {
      resignArmed = performance.now() + 3000;
      $('#btn-resign').textContent = 'もう一度で投了';
      $('#btn-resign').classList.add('accent');
      setTimeout(() => { if (performance.now() > resignArmed) disarmResign(); }, 3100);
      return;
    }
    disarmResign();
    endGame(`${NAMES[otherColor(loser)]}の中押し勝ち`, `${NAMES[loser]}が投了しました`, otherColor(loser));
  };

  // ---------- 📷 シェア：その瞬間の盤と演出を 1 枚の画像（1080×1350）にして、共有メニューで送る ----------
  const PLAY_URL = 'robit-devworks.github.io/destroy-go-play';
  async function captureScene() {
    const Wd = 1080, Ht = 1350, out = document.createElement('canvas');
    out.width = Wd; out.height = Ht;
    const x = out.getContext('2d');
    const bg = x.createLinearGradient(0, 0, 0, Ht);
    bg.addColorStop(0, '#2a0a0e'); bg.addColorStop(0.5, '#0b0710'); bg.addColorStop(1, '#1a0830');
    x.fillStyle = bg; x.fillRect(0, 0, Wd, Ht);
    try { await document.fonts.load("80px 'Dela Gothic One'"); } catch (e) { /* 無視 */ }
    // 上：ロゴ
    const lg = x.createLinearGradient(0, 40, 0, 140);
    lg.addColorStop(0, '#fff6c8'); lg.addColorStop(0.4, '#ffcc33'); lg.addColorStop(0.7, '#ff5a1f'); lg.addColorStop(1, '#b3001b');
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = "88px 'Dela Gothic One', sans-serif"; x.fillStyle = lg;
    x.shadowColor = '#ff3b2f'; x.shadowBlur = 24; x.fillText('デストロイ碁', Wd / 2, 100); x.shadowBlur = 0;
    // 真ん中：盤（碁盤・にじみ・盤の演出）と、その上の演出（画面全体の fx から盤の部分を切り出す）
    const r = canvas.getBoundingClientRect(), B = 960, bx = (Wd - B) / 2, by = 190;
    for (const el of [canvas, $('#own-1'), $('#own-2'), $('#board-fx')]) if (el.width) x.drawImage(el, bx, by, B, B);
    const fx = $('#fx'), k = fx.width / window.innerWidth;
    if (fx.width) x.drawImage(fx, r.left * k, r.top * k, r.width * k, r.height * k, bx, by, B, B);
    // 演出の名前（DESTROY!!! など）が出ていれば、盤の上に大きく
    const banner = document.querySelector('#banner.show .b-main');
    if (banner) {
      x.font = "96px 'Dela Gothic One', sans-serif";
      const w = x.measureText(banner.textContent).width; // はみ出さない大きさにする
      if (w > Wd - 80) x.font = `${Math.floor(96 * (Wd - 80) / w)}px 'Dela Gothic One', sans-serif`;
      x.lineWidth = 14; x.strokeStyle = '#1a0005'; x.fillStyle = '#fff';
      x.shadowColor = getComputedStyle(banner).getPropertyValue('--c') || '#ff3b2f'; x.shadowBlur = 30;
      x.strokeText(banner.textContent, Wd / 2, by + B * 0.42); x.fillText(banner.textContent, Wd / 2, by + B * 0.42); x.shadowBlur = 0;
    }
    // 下：HP（デストロイルール）と、遊べる場所
    x.font = "bold 40px sans-serif"; x.fillStyle = '#fff';
    if (dstate) x.fillText(`黒 HP ${dstate.hp[BLACK]}　／　白 HP ${dstate.hp[WHITE]}`, Wd / 2, by + B + 60);
    x.font = "bold 34px sans-serif"; x.fillStyle = '#ffd23f';
    x.fillText(PLAY_URL, Wd / 2, Ht - 70);
    x.font = "26px sans-serif"; x.fillStyle = 'rgba(255,255,255,0.6)'; x.fillText('#デストロイ碁　© ROBIT', Wd / 2, Ht - 28);
    return out;
  }
  let shareFile = null;
  $('#btn-share').onclick = async () => {
    const cv = await captureScene(); // 押した瞬間を撮る（演出の途中でも）
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    shareFile = new File([blob], 'destroy-go.png', { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    $('#share-img').src = url; $('#share-save').href = url;
    $('#share-go').hidden = !(navigator.canShare && navigator.canShare({ files: [shareFile] }));
    $('#share-pop').hidden = false;
  };
  $('#share-go').onclick = async () => {
    try { await navigator.share({ files: [shareFile], text: `デストロイ碁で遊んだ！ https://${PLAY_URL}/ #デストロイ碁` }); }
    catch (e) { /* 閉じただけ */ }
  };
  $('#share-close').onclick = () => { $('#share-pop').hidden = true; };
  // 🔊 で音量の窓を開く（効果音・BGM の音量と、全部消す）
  function setMute(m) { // 効果音と BGM をまとめて消す・出す
    vol.seMute = vol.bgmMute = m; saveVolume(); applyVolume();
    if (!m && phase !== 'title') playBgm();
  }
  $('#btn-mute').onclick = (e) => { e.stopPropagation(); $('#vol-pop').hidden = !$('#vol-pop').hidden; };
  $('#vol-mute').onclick = () => setMute(!(vol.seMute && vol.bgmMute));
  document.addEventListener('pointerdown', (e) => { if (!$('#vol-pop').hidden && !e.target.closest('#vol-pop, #btn-mute')) $('#vol-pop').hidden = true; });

  // ---------- 全画面 ----------
  const fsTarget = document.documentElement;
  const fsSupported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  function toggleFullscreen() {
    const req = fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    try {
      const r = fsElement() ? exit.call(document) : req.call(fsTarget);
      if (r && r.catch) r.catch(() => toast('この画面では全画面にできません'));
    } catch (e) { toast('この画面では全画面にできません'); }
  }
  function updateFsButtons() {
    const on = !!fsElement();
    $('#btn-fs').textContent = on ? '✕' : '⛶';
    $('#btn-fs-title').textContent = on ? '全画面を終了' : '⛶ 全画面にする';
  }
  // ホーム画面のアイコンから開いているとき（もう画面いっぱい）
  const standalone = !!(navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches));
  // iPhone は全画面の機能がないので、「ホーム画面に追加」の案内を出す
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  document.querySelectorAll('.fs-btn').forEach((b) => {
    if (fsSupported) { b.onclick = toggleFullscreen; return; } // パソコンや Android（アプリとして入れて開いたときも使えるようにする）
    b.hidden = standalone || !isIOS || EMBEDDED;
    b.onclick = () => { $('#a2hs').hidden = false; };
  });
  // 「ホーム画面に追加」の手順（iPhone の Safari と Chrome で同じ）
  $('#a2hs-steps').innerHTML = [
    'アドレスバーの右にある<b>共有ボタン</b>（□に↑のマーク）を押す。見つからなければ右下の「…」→「共有」',
    '「<b>表示を増やす</b>」を押して、「<b>ホーム画面に追加</b>」を選ぶ',
    'ホーム画面にできた<b>デストロイ碁のアイコン</b>から開く',
  ].map((t) => `<li>${t}</li>`).join('');
  $('#a2hs-close').onclick = () => { $('#a2hs').hidden = true; };
  document.addEventListener('fullscreenchange', updateFsButtons);
  document.addEventListener('webkitfullscreenchange', updateFsButtons);

  // ---------- 終局・計算 ----------
  function enterScoring() {
    phase = 'scoring'; clock.stop(); dead = new Set();
    gameEl.classList.add('scoring');
    updatePanels(); draw();
    if (cpuSide) { // コンピューター戦は死に石をコンピューターが判定する（違っていればタップで直せる）
      const moveNo = game.moveNumber;
      askAI({ type: 'dead', state: aiState() }).then((r) => {
        if (phase !== 'scoring' || game.moveNumber !== moveNo) return;
        dead = new Set(r.dead);
        toast('死に石を自動で判定しました（違っていたらタップで直せます）');
        updatePanels(); draw();
      });
    }
  }

  function toggleDead(i) {
    if (game.board[i] === EMPTY) return;
    const g = game.group(i);
    const isDead = dead.has(i);
    g.stones.forEach((s) => (isDead ? dead.delete(s) : dead.add(s)));
    draw();
  }

  $('#btn-continue').onclick = () => {
    if (phase !== 'scoring') return;
    phase = 'play'; dead = new Set(); game.passes = 0;
    gameEl.classList.remove('scoring');
    clock.start(game.turn);
    updatePanels(); draw();
    maybeCpuTurn();
  };

  $('#btn-calc').onclick = () => {
    const s = game.score(dead);
    const line = (c) => {
      const d = s.detail[c];
      const parts = [`地 ${d.territory}`, d.prisoners !== undefined ? `アゲハマ ${d.prisoners}` : `石 ${d.stones}`];
      if (d.komi) parts.push(`コミ ${d.komi}`);
      return `${NAMES[c]} ${d.total}目（${parts.join(' ＋ ')}）`;
    };
    endGame(`${NAMES[s.winner]}の${s.margin}目勝ち`, `${line(BLACK)}\n${line(WHITE)}\n${RULES[s.rules].label}`, s.winner);
  };

  // winner を渡すと、勝った側の演出で負けた側の石を全部消してから結果を出す
  function endGame(title, body, winner = 0) {
    if (phase === 'replay') return;
    phase = 'over'; clock.stop(); cancelCharge();
    saveKifu(title, body, winner);
    const show = () => {
      $('.m-title').textContent = title;
      $('.m-body').textContent = body;
      $('#modal').classList.add('show');
      FX.boom(0.6);
      // 隠し要素：人が勝ったとき（コンピューター戦なら人の側）
      if (winner && (!cpuSide || winner !== cpuSide)) {
        if (dstate && title.startsWith('K.O.')) later(() => unlockSecret('thunder'), 700);
        if (cpuSide && cpuLevelInGame === 9) later(() => unlockSecret('light'), 700);
        if (cpuSide && cpuLevelInGame >= 5) later(() => unlockBgm('boss03'), 4900); // 演出の解放と重ならないよう後で
      }
      // 終えた対局の数（BGM の解放に使う）
      let played = 0;
      try { played = +(localStorage.getItem('destroy-go-played') || 0) + 1; localStorage.setItem('destroy-go-played', played); } catch (e) { /* 無視 */ }
      if (played >= 10) later(() => unlockBgm('fantasy15'), 4900);
    };
    const loser = otherColor(winner);
    const stones = winner ? [...game.board.keys()].filter((i) => game.board[i] === loser) : [];
    if (!stones.length) { show(); updatePanels(); draw(); return; }
    const k = canvas.getBoundingClientRect().width / geo.css;
    const r = canvas.getBoundingClientRect(), mid = (SIZE - 1) / 2;
    const ms = FX.victory(stones.map(stoneScreenPos), loser, geo.cell * 0.96 * k, themes[winner],
      { x: r.left + px(mid) * k, y: r.top + px(mid) * k });
    wiped = new Set(stones);
    updatePanels(); draw();
    later(show, ms);
  }

  // × で結果を閉じて、終わったときの盤面（勝ちの演出で消した石も戻す）を見られる。「結果を見る」でまた開く
  $('#btn-mclose').onclick = () => {
    $('#modal').classList.remove('show');
    wiped = new Set(); FX.clear(); draw();
    $('#btn-result').hidden = false;
  };
  $('#btn-result').onclick = () => { $('#modal').classList.add('show'); $('#btn-result').hidden = true; };
  $('#btn-again').onclick = () => { $('#modal').classList.remove('show'); newGame(); };
  $('#btn-home').onclick = () => { $('#modal').classList.remove('show'); endReplay(); showScreen('title'); phase = 'title'; stopBgm(); };

  // ---------- 時計・パネル ----------
  function fmt(ms) {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function updatePanels() {
    for (const color of [BLACK, WHITE]) {
      const el = $('#p' + color);
      const active = (phase === 'play' || phase === 'paused') && game.turn === color;
      const rem = clock.remaining(color);
      el.classList.toggle('active', active);
      el.classList.toggle('low', active && rem <= 30000);
      el.classList.toggle('over-grace', active && clock.graceLeft() <= 0);
      el.querySelector('.time').textContent = fmt(rem);
      el.querySelector('.cap').textContent = game.captures[color];
      const ratio = active ? clock.graceLeft() / clock.grace : 0;
      el.querySelector('.grace-bar').style.width = (ratio * 100) + '%';
    }
  }

  function showDelta(color, ms) {
    const el = $('#p' + color + ' .delta');
    const sec = ms / 1000;
    if (Math.abs(sec) < 0.05) { el.className = 'delta'; return; }
    el.textContent = (sec > 0 ? '+' : '') + sec.toFixed(1) + 's';
    el.className = 'delta';
    void el.offsetWidth;
    el.className = 'delta show ' + (sec > 0 ? 'plus' : 'minus');
  }

  function tick() {
    if (phase === 'play' && fxHoldStart) {
      const now = performance.now();
      if (FX.busy() && now - fxHoldStart < FX_HOLD_MAX) { clock.holdNow(); lockUntil = Math.max(lockUntil, now + 100); }
      else fxHoldStart = 0;
    }
    gameEl.classList.toggle('fx-hold', phase === 'play' && fxHoldStart > 0);
    if (phase === 'play' || phase === 'paused') {
      if (phase === 'play' && clock.isTimeUp()) {
        const loser = game.turn;
        updatePanels();
        endGame(`${NAMES[otherColor(loser)]}の時間切れ勝ち`, `${NAMES[loser]}の持ち時間がなくなりました`, otherColor(loser));
      } else updatePanels();
    }
    requestAnimationFrame(tick);
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#game').classList.contains('active') ? $('#toast') : $('#gtoast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1300);
  }

  // ---------- 画面遷移 ----------
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    // 前の対局の「二眼完成！」などが残っていると、画面を出し直したときにもう一度再生されるので消す
    $('#eyes').className = '';
  }

  function newGame() {
    bgmPick = null; playBgm(); // ランダムなら対局ごとに選び直す
    game = new GoGame(SIZE, rules);
    clock = new GoClock({ base: minutes() * 60 * 1000 });
    $('#btn-result').hidden = true;
    dead = new Set(); wiped = new Set(); terrGlow = null; pending = -1; hover = -1; lockUntil = 0;
    BoardFX.clear();
    BoardFX.resetTraces();
    gameEl.classList.remove('scoring', 'previewing');
    gameEl.classList.toggle('face', opt.face.checked);
    $('#pause-cover').classList.remove('show');
    showScreen('game');
    phase = 'play';
    layout();
    cpuToken++; setThinking(false); cpuLow = 0; gameSerial++;
    dstate = mode === 'destroy' ? new DestroyRule.DestroyState(SIZE, { color: hpBonusColor, rate: hpBonus }, dAdvanced) : null; ruleHist = []; spurtShown = false;
    dlog = []; $('#log-pop').hidden = true; $('#rules-pop').hidden = true; $('#btn-log').hidden = !dstate; // 履歴はデストロイルールのときだけ
    const hc = effectiveHandicap();
    if (hc) { game.setHandicap(hc); toast(`置き石${hc}子・白から打ちます`); }
    cpuSide = opponent === 'cpu' ? otherColor(gameHumanColor()) : 0;
    // 棋譜（終わったら端末に保存して、あとで見返せる）
    kifu = { date: Date.now(), size: SIZE, rules, mode, adv: dAdvanced, hc, hpb: { color: hpBonusColor, rate: hpBonus },
      cpu: cpuSide ? { side: cpuSide, level: cpuLevel } : null, moves: [], result: null };
    cpuLevelInGame = cpuLevel; cpuResignInGame = cpuResign;
    renderNames(); renderHp(); resetEyes();
    clock.start(game.turn);
    updatePanels();
    FX.gameStart();
    maybeCpuTurn(); // コンピューターが黒なら先に打つ
  }

  $('#btn-start').onclick = () => { FX.unlock(); newGame(); };
  // スマホは「指を離したとき」「クリックしたとき」でないと音を出す許可がもらえないことがあるので、そこでも音を有効にする
  for (const ev of ['touchend', 'click']) document.addEventListener(ev, () => FX.unlock(), { capture: true, passive: true });

  // タイトルロゴを叩くと壊れる：1〜4 回目はひびが入り、5 回目で粉々に砕け散って、少しすると巻き戻って元に戻る
  const logo = $('.logo'), sublogo = $('.sublogo');
  const LOGO_GRADIENT = 'linear-gradient(180deg, #fff6c8 0%, #ffcc33 35%, #ff5a1f 65%, #b3001b 100%)';
  let logoHits = 0, logoBusy = false, logoCracks = [], logoIdle = 0;
  const rand = (a, b) => a + Math.random() * (b - a);

  // ひびはロゴの背景に重ね、文字の形で切り抜く（文字のないところには出ない）
  function crackLogo(x, y, level) {
    const r = logo.getBoundingClientRect();
    const ox = x - r.left, oy = y - r.top;
    for (let b = 0; b < 2 + level; b++) {
      let px = ox, py = oy, a = rand(0, Math.PI * 2);
      const pts = [[px, py]];
      const steps = 3 + level * 2, step = r.height * rand(0.07, 0.12);
      for (let k = 0; k < steps; k++) { a += rand(-0.7, 0.7); px += Math.cos(a) * step; py += Math.sin(a) * step; pts.push([px, py]); }
      logoCracks.push(pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' '));
    }
    const lines = (stroke, w, dx = 0) => logoCracks.map((pts) =>
      `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linejoin="round" transform="translate(${dx},${dx})"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${r.width}" height="${r.height}" viewBox="0 0 ${r.width} ${r.height}">`
      + lines('#fff6c8', 1.5, 1.5) + lines('#2a0006', 3.5) + '</svg>';
    logo.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}"), ${LOGO_GRADIENT}`;
    logo.style.backgroundSize = '100% 100%';
  }

  function resetLogo() {
    logoHits = 0; logoCracks = [];
    logo.style.backgroundImage = ''; logo.style.backgroundSize = '';
  }

  // 1 文字を、ひとつの点から放射状に 3〜4 個のかけらに割る（clip-path の多角形、% 座標）
  function fragments() {
    const cx = rand(30, 70), cy = rand(30, 70), n = 3 + Math.floor(rand(0, 2));
    const start = rand(0, Math.PI * 2), cuts = Array.from({ length: n }, (_, i) => start + (i + rand(0.2, 0.8)) * (Math.PI * 2 / n));
    const edge = (a) => { // 中心から角度 a の向きに伸ばして、0〜100 の枠に当たる点
      const dx = Math.cos(a), dy = Math.sin(a);
      const t = Math.min(dx > 0 ? (100 - cx) / dx : dx < 0 ? -cx / dx : Infinity, dy > 0 ? (100 - cy) / dy : dy < 0 ? -cy / dy : Infinity);
      return [cx + dx * t, cy + dy * t];
    };
    const corners = [[100, 100], [0, 100], [0, 0], [100, 0]].map((p) => ({ p, a: Math.atan2(p[1] - cy, p[0] - cx) }));
    const norm = (a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return cuts.map((a0, i) => {
      const a1 = i + 1 < n ? cuts[i + 1] : cuts[0] + Math.PI * 2, span = a1 - a0;
      const mid = corners.filter((c) => norm(c.a - a0) < span).sort((p, q) => norm(p.a - a0) - norm(q.a - a0)).map((c) => c.p);
      const poly = [[cx, cy], edge(a0), ...mid, edge(a1)];
      return { poly: `polygon(${poly.map(([x, y]) => `${x.toFixed(1)}% ${y.toFixed(1)}%`).join(',')})`, dir: (a0 + a1) / 2 };
    });
  }

  function shatterLogo(x, y) {
    logoBusy = true;
    setTimeout(() => unlockSecret('fire'), 1400); // 隠し要素
    const text = logo.firstChild, range = document.createRange(), cs = getComputedStyle(logo);
    const layer = document.createElement('div');
    layer.className = 'logo-shards';
    const pieces = [];
    for (let i = 0; i < text.length; i++) {
      range.setStart(text, i); range.setEnd(text, i + 1);
      const r = range.getBoundingClientRect();
      FX.logoChunks(r, 8);
      for (const f of fragments()) {
        const el = document.createElement('span');
        el.textContent = text.data[i];
        Object.assign(el.style, {
          left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px',
          fontSize: cs.fontSize, lineHeight: r.height + 'px', clipPath: f.poly, backgroundImage: LOGO_GRADIENT,
        });
        layer.appendChild(el);
        // 叩いた点から遠ざかる向き＋かけらの向きに飛ばす
        const away = Math.atan2(r.top + r.height / 2 - y, r.left + r.width / 2 - x);
        const sp = rand(6, 16), a = away * 0.6 + f.dir * 0.4;
        pieces.push({ el, x: 0, y: 0, r: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rand(6, 12), vr: rand(-12, 12), path: [] });
      }
    }
    document.body.appendChild(layer);
    logo.classList.add('shattered');
    sublogo.classList.remove('jolt'); void sublogo.offsetWidth; sublogo.classList.add('jolt');

    const place = (p, s) => { p.el.style.transform = `translate(${s[0]}px, ${s[1]}px) rotate(${s[2]}deg)`; };
    let frame = 0;
    const fly = () => {
      for (const p of pieces) {
        p.vy += 0.6; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        p.path.push([p.x, p.y, p.r]); place(p, p.path[p.path.length - 1]);
      }
      if (++frame < 90) requestAnimationFrame(fly);
      else setTimeout(rewind, 700);
    };
    // 巻き戻し：飛んでいった道筋を 3 倍速で逆にたどって元の位置に戻る
    const rewind = () => {
      if (!layer.isConnected) return;
      let k = frame - 1;
      const back = () => {
        k = Math.max(-1, k - 3);
        for (const p of pieces) place(p, k >= 0 ? p.path[k] : [0, 0, 0]);
        if (k >= 0) { requestAnimationFrame(back); return; }
        layer.remove();
        resetLogo();
        logo.classList.remove('shattered');
        logo.animate([{ transform: 'scale(1.12)' }, { transform: 'scale(0.96)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
        FX.stoneClick();
        logoBusy = false;
      };
      back();
    };
    requestAnimationFrame(fly);
  }

  logo.addEventListener('pointerdown', (e) => {
    if (logoBusy) return;
    FX.unlock();
    clearTimeout(logoIdle);
    logoHits++;
    FX.logoHit(e.clientX, e.clientY, Math.min(5, logoHits), logo.getBoundingClientRect().height);
    if (logoHits >= 5) { shatterLogo(e.clientX, e.clientY); return; }
    crackLogo(e.clientX, e.clientY, logoHits);
    logo.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${rand(-8, 8)}px, ${rand(3, 8)}px) scale(0.97)` }, { transform: 'translate(0,0)' }], { duration: 160 });
    // しばらく叩かなければ、ひびは消えて元に戻る
    logoIdle = setTimeout(resetLogo, 4000);
  });

  // 演出プレビュー：碁盤の上で、実際に石を取ったときと同じ演出（盤面の演出も含む）を見せる
  let previewN = 0, previewTimer = 0;
  function runPreview() {
    clearTimeout(previewTimer);
    FX.clear();
    BoardFX.clear();
    BoardFX.resetTraces();
    const mover = previewColor, victim = mover === BLACK ? WHITE : BLACK, n = previewN;
    game = new GoGame(SIZE, rules);
    // 盤の中央から近い順に n 子を相手の石にし、そのまわりを自分の石で囲む
    const mid = (SIZE - 1) / 2, dist = (i) => { const [x, y] = game.xy(i); return Math.hypot(x - mid, y - mid); };
    const order = [...Array(SIZE * SIZE).keys()].sort((a, b) => dist(a) - dist(b) || a - b);
    const cluster = order.slice(0, n);
    cluster.forEach((i) => { game.board[i] = victim; });
    for (const i of cluster) for (const nb of game.neighbors(i)) if (game.board[nb] === EMPTY) game.board[nb] = mover;
    game.lastMove = order.find((i) => game.board[i] === mover);
    $('#preview-info').textContent = `プレビュー：${NAMES[mover]}（${themeOf(themes[mover]).label}）が ${n}子 取る`;
    renderPreviewChips();
    layout(); // 下の欄の高さが変わることがあるので、碁盤の大きさを合わせ直す
    updatePanels(); draw();
    previewTimer = setTimeout(() => {
      if (phase !== 'preview') return;
      cluster.forEach((i) => { game.board[i] = EMPTY; });
      game.captures[mover] = n;
      FX.stoneClick();
      const k = canvas.getBoundingClientRect().width / geo.css;
      FX.capture(cluster.map(stoneScreenPos), victim, geo.cell * 0.96 * k, themes[mover]);
      const onBoard = cluster.map((i) => { const [x, y] = game.xy(i); return { x: px(x), y: px(y) }; });
      BoardFX.apply(themes[mover], FX.tierIndex(n), onBoard, geo);
      if (opt.trace.checked) BoardFX.addTrace(themes[mover], FX.tierIndex(n), onBoard, geo, mover, 1);
      updatePanels(); draw();
    }, 500);
  }
  // プレビュー画面でも演出と石の数を選び直せる。選んだ演出はプレビューの間だけ使い、タイトルに戻ったら元に戻す
  const PREVIEW_COUNTS = [1, 2, 3, 5, 9, 15, 25];
  let previewSaved = null;
  for (const t of FX.themes) {
    const b = document.createElement('button');
    b.dataset.key = t.key; b.textContent = t.label + (unlocked(t.key) ? '' : '🔒'); b.style.setProperty('--tc', t.color);
    b.onclick = () => {
      if (phase !== 'preview') return;
      const mover = previewColor, other = otherColor(mover);
      if (themes[mover] === t.key) { runPreview(); return; }
      // 相手が使っている演出を選んだときは、相手と入れ替える（黒と白で同じ演出は使えないため）
      if (themes[other] === t.key) themes[other] = themes[mover];
      themes[mover] = t.key;
      renderThemes();
      runPreview();
    };
    $('#pv-themes').appendChild(b);
  }
  for (const n of PREVIEW_COUNTS) {
    const b = document.createElement('button');
    b.dataset.n = n; b.textContent = n + '子';
    b.onclick = () => { if (phase !== 'preview') return; previewN = n; runPreview(); }; // 選んでいる数をもう一度押すと撃ち直す
    $('#pv-counts').appendChild(b);
  }
  function renderPreviewChips() {
    document.querySelectorAll('#pv-themes button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.key === themes[previewColor]));
    document.querySelectorAll('#pv-counts button').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.n === previewN));
  }
  function endPreviewThemes() {
    if (!previewSaved) return;
    Object.assign(themes, previewSaved); previewSaved = null;
    renderThemes();
  }

  document.querySelectorAll('.preview button').forEach((b) => {
    b.onclick = () => {
      FX.unlock();
      previewN = +b.dataset.n;
      previewSaved = { ...themes };
      clock = new GoClock({ base: minutes() * 60 * 1000 });
      dead = new Set(); wiped = new Set(); terrGlow = null; pending = -1; hover = -1;
      $('#btn-result').hidden = true;
      gameEl.classList.remove('scoring');
      gameEl.classList.add('previewing');
      gameEl.classList.toggle('face', opt.face.checked);
      $('#pause-cover').classList.remove('show');
      phase = 'preview';
      cpuToken++; cpuSide = 0; setThinking(false); renderNames();
      dstate = null; ruleHist = []; gameSerial++; renderHp();
      showScreen('game');
      game = new GoGame(SIZE, rules);
      layout();
      runPreview();
    };
  });
  // タイトルへ戻る。対局中は誤タップで対局が消えないよう 2 回押しにする（投了と同じ）
  let titleArmed = 0;
  function disarmTitle() {
    titleArmed = 0;
    $('#btn-title').textContent = '← タイトルへ';
    $('#btn-title').classList.remove('accent');
  }
  function goTitle() {
    endReplay();
    disarmTitle(); disarmResign(); cancelCharge();
    cpuToken++; setThinking(false); gameSerial++;
    endPreviewThemes();
    clearTimeout(previewTimer);
    if (clock) clock.stop();
    FX.clear();
    BoardFX.clear();
    BoardFX.resetTraces();
    gameEl.classList.remove('previewing', 'scoring');
    $('#pause-cover').classList.remove('show');
    $('#modal').classList.remove('show');
    phase = 'title';
    showScreen('title');
    stopBgm();
  }
  // ---------- 棋譜の保存と見返し・ハイライト ----------
  let kifu = null;
  const KIFU_KEY = 'destroy-go-kifu', KIFU_MAX = 20;
  const loadKifus = () => { try { return JSON.parse(localStorage.getItem(KIFU_KEY) || '[]'); } catch (e) { return []; } };
  function saveKifu(title, body, winner) {
    if (!kifu || !kifu.moves.length) return;
    kifu.result = { title, body, winner };
    const list = [kifu, ...loadKifus()].slice(0, KIFU_MAX); // 新しい順に 20 局まで
    try { localStorage.setItem(KIFU_KEY, JSON.stringify(list)); } catch (e) { /* いっぱいなら保存しない */ }
    $('#btn-replay-last').hidden = false;
  }
  const kifuLabel = (k) => `${k.size}路・${k.mode === 'destroy' ? `デストロイ${k.adv ? '上級' : '初級'}` : 'ふつう'}${k.cpu ? `・CPU Lv${k.cpu.level}` : '・2人'}・${k.moves.length}手`;
  function renderKifuList() {
    const list = loadKifus();
    $('#kifu-list').innerHTML = list.length ? list.map((k, i) => {
      const d = new Date(k.date);
      return `<li><div class="kf-main"><b>${(k.result && k.result.title) || '途中まで'}</b><small>${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}　${kifuLabel(k)}</small></div>`
        + `<button data-kf-play="${i}" class="accent">▶ 見る</button><button data-kf-del="${i}">🗑</button></li>`;
    }).join('') : '<li class="log-empty">まだ棋譜はありません。対局が終わると自動で保存されます</li>';
    $('#kifu-list').querySelectorAll('[data-kf-play]').forEach((b) => { b.onclick = () => { $('#kifu-pop').hidden = true; startReplay(loadKifus()[+b.dataset.kfPlay]); }; });
    $('#kifu-list').querySelectorAll('[data-kf-del]').forEach((b) => { b.onclick = () => {
      const l = loadKifus(); l.splice(+b.dataset.kfDel, 1);
      try { localStorage.setItem(KIFU_KEY, JSON.stringify(l)); } catch (e) { /* 無視 */ }
      renderKifuList();
    }; });
  }
  $('#btn-kifu').onclick = () => { renderKifuList(); $('#kifu-pop').hidden = false; };
  $('#kifu-close').onclick = () => { $('#kifu-pop').hidden = true; };
  $('#btn-replay-last').onclick = () => { const k = loadKifus()[0]; if (k) { $('#modal').classList.remove('show'); startReplay(k); } };

  // 再生：対局の画面をそのまま使い、棋譜の手を 1 手ずつ置き直す（時計は止めたまま）
  let rpk = null, rpIdx = 0, rpTimer = 0, rpSaved = null;
  function rpReset() {
    clearTimeout(rpTimer);
    FX.clear(); BoardFX.clear(); BoardFX.resetTraces();
    game = new GoGame(SIZE, rpk.rules);
    if (rpk.hc) game.setHandicap(rpk.hc);
    dstate = rpk.mode === 'destroy' ? new DestroyRule.DestroyState(SIZE, rpk.hpb, rpk.adv) : null;
    wiped = new Set(); dead = new Set(); terrGlow = null; rpIdx = 0;
  }
  // 1 手置く。animate なら石を取る演出・ダメージも見せる。演出の長さ（ms）を返す
  function rpApply(animate) {
    const mv = rpk.moves[rpIdx++], mover = game.turn;
    if (mv.p < 0) { game.pass(); if (dstate) dstate.pass(mover); if (animate) toast(`${NAMES[mover]}がパス`); return 0; }
    if (mv.t) themes[mover] = mv.t;
    const [x, y] = game.xy(mv.p), r = game.play(x, y);
    if (!r.ok) return 0;
    let hold = 0;
    if (r.captured.length) {
      const onBoard = r.captured.map((c) => { const [cx, cy] = game.xy(c); return { x: px(cx), y: px(cy) }; });
      if (animate) {
        const k = canvas.getBoundingClientRect().width / geo.css;
        hold = FX.capture(r.captured.map(stoneScreenPos), otherColor(mover), geo.cell * 0.96 * k, themes[mover], mv.c || 0);
        BoardFX.apply(themes[mover], FX.tierIndex(r.captured.length), onBoard, geo);
      }
      if (opt.trace.checked) BoardFX.addTrace(themes[mover], FX.tierIndex(r.captured.length), onBoard, geo, mover, game.moveNumber);
    } else if (animate) FX.stoneClick();
    if (dstate) {
      const h = dstate.hit(mover, r.captured.length, { maxCharge: !!mv.x, spurt: !!mv.s, point: mv.p, stones: r.captured });
      const healed = dstate.heal(game.board);
      if (animate && r.captured.length) {
        const victim = otherColor(mover), n = r.captured.length;
        later(() => {
          popDamage(victim, h.kind === 'ko' ? 'K.O.!!' : `${h.kind === 'critical' ? 'CRITICAL!! ' : ''}-${h.amount}`, h.kind, h.tags);
          showFormula(victim, h, n); renderHp();
        }, Math.min(hold, 900));
        if (h.recoil > 0) later(() => { popDamage(mover, `反動 -${h.recoil}`, 'recoil'); showRecoilFormula(mover, h); }, Math.min(hold, 900) + 450);
      }
      if (animate) for (const c of [BLACK, WHITE]) if (healed[c]) later(() => { popDamage(c, `+${healed[c]}`, 'heal'); FX.heal(); showHealFormula(c, healed[c]); }, Math.min(hold, 900) + 650);
    }
    return hold;
  }
  function rpRender() {
    draw(); renderHp(); updatePanels();
    $('#rp-info').textContent = `${rpIdx} / ${rpk.moves.length}手${rpIdx === rpk.moves.length && rpk.result ? `　${rpk.result.title}` : ''}`;
    $('#rp-auto').textContent = rpTimer ? '⏸ 止める' : '▶ ハイライト';
  }
  function rpGoTo(n) { // n 手目まで、演出なしで一気に進める
    rpStop(); rpReset();
    while (rpIdx < Math.min(n, rpk.moves.length)) rpApply(false);
    rpRender();
  }
  function rpStop() { clearTimeout(rpTimer); rpTimer = 0; }
  // ハイライト：何も起きない手は速く、石を取る手は等倍で演出を見せる。最後は勝ったときの演出
  function rpAutoStep() {
    if (rpIdx >= rpk.moves.length) { rpTimer = 0; rpFinish(); rpRender(); return; }
    const mv = rpk.moves[rpIdx];
    const t = mv.p >= 0 ? game.tryPlay(mv.p) : null, event = t && t.ok && t.captured.length > 0;
    const hold = rpApply(event);
    rpRender();
    rpTimer = setTimeout(rpAutoStep, event ? Math.max(1800, hold + 1500) : 110);
  }
  function rpFinish() {
    const res = rpk.result;
    if (!res || !res.winner) return;
    const loser = otherColor(res.winner), stones = [...game.board.keys()].filter((i) => game.board[i] === loser);
    const r = canvas.getBoundingClientRect(), k = r.width / geo.css, mid = (SIZE - 1) / 2;
    if (stones.length) FX.victory(stones.map(stoneScreenPos), loser, geo.cell * 0.96 * k, themes[res.winner], { x: r.left + px(mid) * k, y: r.top + px(mid) * k });
    wiped = new Set(stones); draw(); // 対局と同じく、負けた側の石は消えたまま（戻る・最初へで元に戻る）
    showBigNote(res.title, '#ffd23f');
  }
  function startReplay(k) {
    rpSaved = { size: SIZE, themes: { ...themes } };
    rpk = k; SIZE = k.size;
    clock = new GoClock({ base: 60000 }); // 再生では時計を使わない
    gameSerial++; cpuToken++; setThinking(false); cpuSide = k.cpu ? k.cpu.side : 0; cpuLevelInGame = k.cpu ? k.cpu.level : 3;
    showScreen('game'); phase = 'replay';
    gameEl.classList.remove('scoring', 'previewing'); gameEl.classList.add('replaying');
    $('#btn-result').hidden = true; $('#btn-log').hidden = true;
    layout(); rpReset(); renderNames(); renderThemes(); rpRender();
  }
  function endReplay() {
    if (!rpSaved) return;
    rpStop(); SIZE = rpSaved.size; Object.assign(themes, rpSaved.themes); rpSaved = null; rpk = null;
    gameEl.classList.remove('replaying'); renderThemes();
  }
  $('#rp-first').onclick = () => rpGoTo(0);
  $('#rp-prev').onclick = () => rpGoTo(rpIdx - 1);
  $('#rp-next').onclick = () => { if (rpIdx >= rpk.moves.length) return; rpStop(); FX.clear(); rpApply(true); if (rpIdx >= rpk.moves.length) rpFinish(); rpRender(); };
  $('#rp-last').onclick = () => { rpGoTo(rpk.moves.length); rpFinish(); };
  $('#rp-auto').onclick = () => { if (rpTimer) { rpStop(); rpRender(); return; } if (rpIdx >= rpk.moves.length) rpGoTo(0); rpAutoStep(); };

  $('#btn-title').onclick = () => {
    if ((phase === 'play' || phase === 'paused') && performance.now() > titleArmed) {
      titleArmed = performance.now() + 3000;
      $('#btn-title').textContent = 'もう一度で対局をやめる';
      $('#btn-title').classList.add('accent');
      setTimeout(() => { if (performance.now() > titleArmed) disarmTitle(); }, 3100);
      return;
    }
    goTitle();
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && phase === 'play') $('#btn-pause').onclick();
    // 別のアプリやタブに移ったら BGM も止める（戻ったら続きから）
    if (document.hidden) stopBgm(); else if (phase !== 'title' && phase !== 'preview') playBgm();
  });

  renderThemes();
  renderRules();
  renderHints();
  requestAnimationFrame(tick);
})();
