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
  // 遊ばれ方の回数だけを GoatCounter に数える（「CPU 戦を始めた」など。個人は分からない）。
  // GoatCounter は公開しているサイトでだけ読み込む（開発者・テスト用の端末では読み込まない）ので、それ以外では何もしない
  const track = (name) => { try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: name, title: name, event: true }); } catch (e) { /* 無視 */ } };
  // 無料版の隠し要素：条件を満たすと、その端末でほかの演出も使えるようになる（製品版は最初から全部）
  const SECRETS = {
    fire: 'タイトルのロゴを壊した',
    thunder: 'デストロイルールで KO 勝ちした',
    dark: '一度に 20 子以上取った',
    light: 'コンピューター Lv9 に勝った',
  };
  // 鍵のかかった演出・BGM を押したときのヒント（答えは言わず、ぼかして出す）
  const HINTS_LOCKED = {
    fire: '始まりの文字を砕け', thunder: '相手の HP を削りきれ', dark: '大軍を一撃で飲み込め', light: '最強を打ち破れ',
    fantasy15: '旅を続けよ', boss03: '強敵に挑み、勝て', lastboss01: '会心の一撃を放て',
  };
  const lockedMsg = (key) => (HINTS_LOCKED[key] ? `条件未達成：${HINTS_LOCKED[key]}` : '条件未達成');
  // シーズンのランキング報酬（色違いの演出）。製品版でも、取った人だけが使える（開発者も同じ）
  const SEASON_REWARDS = {
    crimson: 'シーズン1 ランクマッチ 1〜3 位',
    shimetsu: 'シーズン1 ランクマッチ 4〜10 位',
    aoen: 'シーズン1 ランクマッチ 11〜50 位',
    ougon: '破壊の迷宮 全階 ★3', // シーズンとは別だが、扱いは同じ（取った人だけが使える）
    kometsu: '（まだ手に入らない）', // 虹色の演出。見せ方を考え直し中
    clear: '破壊の迷宮 深淵層の最深部を突破',
  };
  // 破壊の迷宮（中では dojo と呼ぶ）：B1F〜B9F のボス（CPU Lv1〜9）。勝つと「撃破」、星（★1〜3）は勝ち方で決まる。途中の階で称号がもらえる
  const BOSSES = ['', '見習い石崩し', 'いたずら小鬼', '石割りの剣士', '鉄壁の門番', '破壊の番人', '業火の将軍', '雷鳴の覇者', '深淵の賢者', '碁の魔王',
    '深淵の見習い', '狂いし小鬼', '呪われた剣士', '黒鉄の門番', '冥府の番人', '獄炎の将軍', '黒雷の覇者', '虚無の賢者', '真・碁の魔王'];
  // 深淵層 B10F〜B18F（B9F を突破すると出てくる裏の階）：CPU のレベル（lv）と、CPU がもらうハンデ（置き石 hc・HP の上乗せ hp）。ルールはデストロイ固定
  const ABYSS = {
    10: { lv: 1, hc: 4, hp: 0 }, 11: { lv: 2, hc: 0, hp: 1 }, 12: { lv: 3, hc: 3, hp: 0 }, 13: { lv: 4, hc: 0, hp: 0.5 }, 14: { lv: 5, hc: 2, hp: 0 },
    15: { lv: 6, hc: 0, hp: 0.5 }, 16: { lv: 7, hc: 2, hp: 0 }, 17: { lv: 8, hc: 2, hp: 0.25 }, 18: { lv: 9, hc: 2, hp: 0.5 },
  };
  // 消滅（深淵層の最深部の専用の演出）は作り込み中。CLEAR_READY を true にするまで、報酬に出さず手にも入らない
  const CLEAR_READY = false;
  const ABYSS_GIFTS = { 12: '名前ガチャの引き直しが 1 日 5 回に', 15: '名前ガチャでレアな名前が出やすくなる', 18: `まだ解放していない演出・BGM を全部解放${CLEAR_READY ? '＋専用の演出「消滅」' : ''}` };
  const ABYSS_FLOORS = [10, 11, 12, 13, 14, 15, 16, 17, 18];
  // 10 は特別な称号：Lv1〜9 を全部 ★3 で撃破したとき。18 は深淵層の最深部を突破したとき（いちばん上）
  const DOJO_TITLES = { 3: '石崩し', 7: '破壊者', 9: '魔王討伐者', 10: 'デストロイマスター', 18: '深淵の覇者' };
  // stars：{ 階（= CPU のレベル）: 取った星の数（いちばん多いとき） }、best：ノンストップ潜行で何階まで突破したか（いちばん深いとき）
  let dojo = { stars: {}, best: 0 };
  try { const d = JSON.parse(localStorage.getItem('destroy-go-dojo') || '{}'); if (d && typeof d.stars === 'object') dojo = { stars: d.stars, best: +d.best || 0 }; } catch (e) { /* 無視 */ }
  const saveDojo = () => { try { localStorage.setItem('destroy-go-dojo', JSON.stringify(dojo)); } catch (e) { /* 無視 */ } };
  const dojoCleared = (lv) => (dojo.stars[lv] || 0) > 0;
  const dojoCount = () => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(dojoCleared).length;
  const dojoAll3 = () => [1, 2, 3, 4, 5, 6, 7, 8, 9].every((lv) => dojo.stars[lv] >= 3);
  const dojoTitleLv = () => (dojoCleared(18) ? 18 : dojoAll3() ? 10 : [9, 7, 3].find(dojoCleared) || 0); // いちばん上の称号（その階を撃破していれば）
  const abyssOpen = () => dojoCleared(9);
  const abyssCount = () => ABYSS_FLOORS.filter(dojoCleared).length;
  const secretUnlocked = new Set();
  try { for (const k of JSON.parse(localStorage.getItem('destroy-go-unlocks') || '[]')) if (SECRETS[k] || SEASON_REWARDS[k]) secretUnlocked.add(k); } catch (e) { /* 無視 */ }
  // 開発者はテストのため、ランダムマッチ・ランクマッチ以外（フレンド戦・この端末・プレビュー）ならシーズン報酬も使える
  let rankedNow = false;
  // 開発者の ID でオンラインに入ったら、この端末に開発者の印を残す（次に開いたときは、最初から取った人だけの演出もテストで選べる）
  const markDev = () => { try { if (localStorage.getItem('destroy-go-dev') === '1') return; localStorage.setItem('destroy-go-dev', '1'); localStorage.setItem('skipgc', 't'); } catch (e) { return; } setTimeout(() => refreshThemeChoices(), 0); };
  const devHere = () => { if (window.DESTROY_GO_DEV) return true; /* 自分用の確認ページ（Artifact）では開発者として動かす */ try { if (localStorage.getItem('destroy-go-dev') === '1') return true; } catch (e) { /* 無視 */ } const d = !!(window.Online && Online.me() === 'RBJU7o2rpuTScawapNfCBFPXHhj2'); if (d) markDev(); return d; };
  const unlocked = (key) => (SEASON_REWARDS[key] ? secretUnlocked.has(key) || (!rankedNow && devHere()) : !FREE || ED.freeThemes.includes(key) || secretUnlocked.has(key));
  const themeKeys = () => FX.themes.map((t) => t.key).filter(unlocked);
  const themeOf = (key) => FX.themes.find((t) => t.key === key) || FX.themes[0];
  // 黒と白で同じ演出は選べない（どちらの演出か一目でわかるように）。色が近い演出（炎と紅雷・氷と蒼炎・闇と紫滅）も同じ扱い
  const COLOR_GROUP = { fire: 'red', crimson: 'red', ice: 'blue', aoen: 'blue', dark: 'purple', shimetsu: 'purple', light: 'gold', ougon: 'gold' };
  const clash = (a, b) => a === b || (!!COLOR_GROUP[a] && COLOR_GROUP[a] === COLOR_GROUP[b]);
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
  if (clash(themes[BLACK], themes[WHITE])) themes[WHITE] = themeKeys().find((k) => !clash(k, themes[BLACK]));
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
  // オンライン対戦（β）の状態。対戦していないときは null
  //   { code, host, color, g: 何局目, min: 持ち時間, settings, applying: 相手の手を再現中, out: 送る手, again: もう一局を押した人, ... }
  let net = null;
  let homeReady = false; // タイトルのカード（今の設定の 1 行など）を描いてよいか（準備がすべて終わってから）
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
    chip.onclick = () => { dAdvanced = key === 'advanced'; try { localStorage.setItem('destroy-go-dlevel', key); } catch (e) { /* 無視 */ } renderMode(); renderRules(); };
    $('#dlevel-chips').appendChild(chip);
  }
  for (const [key, label] of [['go', 'ふつうの囲碁（地の多さ）'], ['destroy', 'デストロイルール（HPバトル）【調整中】']]) {
    const chip = document.createElement('button');
    chip.className = 'chip rule-chip'; chip.dataset.mode = key; chip.textContent = label;
    chip.onclick = () => { mode = key; try { localStorage.setItem('destroy-go-mode', key); } catch (e) { /* 無視 */ } renderMode(); renderRules(); };
    $('#mode-chips').appendChild(chip);
  }
  renderMode();

  // 置き石（ハンデ）：0（なし）か 2〜9 子。コンピューター戦では、置くのがあなたかコンピューターかも選ぶ（置く側が黒）
  let opponent = 'cpu', cpuLevel = 3, humanColor = BLACK, handicap = 0, hcWho = 'human', cpuResign = true;
  try {
    const o = JSON.parse(localStorage.getItem('destroy-go-opponent') || '{}');
    if (o.opponent === 'human') opponent = 'human'; // はじめは CPU 戦（一人でもすぐ遊べるように）
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
    renderHome();
  }
  // タイトルの「この端末で遊ぶ」：今の設定を 1 行で出し、CPU と／2人で のボタンに今の相手を出す
  function renderHome() {
    if (!homeReady) return;
    const rule = mode === 'destroy' ? `デストロイ${dAdvanced ? '上級' : '初級'}` : 'ふつうの囲碁';
    $('#start-summary').textContent = [opponent === 'cpu' ? `CPU Lv${cpuLevel}` : '2人で対局', `${SIZE}路`, rule, timeText()].join('・');
    $('#q-cpu').setAttribute('aria-pressed', opponent === 'cpu');
    $('#q-human').setAttribute('aria-pressed', opponent !== 'cpu');
    renderHomeSet();
  }
  // タイトルの「対局の設定」：ルール・CPU の強さ・碁盤・持ち時間を選ぶ（⚙ 設定の同じボタンを押す）。演出は .theme-row で共通
  // はじめはひらいておく（気づいてもらうため）。たたんだら覚えておく
  let homeSetOpen = true;
  try { homeSetOpen = localStorage.getItem('destroy-go-homeset') !== '0'; } catch (e) { /* 無視 */ }
  const HOME_SET = {
    rule: { list: () => [['go', 'ふつうの囲碁'], ['simple', 'デストロイ初級'], ['advanced', 'デストロイ上級']],
      now: () => (mode === 'destroy' ? (dAdvanced ? 'advanced' : 'simple') : 'go'),
      pick: (v) => { $(`#mode-chips .chip[data-mode="${v === 'go' ? 'go' : 'destroy'}"]`).click(); if (v !== 'go') $(`#dlevel-chips .chip[data-level="${v}"]`).click(); } },
    lv: { list: () => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((lv) => [lv, String(lv)]), now: () => cpuLevel, pick: (v) => $(`#level-chips .chip[data-level="${v}"]`).click() },
    size: { list: () => Object.keys(BOARDS).sort((a, b) => b - a).map((n) => [+n, `${n}路`]), now: () => SIZE, pick: (v) => $(`#size-chips .chip[data-size="${v}"]`).click() },
    time: { list: () => TIME_CHOICES.map((t) => [t, t === 'auto' ? `おすすめ（${AUTO_MINUTES[SIZE]}分）` : t === 'off' ? 'なし' : `${t}分`]), now: () => timeChoice, pick: (v) => $(`#time-chips .chip[data-time="${v}"]`).click() },
  };
  function renderHomeSet() {
    const box = $('#home-set');
    box.classList.toggle('open', homeSetOpen);
    $('#hs-ar').textContent = homeSetOpen ? 'たたむ ▲' : 'ひらく ▼';
    // たたんでいるときは演出だけ出す（ルール・碁盤・持ち時間は「対局開始」に出ている）
    $('#hs-sum').textContent = homeSetOpen ? '' : `演出 黒：${themeOf(themes[BLACK]).label}／白：${themeOf(themes[WHITE]).label}`;
    box.querySelectorAll('.hs-row .chips').forEach((row) => {
      const k = row.dataset.k, items = HOME_SET[k].list();
      if (row.children.length !== items.length || k === 'time') { // 持ち時間の「おすすめ（N分）」は碁盤で変わるので作り直す
        row.textContent = '';
        for (const [v, label] of items) {
          const chip = document.createElement('button');
          chip.className = 'chip rule-chip'; chip.dataset.v = v; chip.textContent = label;
          chip.onclick = () => HOME_SET[k].pick(v);
          row.appendChild(chip);
        }
      }
      row.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.v === String(HOME_SET[k].now())));
    });
    box.querySelector('[data-row="lv"]').hidden = opponent !== 'cpu';
  }
  $('#hs-toggle').onclick = () => { homeSetOpen = !homeSetOpen; lsSet('destroy-go-homeset', homeSetOpen ? '1' : '0'); renderHomeSet(); };
  $('#hs-more').onclick = () => $('#btn-settings').click();
  $('#q-cpu').onclick = () => $('#opp-chips .chip[data-opp="cpu"]').click();
  $('#q-human').onclick = () => $('#opp-chips .chip[data-opp="human"]').click();
  // ⚙ 設定：タブで「対局・演出・音・ルール」を切り替える
  function showSettingsTab(tab) {
    document.querySelectorAll('.sp-tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
    document.querySelectorAll('.sp-panel').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
    $('.sp-body').scrollTop = 0;
  }
  document.querySelectorAll('.sp-tabs button').forEach((b) => { b.onclick = () => showSettingsTab(b.dataset.tab); });
  $('#btn-settings').onclick = () => { $('#settings-pop').hidden = false; };
  $('#settings-close').onclick = $('#settings-ok').onclick = () => { $('#settings-pop').hidden = true; };
  const addChip = (box, text, data, onclick) => {
    const chip = document.createElement('button');
    chip.className = 'chip rule-chip'; chip.textContent = text;
    Object.assign(chip.dataset, data);
    chip.onclick = () => { onclick(); saveOpponent(); renderOpponent(); renderRules(); };
    $(box).appendChild(chip);
  };
  addChip('#opp-chips', '2人で対局', { opp: 'human' }, () => { opponent = 'human'; });
  addChip('#opp-chips', 'コンピューター', { opp: 'cpu' }, () => { opponent = 'cpu'; });
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
  const TIME_CHOICES = ['auto', 3, 5, 7, 10, 'off']; // off：持ち時間なし（この端末で遊ぶときだけ。オンラインでは使わない）
  let timeChoice = 'auto';
  try { const t = localStorage.getItem('destroy-go-time'); const v = t === 'auto' || t === 'off' ? t : +t; if (t && TIME_CHOICES.includes(v)) timeChoice = v; } catch (e) { /* 無視 */ }
  const minutes = () => (timeChoice === 'auto' || timeChoice === 'off' ? AUTO_MINUTES[SIZE] : timeChoice);
  const timeOff = () => timeChoice === 'off';
  const timeText = () => (timeOff() ? '時間なし' : `${minutes()}分`);
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

  // タイトルのルール説明は、対局中の ？ ルールと同じもの。勝ち負けの決め方・碁盤を変えたら、そのタブに合わせる
  const ts = { tab: 'go', size: 19 };
  let tsKey = '';
  function renderTitleRules() {
    const key = `${mode}|${dAdvanced}|${SIZE}`;
    if (key !== tsKey) { tsKey = key; ts.tab = mode === 'destroy' ? (dAdvanced ? 'adv' : 'basic') : 'go'; ts.size = SIZE; }
    renderRulesInto($('#title-rules'), ts);
  }

  function renderRules() {
    document.querySelectorAll('#time-chips .chip').forEach((c) => {
      const t = c.dataset.time === 'auto' || c.dataset.time === 'off' ? c.dataset.time : +c.dataset.time;
      c.setAttribute('aria-pressed', t === timeChoice);
      c.textContent = t === 'auto' ? `おすすめ（${AUTO_MINUTES[SIZE]}分）` : t === 'off' ? 'なし' : `${t}分`;
    });
    document.querySelectorAll('#rule-chips .chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.key === rules));
    document.querySelectorAll('#size-chips .chip').forEach((c) => c.setAttribute('aria-pressed', +c.dataset.size === SIZE));
    renderTitleRules();
    renderOpponent();
  }
  // 今の設定を 1 行で（不具合の報告に入れる）
  function setupSummary() {
    const hc = effectiveHandicap();
    const parts = [mode === 'destroy' ? `デストロイ（${dAdvanced ? '上級' : '初級'}）` : 'ふつうの囲碁',
      opponent === 'cpu' ? `CPU Lv${cpuLevel}` : '2人', `${SIZE}路`, timeText()];
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
    if (homeReady) renderHomeSet(); // たたんでいるときの 1 行に演出も出す
  }

  // 演出の選択肢を作る（隠し要素を解放したら作り直す）
  function buildThemeChips() {
  document.querySelectorAll('.theme-row').forEach((row) => {
    const color = +row.dataset.color;
    const box = row.querySelector('.chips');
    box.textContent = '';
    FX.themes.forEach((t) => {
      if (SEASON_REWARDS[t.key] && !unlocked(t.key)) return; // シーズン報酬は、取るまで並べない（プレビューでは見られる）
      const chip = document.createElement('button');
      chip.className = 'chip'; chip.dataset.key = t.key;
      chip.style.setProperty('--tc', t.color);
      chip.innerHTML = `<span class="mk"></span>`;
      chip.querySelector('.mk').textContent = t.mark;
      chip.appendChild(document.createTextNode(t.label));
      if (!unlocked(t.key)) { // 無料版では選べない（プレビューでは見られる）
        // 鍵のマークだけ出す。解放の条件はひみつで、押すとぼかしたヒントだけ出す
        const how = SECRETS[t.key] ? lockedMsg(t.key) : '製品版で使えます';
        chip.classList.add('locked'); chip.title = how;
        chip.onclick = () => toast(`🔒 ${how}`);
        box.appendChild(chip);
        return;
      }
      chip.onclick = () => {
        // 相手が使っている演出を選んだら、相手と入れ替える（黒と白で同じ演出は使えないため）
        if (clash(themes[otherColor(color)], t.key)) themes[otherColor(color)] = clash(themes[color], t.key) ? themeKeys().find((k) => !clash(k, t.key)) : themes[color];
        previewColor = color; setTheme(color, t.key);
      };
      box.appendChild(chip);
    });
  });
  updatePreviewThemes();
  }
  buildThemeChips();
  // ---------- BGM（音楽：魔王魂 https://maou.audio/ 商用利用可） ----------
  // 無料版は最初の 2 曲。ほかの曲は演出とは別の条件で解放される（when が条件）。製品版は全部
  const BGMS = [
    { key: 'medley02', label: 'メドレー', file: 'assets/bgm/maou_game_medley02.mp3' },
    { key: 'fantasy13', label: 'ファンタジー', file: 'assets/bgm/maou_bgm_fantasy13.mp3' },
    { key: 'fantasy15', label: '冒険', file: 'assets/bgm/maou_bgm_fantasy15.mp3', when: '対局を 10 回終えた（チュートリアルのクリアでも）' },
    { key: 'boss03', label: 'ボス戦', file: 'assets/bgm/maou_game_boss03.mp3', when: 'コンピューター Lv5 以上に勝った' },
    { key: 'lastboss01', label: 'ラスボス', file: 'assets/bgm/maou_game_lastboss01.mp3', when: 'デストロイルールでクリティカルを出した' },
    { key: 'random', label: 'ランダム' }, // 解放されている曲の中から、対局ごとに選ぶ
    { key: 'off', label: 'なし' },
  ];
  const bgmUnlocked = new Set();
  try { for (const k of JSON.parse(localStorage.getItem('destroy-go-bgm-unlocks') || '[]')) bgmUnlocked.add(k); } catch (e) { /* 無視 */ }
  const bgmOk = (b) => !FREE || !b.when || bgmUnlocked.has(b.key);
  function unlockBgm(key, why) {
    const b = BGMS.find((x) => x.key === key);
    if (!b || bgmOk(b)) return;
    bgmUnlocked.add(key);
    try { localStorage.setItem('destroy-go-bgm-unlocks', JSON.stringify([...bgmUnlocked])); } catch (e) { /* 無視 */ }
    buildBgmChips(); track(`BGM「${b.label}」を解放`);
    const el = $('#unlock-pop');
    el.innerHTML = `<b>🎵 BGM「${b.label}」が解放された！</b><small>${why || b.when}。BGM の選択で使えるようになりました</small>`;
    el.style.setProperty('--tc', '#7fe3ff');
    el.className = ''; void el.offsetWidth; el.className = 'show';
    FX.heal();
    saveReminder('解放した BGM'); syncProfile();
  }
  let bgmKey = 'off'; // 最初は鳴らさない（いきなり音が出ると驚くので）。選べばメドレーなどが流れる
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
          chip.classList.add('locked'); chip.title = lockedMsg(b.key);
          chip.onclick = () => toast(`🔒 ${lockedMsg(b.key)}`);
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
  // 演出の選択肢（設定とプレビュー）を、解放したものに合わせて作り直す
  function refreshThemeChoices() { buildThemeChips(); renderThemes(); }
  // 演出プレビューの選択肢も、演出の選択肢と同じものを出す（解放・開発者と分かったときなどに作り直す）
  function updatePreviewThemes() {
    document.querySelectorAll('#pv-themes button').forEach((b) => {
      b.textContent = themeOf(b.dataset.key).label + (unlocked(b.dataset.key) ? '' : '🔒');
      b.hidden = !!SEASON_REWARDS[b.dataset.key] && !unlocked(b.dataset.key);
    });
  }
  // 隠し要素の解放：その端末に記録して、演出の選択肢を作り直し、派手に知らせる
  function unlockSecret(key) {
    if (!FREE || unlocked(key)) return;
    secretUnlocked.add(key);
    try { localStorage.setItem('destroy-go-unlocks', JSON.stringify([...secretUnlocked])); } catch (e) { /* 無視 */ }
    refreshThemeChoices();
    const t = themeOf(key), el = $('#unlock-pop');
    track(`演出「${t.label}」を解放`);
    el.innerHTML = `<b>🔓 「${t.label}」が解放された！</b><small>${SECRETS[key]}。演出の選択で使えるようになりました</small>`;
    el.style.setProperty('--tc', t.color);
    el.className = ''; void el.offsetWidth; el.className = 'show';
    FX.heal();
    saveReminder('解放した演出'); syncProfile();
  }
  for (const color of [BLACK, WHITE]) {
    $('#p' + color + ' .p-theme').onclick = () => {
      if (net && color !== net.color) return; // オンライン対戦では、相手の演出は変えられない
      // 相手が使っている演出は飛ばして次へ
      const keys = themeKeys();
      let i = keys.indexOf(themes[color]);
      do { i = (i + 1) % keys.length; } while (clash(keys[i], themes[otherColor(color)]));
      setTheme(color, keys[i]);
      if (net) Online.send({ t: 'th', c: color, k: themes[color], g: net.g });
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
    // 名前欄・ボタン欄は碁盤より細くしない（画面が低いと碁盤だけ小さくなり、文字が縦に折り返してしまうため）
    const uiWidth = (b) => document.documentElement.style.setProperty('--ui-width', Math.max(b, Math.min(vw - 16, 360)) + 'px');
    let size = fit(2 * 66 + 52 + 38 + 40 + (gameEl.classList.contains('previewing') ? 30 : 0));
    document.documentElement.style.setProperty('--board-size', size + 'px'); uiWidth(size);
    if (gameEl.classList.contains('active')) {
      for (let k = 0; k < 2; k++) {
        size = fit(others());
        document.documentElement.style.setProperty('--board-size', size + 'px'); uiWidth(size);
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
  if (window.visualViewport) window.visualViewport.addEventListener('resize', layout); // アプリ内ブラウザで下の欄が出入りしたとき

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
  const showShields = () => game && (phase === 'play' || phase === 'paused' || phase === 'over' || phase === 'replay' || phase === 'tutorial') && (dstate || hintMode !== 'none' || phase === 'tutorial');
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
    if (hintMode !== 'none' && (phase === 'play' || phase === 'paused' || phase === 'preview' || phase === 'replay')) {
      game.atariStones().forEach(drawAtariCrack);
    }

    // チュートリアルのヒント：打つ場所を光らせる
    if (phase === 'tutorial' && tut.hint >= 0) {
      const [x, y] = game.xy(tut.hint), a = 0.5 + 0.5 * Math.sin(performance.now() / 180);
      g2.strokeStyle = `rgba(255,210,63,${0.5 + 0.5 * a})`; g2.lineWidth = c * 0.12;
      g2.beginPath(); g2.arc(px(x), px(y), c * (0.36 + 0.08 * a), 0, Math.PI * 2); g2.stroke();
      requestAnimationFrame(() => { if (phase === 'tutorial' && tut.hint >= 0) draw(); });
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
    if (phase === 'tutorial') { // ため撃ちのチュートリアルは、正解の場所を長押しで溜める
      const q = TUT[tut.i];
      if (q && q.charge && !tut.solved && p === tutAnswer() && performance.now() >= lockUntil) { const t = game.tryPlay(p); if (t.ok && chargeSteps(t.captured.length).length) { startCharge(p, t.captured, e); return; } }
      tutTap(p); return;
    }
    if (phase !== 'play' || performance.now() < lockUntil || notMyTurn()) return;
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
    if (phase !== 'play' && phase !== 'tutorial') { cancelCharge(); return; }
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
    else if (phase === 'tutorial') tutTap(p, { max, level: Math.min(3, max ? level + 1 : level) });
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
    if (r.captured.length >= 20 && isMine(mover)) later(() => unlockSecret('dark'), hold); // 隠し要素
    if (dstate && dstate.lastHit === 'critical' && isMine(mover)) later(() => unlockBgm('lastboss01'), hold + 4500);
    if (net && mover === net.color && !net.applying) net.out = { t: 'p', p: i, c: chargeLv, x: maxCharge ? 1 : 0, s: dstate && dstate.lastSpurt ? 1 : 0 };
    checkNewEyes(Math.min(hold, 900) + 200);
    finishTurn(mover, hold);
  }

  // ---------- デストロイルール（HP バトル） ----------
  let dstate = null, ruleHist = [];
  // デストロイルールの初めての出来事に、1 回だけ一言の説明を出す（何が起きたか分かるように）
  const DHINTS = {
    dmg: '💥 石を取ると、相手の HP が減る！ HP を 0 にすると K.O. 勝ち',
    crit: '⚡ CRITICAL!! 一度にたくさん取ると、相手の最大 HP の半分の大ダメージ',
    heal: '💚 2眼で取られなくなった石が増えると、HP が回復する',
    recoil: '⚠ ため撃ちで増えたダメージの分だけ、反動で自分の HP も減る（相手を K.O. したときは反動なし）',
    terr: '🏯 終局！ 自分の地 1 目につき、相手に 1 ダメージ（地の総攻撃）',
  };
  function dHint(key) {
    if (phase === 'replay' || lsGet('destroy-go-dhint-' + key)) return;
    lsSet('destroy-go-dhint-' + key, '1');
    const el = $('#dhint');
    el.textContent = DHINTS[key];
    el.className = ''; void el.offsetWidth; el.className = 'show';
    clearTimeout(dHint._t); dHint._t = setTimeout(() => { el.className = ''; }, 4500);
  }
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
    const list = $('#log-list'), replay = phase === 'replay' && rpLogAll, items = replay ? rpLogAll : dlog;
    $('#log-hint').hidden = !replay;
    if (!items.length) { list.innerHTML = '<li class="log-empty">まだダメージは起きていません</li>'; return; }
    list.innerHTML = items.slice().reverse().map((e) => `<li class="log-${e.kind}${replay && e.move > rpIdx ? ' log-future' : ''}" data-move="${e.move}"><span class="log-move">${e.move}手目</span>`
      + `<i class="p-stone ${e.color === BLACK ? 'black' : 'white'}"></i><span class="log-text">${e.text}</span></li>`).join('');
    // ハイライトの再生中は、押すとその手の盤面に飛ぶ
    if (replay) list.querySelectorAll('li[data-move]').forEach((li) => { li.onclick = () => { if (!rec) rpGoTo(+li.dataset.move); }; });
  }
  // ---------- ？ ルール：対局中もいつでも見られる。ノーマル・初級・上級と、碁盤（9・13・19 路）をタブで切り替える ----------
  const rp = { tab: 'go', size: 19 };
  function renderRulesPop() { renderRulesInto($('#rules-body'), rp); }
  // ノーマルの説明は碁盤の大きさで変わらない（変わるのはおすすめの持ち時間だけ）
  function goRulesHTML() {
    const rows = [
      ['打つ順', '黒番から（置き石があるときは白番から）'],
      ['持ち時間', `おすすめ ${[9, 13, 19].map((z) => `${z}路 ${AUTO_MINUTES[z]}分`).join('・')}（設定で${TIME_CHOICES.filter((t) => typeof t === 'number').join('・')}分や「なし」にも変えられる）`],
      ['勝ち負け', Object.keys(RULES).map((k) => `${RULES[k].label}：${RULE_DESC[k]}`).join('<br>')],
      ['コミ', `${Object.keys(RULES).map((k) => `${RULES[k].label} ${RULES[k].komi}目`).join('・')}（置き石ありは0.5目）`],
    ];
    return `<table class="rp-table">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
      <ul class="rp-list">
        <li>1手 <b>5秒以内</b>に打つと余った秒数を加算（1秒で打てば +4秒）。持ち時間は最初の時間より増えない</li>
        <li>5秒を超えると超えた分だけ持ち時間が減る</li>
        <li>持ち時間が0になったら<b>負け</b></li>
        <li>一度に取った石が多いほど<b>ド派手な演出</b>（演出中は時計が止まります）</li>
        <li>演出は黒・白それぞれ「デストロイ／炎／氷／雷／闇／光」から選べます（対局中も名前の横のマークで切替）</li>
        <li>2子以上取れる手は<b>長押しで「ため撃ち」</b>。もっと派手に取れるが、ためている間も自分の時計は進む（ためられる長さは取る数で変わる：2〜3子 1秒／4〜11子 3秒／12子〜 5秒）</li>
        <li>2人連続パスで終局 → 死に石をタップして計算（コンピューター戦では死に石を自動で判定）</li></ul>`;
  }
  function renderRulesInto(box, rp) {
    const tabs = [['go', 'ノーマル'], ['basic', 'デストロイ初級'], ['adv', 'デストロイ上級'], ['words', '用語']]
      .map(([k, l]) => `<button data-rp-tab="${k}" aria-selected="${rp.tab === k}">${l}</button>`).join('');
    let html = `<div class="rp-tabs">${tabs}</div>`;
    if (rp.tab === 'go') {
      html += goRulesHTML();
    } else if (rp.tab === 'words') {
      const go = [
        ['呼吸点', '石のとなり（上下左右）の空いている点。呼吸点が全部ふさがれると、その石は取られる'],
        ['アタリ', '呼吸点があと1つで、次に取られそうな状態。陣地ヒントがオンなら石にひびが入る'],
        ['取る（アゲハマ）', '相手の石を囲んで盤から取り除くこと。取った石の数がアゲハマ'],
        ['地', '自分の石で囲んだ空いている点。終局したとき、地が多いほうが勝ち'],
        ['コミ', '先に打つ黒が有利なので、白に足すハンデの目数（日本ルール 6.5目）'],
        ['置き石', '弱い側（黒）が最初から盤に置いておく石。置き石があると白から打つ'],
        ['コウ', '1子を取り合う形。取られた直後にすぐ取り返すことはできない（1手よそに打ってから）'],
        ['うってがえし', 'わざと1子取らせて、取った石ごと取り返す手筋'],
        ['二眼（2眼）', '石のかたまりの中に、別々の空いている点（眼）が2つある形。相手はどちらにも打てないので、ずっと取られない'],
        ['死に石', '終局のとき、相手の地の中にあって助からない石。計算のときに取り除く'],
        ['パス・終局', '打たずに手番をゆずるのがパス。2人続けてパスすると終局'],
      ];
      const dg = [
        ['にじみ', '<b>デストロイ碁の用語</b>（囲碁のふつうの用語ではありません）。打った石のまわりに、その石の勢力を色でにじませて表示する（陣地ヒント）'],
        ['つながり', '<b>デストロイ碁の用語</b>（囲碁のふつうの用語ではありません）。近くにある味方の石どうしを線で結んで、つながり具合を表示する（陣地ヒント）'],
        ['ため撃ち', '石が取れる手を長押しして溜めてから打つ。演出が派手になる（デストロイ上級ではダメージも増える）'],
        ['HP', 'デストロイルールの体力。石を取られると減り、0 で KO 負け'],
        ['クリティカル', 'デストロイルールで、たくさんまとめて取ったときの大ダメージ'],
        ['即 KO', 'デストロイルールで、もっとたくさんまとめて取ると、HP に関係なく一撃で勝ち'],
        ['地の総攻撃', 'デストロイルールで、パスで終局したときに地 1目につき相手に 1 ダメージを与えること'],
        ['盾マーク', '二眼ができて取られなくなった石に付く印。デストロイ上級では 4子ごとに HP が回復する'],
      ];
      const dl = (list) => `<dl class="rp-words">${list.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
      html += '<h3>囲碁の用語</h3>' + dl(go) + '<h3>デストロイ碁の用語</h3>' + dl(dg);
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
          ['ラストスパート', '×1.5', '盤の 7 割が石で埋まるか、2 人の残り時間の合計が試合時間の 3 分の 2 以下になると、2 人とも 1.5 倍。一度入ったら最後まで続く。最初に入ったとき「LAST SPURT!!」と出る。', '例：3 分の試合なら、2 人の残りの合計が 2 分（黒が残り 1 分半・白が残り 30 秒など）'],
          ['倍率の上限', '2.5倍まで', 'いくつ重なっても、全部掛け合わせて 2.5 倍まで。', '例：ため撃ち×カウンター×ラストスパート＝3.375 → 2.5倍'],
          ['2眼で回復', '+1', '2 眼ができて取られなくなった石（盾マーク）4子ごとに HP が 1 回復。最大 HP を超えたら最大 HP も増える（最初の 2 倍まで）。', ''],
        ];
        html += '<h3>上級で加わる効果</h3>' + fx.map(([k, m, d, ex]) => `<div class="rp-card"><div class="rp-name">${k}<span>${m}</span></div><p>${d}</p>${ex ? `<p class="rp-ex">${ex}</p>` : ''}</div>`).join('');
      } else html += '<p class="rp-note">上級では、ため撃ち・反動・背水・カウンター・コンボ・ラストスパート・2眼の回復が加わる（HP も多い）。</p>';
    }
    if (rp.tab === 'basic' || rp.tab === 'adv') html += '<p class="rp-note">β版のため、シーズンの合間にバランスを調整することがあります。</p>';
    box.innerHTML = html;
    box.querySelectorAll('[data-rp-tab]').forEach((b) => { b.onclick = () => { rp.tab = b.dataset.rpTab; renderRulesInto(box, rp); }; });
    box.querySelectorAll('[data-rp-size]').forEach((b) => { b.onclick = () => { rp.size = +b.dataset.rpSize; renderRulesInto(box, rp); }; });
  }
  $('#btn-rules').onclick = (e) => {
    e.stopPropagation();
    if ($('#rules-pop').hidden) { rp.tab = dstate ? (dstate.advanced ? 'adv' : 'basic') : 'go'; rp.size = SIZE; } // 開くときは今の対局に合わせる
    renderRulesPop(); $('#rules-pop').hidden = !$('#rules-pop').hidden; $('#log-pop').hidden = true; };
  // オンライン対戦の前に、デストロイ碁のルールを見る（上級＝ランクマッチ、初級＝ランダムマッチ）
  function openRulesFor(adv) { rp.tab = adv ? 'adv' : 'basic'; rp.size = 9; renderRulesPop(); $('#rules-pop').hidden = false; $('#log-pop').hidden = true; }
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
  
  // ラストスパート：盤の 7 割が石で埋まるか、2 人の残り時間の合計が試合時間（1 人分の持ち時間）の 3 分の 2 以下。2 人とも入り、一度入ったら最後まで
  //   例：3 分の試合で、黒が残り 1 分半・白が残り 30 秒（合計 2 分）
  let spurtOverride = null; // オンライン対戦で相手の手を再現するときは、相手の画面で決まったラストスパートを使う
  function isSpurt(mover) {
    if (spurtOverride !== null) return spurtOverride;
    if (!dstate || !dstate.advanced) return false;
    let stones = 0; for (const v of game.board) if (v) stones++;
    return dstate.spurtOn || stones >= SIZE * SIZE * DestroyRule.SPURT_FILL || clock.remaining(BLACK) + clock.remaining(WHITE) <= clock.base * DestroyRule.SPURT_TIME;
  }
  // ダメージの履歴に残す（対局中と、ハイライトの再生の両方で使う）
  function logHit(mover, captured, h) {
    if (!captured) return;
    const victim = otherColor(mover);
    if (h.kind === 'ko') logDamage({ color: victim, kind: 'ko', text: `${NAMES[mover]}が ${captured}子 まとめて取って 即 K.O.!!` });
    else logDamage({ color: victim, kind: h.kind === 'critical' ? 'crit' : 'dmg',
      text: `${NAMES[mover]}が ${captured}子取り → ${NAMES[victim]} <b>-${h.amount}</b>${h.tags.length ? `（${h.tags.join('・')}）` : ''}<small>${calcText(h, captured)}</small>` });
    if (h.recoil > 0) logDamage({ color: mover, kind: 'recoil', text: `反動 → ${NAMES[mover]} <b>-${h.recoil}</b><small>${h.amount}（ため撃ち）− ${h.plain}（溜めない）</small>` });
  }
  function logHeal(healed) {
    for (const c of [BLACK, WHITE]) if (healed[c]) logDamage({ color: c, kind: 'heal', text: `2眼で回復 → ${NAMES[c]} <b>+${healed[c]}</b>` });
  }
  function destroyAfterMove(mover, capturedStones, point, maxCharge, hold) {
    const captured = capturedStones.length;
    const spurt = isSpurt(mover);
    if (spurt && !dstate.spurtOn) { // 最初にラストスパートに入ったときに知らせる（待ったで戻したら、もう一度知らせる）
      dstate.spurtOn = true;
      later(() => showBigNote('LAST SPURT!! ダメージ1.5倍', '#ff3b3b'), Math.min(hold, 900) + 1200);
    }
    const h = dstate.hit(mover, captured, { maxCharge, spurt, point, stones: capturedStones }); // 取れなかった手も記録する（コンボ・カウンターのため）
    dstate.lastSpurt = spurt; // 棋譜に残す（再生で同じダメージにするため）
    dstate.lastHit = h.kind; // BGM の解放（クリティカル）に使う
    logHit(mover, captured, h);
    if (captured) {
      const victim = otherColor(mover);
      later(() => {
        if (h.kind === 'ko') popDamage(victim, 'K.O.!!', 'ko');
        else popDamage(victim, `${h.kind === 'critical' ? 'CRITICAL!! ' : ''}-${h.amount}`, h.kind, h.tags);
        showFormula(victim, h, captured);
        dHint(h.kind === 'critical' ? 'crit' : 'dmg');
        renderHp(0, { [mover]: h.recoil || 0 });
      }, Math.min(hold, 900));
      // 反動は、相手へのダメージが出てから自分の側に出す（HP はそのとき減らして見せる）
      if (h.recoil > 0) later(() => {
        popDamage(mover, `反動 -${h.recoil}`, 'recoil');
        showRecoilFormula(mover, h);
        renderHp(); dHint('recoil');
        const box = $('#p' + mover + ' .p-hp');
        box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
      }, Math.min(hold, 900) + 450);
    }
    const healed = dstate.heal(game.board);
    // 回復は「二眼完成！」（+200ms）より少し遅らせて、表示と音が重ならないようにする
    logHeal(healed);
    for (const c of [BLACK, WHITE]) if (healed[c]) later(() => {
      popDamage(c, `+${healed[c]}`, 'heal'); FX.heal();
      showHealFormula(c, healed[c]); dHint('heal');
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
  // ランダムマッチ・ランクマッチのデストロイは、死に石を判定しない（盤の石はすべて生きとして数える。判定のまちがいでもめないように）。
  // 死んでいる石は、パスする前に自分で取りきる（取ればダメージにもなる）
  const noDeadJudge = () => !!(net && dstate && (net.kind === 'random' || net.kind === 'rank'));
  function endByPasses() {
    if (!dstate) { if (net) onlineScore(); else enterScoring(); return; }
    phase = 'over'; clock.stop();
    const serial = gameSerial;
    if (noDeadJudge()) toast('死に石の判定なし：盤の石はすべて生きているものとして地を数えます');
    (noDeadJudge() ? Promise.resolve([]) : deadStones()).then((deadList) => {
      if (serial !== gameSerial) return;
      const sc = game.score(new Set(deadList));
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
            popDamage(victim, `地${terr[c]}目 -${terr[c]}`, terr[c] ? 'critical' : 'normal'); dHint('terr');
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
    if (net && net.out) { Online.send({ ...net.out, g: net.g, r: clock.remain[mover] }); net.out = null; } // 打った手と、打ったあとの持ち時間を相手に送る
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
  // 自分では打てない手番（コンピューターか、オンライン対戦の相手の番）
  const notMyTurn = () => isCpuTurn() || (net && game && game.turn !== net.color);
  // 隠し要素などを数える「自分の手」か（コンピューターやオンラインの相手の手は数えない）
  const isMine = (c) => (net ? c === net.color : !(cpuSide && c === cpuSide));
  function setThinking(on) { for (const c of [BLACK, WHITE]) $('#p' + c).classList.toggle('thinking', on && c === cpuSide); }
  function renderNames() {
    for (const c of [BLACK, WHITE]) {
      const who = net ? (c === net.color ? '（あなた）' : '（相手）') : !cpuSide ? '' : c === cpuSide ? (curFloor > 9 ? `（B${curFloor}F ${BOSSES[curFloor]}）` : `（Lv${cpuLevelInGame} ${BOSSES[cpuLevelInGame]}）`) : '（あなた）';
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
  function doPass(who = '') {
    const mover = game.turn;
    if (dstate) { ruleHist.push(dstate.snapshot()); dstate.pass(mover); }
    const r = game.pass(); if (kifu) kifu.moves.push({ p: -1 });
    toast(`${NAMES[mover]}${who}がパスしました`);
    if (net && mover === net.color && !net.applying) net.out = { t: 'pass' };
    finishTurn(mover);
    if (r.ended) endByPasses();
  }
  function cpuPlay(move) {
    const t = move >= 0 ? game.tryPlay(move) : null;
    if (!t || !t.ok) { doPass('（CPU）'); return; } // パス
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
    if (phase !== 'play' || performance.now() < lockUntil || notMyTurn()) return;
    // ランダム・ランクマッチのデストロイは死に石を判定しないので、初めてパスするときに 1 回だけ知らせる
    if (noDeadJudge() && lsGet('destroy-go-pass-tip') !== '1') {
      lsSet('destroy-go-pass-tip', '1');
      if (!confirm('ランダムマッチ・ランクマッチでは、死に石を判定しません。\n盤の石はすべて生きているものとして地を数えます。\n\n相手の地に残った死んでいる石は、パスする前に取りきろう（取ればダメージにもなる）。\n\nパスしますか？')) return;
    }
    cancelCharge();
    doPass();
  };

  function undoOne() {
    game.undo(); if (kifu) kifu.moves.pop(); if (dstate && ruleHist.length) dstate.restore(ruleHist.pop());
    dlog = dlog.filter((e) => e.move <= game.moveNumber); // 待ったした手の履歴も消す
  }
  $('#btn-undo').onclick = () => {
    if (phase !== 'play' || !game.history.length || net) return;
    usedUndo = true; // 破壊の迷宮の星（待ったなしで勝つと ★2）
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
    const loser = net ? net.color : game.turn; // オンライン対戦では、相手の手番でも自分が投了する
    if (performance.now() > resignArmed) {
      resignArmed = performance.now() + 3000;
      $('#btn-resign').textContent = 'もう一度で投了';
      $('#btn-resign').classList.add('accent');
      setTimeout(() => { if (performance.now() > resignArmed) disarmResign(); }, 3100);
      return;
    }
    disarmResign();
    if (net) Online.send({ t: 'resign', c: loser, g: net.g });
    endGame(`${NAMES[otherColor(loser)]}の中押し勝ち`, `${NAMES[loser]}が投了しました`, otherColor(loser));
  };

  // ---------- 📷 シェア：その瞬間の盤と演出を 1 枚の画像（1080×1350）にして、共有メニューで送る ----------
  const PLAY_URL = 'robit-devworks.github.io/destroy-go-play';
  // 共有する画像・動画に、ダメージ・回復の計算式と「-6」「+1」を入れるか（共有の画面で切り替え。端末に保存）
  let shareDmg = true;
  try { shareDmg = localStorage.getItem('destroy-go-share-dmg') !== '0'; } catch (e) { /* 無視 */ }
  async function captureScene(dmg = shareDmg) {
    const out = document.createElement('canvas');
    out.width = 1080; out.height = 1350;
    try { await document.fonts.load("80px 'Dela Gothic One'"); } catch (e) { /* 無視 */ }
    drawScene(out.getContext('2d'), dmg);
    return out;
  }
  // 1080×1350 の座標で描く（動画では縮めた画面にそのまま描く）
  // 動かない部分（背景・ロゴ・下の文字）は 1 回だけ描いて使い回す（動画を録るときに毎コマ描き直すと重く、絵が遅れて音とずれる）
  let sceneBase = null;
  function sceneBaseCanvas() {
    if (sceneBase) return sceneBase;
    const Wd = 1080, Ht = 1350, c = document.createElement('canvas'); c.width = Wd; c.height = Ht;
    const x = c.getContext('2d');
    const bg = x.createLinearGradient(0, 0, 0, Ht);
    bg.addColorStop(0, '#2a0a0e'); bg.addColorStop(0.5, '#0b0710'); bg.addColorStop(1, '#1a0830');
    x.fillStyle = bg; x.fillRect(0, 0, Wd, Ht);
    // 上：ロゴ
    const lg = x.createLinearGradient(0, 40, 0, 140);
    lg.addColorStop(0, '#fff6c8'); lg.addColorStop(0.4, '#ffcc33'); lg.addColorStop(0.7, '#ff5a1f'); lg.addColorStop(1, '#b3001b');
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = "88px 'Dela Gothic One', sans-serif"; x.fillStyle = lg;
    x.shadowColor = '#ff3b2f'; x.shadowBlur = 24; x.fillText('デストロイ碁', Wd / 2, 100); x.shadowBlur = 0;
    // 下：遊べる場所
    x.font = "bold 34px sans-serif"; x.fillStyle = '#ffd23f';
    x.fillText(PLAY_URL, Wd / 2, Ht - 70);
    x.font = "26px sans-serif"; x.fillStyle = 'rgba(255,255,255,0.6)'; x.fillText('#デストロイ碁 #囲碁　© ROBIT', Wd / 2, Ht - 28);
    // ロゴの文字（Dela Gothic One）が読み込めてから作ったものだけ使い回す
    if (document.fonts && document.fonts.check("88px 'Dela Gothic One'")) sceneBase = c;
    return c;
  }
  function drawScene(x, dmg = shareDmg) {
    const Wd = 1080;
    x.drawImage(sceneBaseCanvas(), 0, 0);
    x.textAlign = 'center'; x.textBaseline = 'middle';
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
    // 「K.O.!! 黒の勝ち」などの大きな知らせ（ハイライトの最後）
    const note = $('#eyes');
    // 消えかけ（見えていない）ときは描かない。ハイライトの動画では、勝ちが決まったあと最後まで出したままにする
    const finished = rec && rpk && rpIdx >= rpk.moves.length;
    if (note.classList.contains('show') && note.textContent && (alphaOf(note) > 0.05 || finished)) {
      x.font = "64px 'Dela Gothic One', sans-serif";
      const w = x.measureText(note.textContent).width;
      if (w > Wd - 80) x.font = `${Math.floor(64 * (Wd - 80) / w)}px 'Dela Gothic One', sans-serif`;
      x.lineWidth = 12; x.strokeStyle = '#1a0005'; x.fillStyle = '#ffd23f';
      x.strokeText(note.textContent, Wd / 2, by + B * 0.62); x.fillText(note.textContent, Wd / 2, by + B * 0.62);
    }
    // ダメージ・回復の計算式（盤の真ん中に出ているもの）と、HP の横に出る「-6」「+1」も描く（動画・画像でも分かるように）
    if (dmg) { drawFormula(x, Wd, by + B * 0.8); drawPops(x, Wd, by + B + 14); }
    // 下：HP（デストロイルール）と、遊べる場所
    x.font = "bold 40px sans-serif"; x.fillStyle = '#fff';
    if (dstate) x.fillText(`黒 HP ${dstate.hp[BLACK]}　／　白 HP ${dstate.hp[WHITE]}`, Wd / 2, by + B + 60);
  }
  const alphaOf = (el) => +getComputedStyle(el).opacity || 0;
  function fitFont(x, text, size, face, maxW) {
    x.font = `${size}px ${face}`;
    const w = x.measureText(text).width;
    if (w > maxW) x.font = `${Math.floor(size * maxW / w)}px ${face}`;
  }
  function drawFormula(x, Wd, cy) {
    const f = $('#dmg-formula');
    if (!f.className.startsWith('show')) return;
    const a = alphaOf(f);
    if (a < 0.05) return;
    // 上から順に 1 行ずつ。反動・回復は区切りの中に同じ形で入っている
    const lines = [];
    const add = (el, group) => {
      for (const c of el.children) {
        if (c.classList.contains('f-recoil')) { add(c, c.classList.contains('f-heal') ? 'heal' : 'recoil'); continue; }
        const kind = c.classList.contains('f-tags') ? 'tags' : c.classList.contains('f-calc') ? 'calc' : 'dmg';
        if (c.textContent.trim()) lines.push({ text: c.textContent.trim(), kind, group });
      }
    };
    add(f, f.classList.contains('heal') ? 'heal' : 'dmg');
    if (!lines.length) return;
    const SZ = { tags: 50, calc: 38, dmg: 30 }, GAP = 14;
    const h = lines.reduce((t, l) => t + SZ[l.kind] + GAP, 0) + 30;
    let y = cy - h / 2;
    x.save(); x.globalAlpha = a;
    x.fillStyle = 'rgba(10, 4, 14, 0.78)'; x.strokeStyle = 'rgba(255, 255, 255, 0.25)'; x.lineWidth = 3;
    x.beginPath(); if (x.roundRect) x.roundRect(60, y, Wd - 120, h, 24); else x.rect(60, y, Wd - 120, h); x.fill(); x.stroke();
    y += 15;
    for (const l of lines) {
      const col = l.kind === 'tags' ? (l.group === 'heal' ? '#7dffa4' : l.group === 'recoil' ? '#ff6a6a' : '#ffd23f')
        : l.kind === 'calc' ? '#fff' : (l.group === 'heal' ? '#b8ffcc' : '#ffb4a0');
      fitFont(x, l.text, SZ[l.kind], l.kind === 'tags' ? "'Dela Gothic One', sans-serif" : 'bold sans-serif', Wd - 180);
      x.fillStyle = col; x.lineWidth = 8; x.strokeStyle = '#000';
      x.strokeText(l.text, Wd / 2, y + SZ[l.kind] / 2); x.fillText(l.text, Wd / 2, y + SZ[l.kind] / 2);
      y += SZ[l.kind] + GAP;
    }
    x.restore();
  }
  function drawPops(x, Wd, y) {
    const COL = { heal: '#5cff8a', ko: '#fff', critical: '#ffd23f', recoil: '#ff7a7a' };
    for (const [c, px0] of [[BLACK, Wd * 0.28], [WHITE, Wd * 0.72]]) {
      const pops = $('#p' + c).querySelectorAll('.dmg-pop');
      const el = pops[pops.length - 1];
      if (!el) continue;
      const a = alphaOf(el);
      if (a < 0.05) continue;
      const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
      const cls = Object.keys(COL).find((k) => el.classList.contains(k));
      x.save(); x.globalAlpha = a;
      fitFont(x, `${NAMES[c]} ${text}`, 52, "'Dela Gothic One', sans-serif", Wd * 0.42);
      x.lineWidth = 10; x.strokeStyle = '#1a0005'; x.fillStyle = COL[cls] || '#ff3b3b';
      x.strokeText(`${NAMES[c]} ${text}`, px0, y); x.fillText(`${NAMES[c]} ${text}`, px0, y);
      x.restore();
    }
  }
  let shareFile = null, shareUrl = null;
  // 共有の文に入れる URL には、どこから来たか分かる目印（ref）を付ける（アクセス解析の「Campaigns」で見られる）
  const SHARE_TEXT = `デストロイ碁で遊んだ！ https://${PLAY_URL}/?ref=share #デストロイ碁 #囲碁`;
  let shareText = SHARE_TEXT; // 撃破カードのときは、倒したボスの名前を入れる
  // 画像か動画を見せて、共有メニュー（スマホ）か保存＋X の投稿画面（パソコン）で送る
  function openShare(blob, name, xOk = true, text = SHARE_TEXT) {
    const video = blob.type.startsWith('video/');
    shareText = text;
    shareFile = new File([blob], name, { type: blob.type });
    if (shareUrl) URL.revokeObjectURL(shareUrl);
    shareUrl = URL.createObjectURL(blob);
    $('#share-img').hidden = video; $('#share-video').hidden = !video;
    if (video) { $('#share-video').src = shareUrl; $('#share-video').play().catch(() => {}); } else $('#share-img').src = shareUrl;
    $('#share-save').href = shareUrl; $('#share-save').download = name;
    $('#share-save').textContent = video ? '動画を保存' : '画像を保存';
    // スマホは共有メニューに X が出る。パソコンの共有メニュー（Windows・Mac）には X が出ないことが多いので、
    // 保存してから X の投稿画面を開くボタンを出す（保存したファイルを添付してもらう）
    const canFiles = !!(navigator.canShare && navigator.canShare({ files: [shareFile] }));
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
    $('#share-go').hidden = !canFiles || !mobile;
    $('#share-x').hidden = mobile && canFiles;
    $('#share-x').textContent = `${video ? '動画' : '画像'}を保存してXで投稿`;
    $('#share-note').textContent = $('#share-x').hidden ? '' : `X の投稿画面が開いたら、保存した${video ? '動画' : '画像'}を添付してください`;
    if (video && !xOk) $('#share-note').textContent = 'このブラウザでは X に載せられない形式（WebM）になります。Chrome か Safari で試してください';
    // ダメージの表示の切り替えは、デストロイルールのときだけ出す
    $('#share-dmg-row').hidden = !(video ? rpk && rpk.mode === 'destroy' : dstate);
    $('#share-dmg').checked = shareDmg; $('#share-redo').hidden = true;
    $('#share-pop').hidden = false;
  }
  // 画像は押した瞬間を、ダメージの表示あり・なしの 2 枚撮っておき、チェックで入れ替える
  let shareImgs = null, shareVideoDmg = null;
  const toPng = (cv) => new Promise((res) => cv.toBlob(res, 'image/png'));
  $('#btn-share').onclick = async () => {
    const on = await captureScene(true), off = await captureScene(false); // 押した瞬間を撮る（演出の途中でも）
    shareImgs = { on: await toPng(on), off: await toPng(off) };
    shareVideoDmg = null;
    openShare(shareImgs[shareDmg ? 'on' : 'off'], 'destroy-go.png');
  };
  // 再生の画面のボタンで、録る前にも選べる（共有の画面のチェックと同じ設定）
  const renderRpDmg = () => { const b = $('#rp-dmg'); b.textContent = `数字${shareDmg ? 'あり' : 'なし'}`; b.setAttribute('aria-pressed', shareDmg); };
  $('#rp-dmg').onclick = () => {
    shareDmg = !shareDmg;
    try { localStorage.setItem('destroy-go-share-dmg', shareDmg ? '1' : '0'); } catch (e) { /* 無視 */ }
    renderRpDmg();
  };
  $('#share-dmg').onchange = () => {
    shareDmg = $('#share-dmg').checked; renderRpDmg();
    try { localStorage.setItem('destroy-go-share-dmg', shareDmg ? '1' : '0'); } catch (e) { /* 無視 */ }
    if (shareVideoDmg === null && shareImgs) openShare(shareImgs[shareDmg ? 'on' : 'off'], 'destroy-go.png');
    else $('#share-redo').hidden = shareDmg === shareVideoDmg; // 動画は作り直す
  };
  $('#share-redo').onclick = () => { $('#share-pop').hidden = true; $('#share-video').pause(); startRec(); };
  $('#share-go').onclick = async () => {
    try { await navigator.share({ files: [shareFile], text: shareText }); }
    catch (e) { /* 閉じただけ */ }
  };
  $('#share-x').onclick = () => {
    $('#share-save').click(); // 先に保存（ダウンロード）してから
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener');
  };
  $('#share-close').onclick = () => { $('#share-pop').hidden = true; $('#share-video').pause(); };
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
    b.hidden = standalone || !isIOS || EMBEDDED; // 押したときの案内は下の openA2hs
  });
  // 「ホーム画面に追加」の手順（iPhone は Safari と Chrome で同じ。Android とパソコンは Chrome のメニューから）
  const isAndroid = /Android/.test(navigator.userAgent);
  $('#a2hs-steps').innerHTML = (isIOS ? [
    'アドレスバーの右にある<b>共有ボタン</b>（□に↑のマーク）を押す。見つからなければ右下の「…」→「共有」',
    '「<b>表示を増やす</b>」を押して、「<b>ホーム画面に追加</b>」を選ぶ',
    'ホーム画面にできた<b>デストロイ碁のアイコン</b>から開く',
  ] : isAndroid ? [
    'Chrome の右上の<b>「⋮」</b>を押す',
    '「<b>ホーム画面に追加</b>」（または「アプリをインストール」）を選ぶ',
    'ホーム画面にできた<b>デストロイ碁のアイコン</b>から開く',
  ] : [
    'Chrome / Edge のアドレスバーの右にある<b>インストールのマーク</b>を押す（なければ右上の「⋮」→「キャスト、保存、共有」→「ページをアプリとしてインストール」）',
    'できた<b>デストロイ碁のアイコン</b>から開く',
  ]).map((t) => `<li>${t}</li>`).join('');
  // mode：'fs'（全画面で遊ぶには）か 'save'（記録が消えないように）
  function openA2hs(mode = 'fs', lead = '') {
    const save = mode === 'save';
    $('#a2hs-title').textContent = save ? '記録が消えないように' : '全画面で遊ぶには';
    const canLink = save && Online.available() && !EMBEDDED, phone = isIOS || isAndroid;
    $('#a2hs-lead').innerHTML = lead; $('#a2hs-lead').hidden = !lead;
    // 記録を守るとき：① 引き継ぎコード（おすすめ）② ホーム画面に追加（スマホだけ。パソコンは閉じても消えないので要らない）
    $('#a2hs-s1').hidden = !canLink;
    $('#a2hs-s2').hidden = !save || !phone;
    $('#a2hs-s2').textContent = canLink ? '② ホーム画面に追加する（さらに安心）' : 'ホーム画面に追加する';
    $('#a2hs-steps').hidden = save && !phone;
    $('#a2hs-note').textContent = !save ? 'アイコンから開くと、ブラウザのバーが消えて画面いっぱいで遊べます。'
      : isIOS ? 'iPhone では、Safari・Chrome・ホーム画面のアイコンで、記録が別々に保存されます。アイコンで遊ぶなら早めに追加しておくのがおすすめです。'
      : phone ? 'アイコンから開くと、ブラウザのバーも消えて画面いっぱいで遊べます。'
      : 'パソコンはブラウザを閉じても記録は消えないので、ホーム画面への追加（インストール）はしなくて大丈夫です。';
    $('#a2hs').hidden = false;
  }
  $('#a2hs-link').onclick = () => { $('#a2hs').hidden = true; openAccount(); };
  $('#a2hs-close').onclick = () => { $('#a2hs').hidden = true; };
  document.querySelectorAll('.fs-btn').forEach((b) => { if (!fsSupported) b.onclick = () => openA2hs('fs'); });

  // ---------- 記録が消えないようにする案内 ----------
  // 解放した演出・BGM・レートなどは、この端末のブラウザ（localStorage）に保存している。
  // アプリの中のブラウザ（X・Instagram・LINE など）は消えやすいので毎回、ふつうのブラウザでは最初の 1 回だけ案内する
  const INAPP = /FBAN|FBAV|Instagram|Line\/|Twitter|TikTok|musical_ly|BytedanceWebview|Discord|Threads|; wv\)/i.test(navigator.userAgent);
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 無視 */ } };
  function askPersist() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* 無視 */ } }
  function renderSaveNote() {
    const el = $('#save-note');
    if (standalone || EMBEDDED) { el.hidden = true; return; }
    if (INAPP) {
      el.className = 'warn';
      $('#save-note-text').innerHTML = '⚠ <b>アプリの中のブラウザだと、記録が消えやすいです。</b>右上の「…」などから <b>Safari / Chrome で開いて</b>遊んでね';
      $('#save-note-how').hidden = true;
      let closed = false; try { closed = sessionStorage.getItem('destroy-go-inapp-closed') === '1'; } catch (e) { /* 無視 */ }
      el.hidden = closed;
      return;
    }
    el.className = '';
    $('#save-note-text').innerHTML = isIOS || isAndroid
      ? '解放した演出・レート・ランキングは、この端末のブラウザに保存されます。<b>引き継ぎコード</b>や<b>ホーム画面に追加</b>で守れます'
      : '解放した演出・レート・ランキングは、このブラウザに保存されます。<b>引き継ぎコード</b>を発行しておくと、データを消しても戻せます';
    $('#save-note-how').hidden = false; $('#save-note-how').textContent = isIOS || isAndroid ? '消えないようにする' : '記録を守る';
    el.hidden = lsGet('destroy-go-save-note') === '1';
  }
  $('#save-note-how').onclick = () => openA2hs('save');
  $('#save-note-close').onclick = () => {
    $('#save-note').hidden = true;
    if (INAPP) { try { sessionStorage.setItem('destroy-go-inapp-closed', '1'); } catch (e) { /* 無視 */ } } else lsSet('destroy-go-save-note', '1');
  };
  renderSaveNote();
  askPersist();
  // 何かを手に入れたとき（初めての解放・初めてのランクマッチ）に 1 回だけ。解放の知らせが消えてから出す
  function saveReminder(what) {
    askPersist();
    if (standalone || EMBEDDED || lsGet('destroy-go-save-remind') === '1') return;
    lsSet('destroy-go-save-remind', '1');
    setTimeout(() => openA2hs('save', INAPP
      ? `${what}は、この端末のブラウザに保存されています。<b>アプリの中のブラウザだと消えやすい</b>ので、Safari / Chrome で開いて、ホーム画面に追加しておくのがおすすめです。`
      : `${what}は、この端末のブラウザに保存されています。<b>ホーム画面に追加</b>しておくと消えにくくなります。`), 4500);
  }
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
  // ランダムマッチの待ち時間に始めた CPU 戦。勝つと「ランクマッチまでの 1 局」に数える（負けや投了では数えない）
  let warmupCpu = false;
  // ---------- 破壊の迷宮・ノンストップ潜行（勝ち抜き戦） ----------
  let usedUndo = false;
  let gauntlet = null; // ノンストップ潜行：{ lv: 今の階, next: 勝って次に進む階 }
  let dojoNext = 0; // 迷宮で勝ったとき、「次の階へ」で進む階
  const starsText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
  // ノンストップ潜行で B9F まで勝ち抜いた人の称号（迷宮の階の称号とは別に、名前の横に並べて出す）
  const NONSTOP_TITLE = '不屈の潜行者';
  const nonstopDone = () => dojo.best >= 9;
  const nonstopBadge = (ns) => (ns ? `<i class="badge-f badge-dojo dj-ns" title="ノンストップ潜行で B9F まで勝ち抜いた">${NONSTOP_TITLE}</i>` : '');
  // 名前の横に出す称号を選ぶ（迷宮の称号と不屈の潜行者の中から 1 つ）。'auto' はいちばん上のもの、'none' は出さない
  const ownedTitles = () => [...[18, 10, 9, 7, 3].filter((lv) => (lv === 10 ? dojoAll3() : dojoCleared(lv))).map((lv) => ({ k: 'd' + lv, name: DOJO_TITLES[lv] })),
    ...(nonstopDone() ? [{ k: 'ns', name: NONSTOP_TITLE }] : [])];
  const chosenTitle = () => {
    const own = ownedTitles(), v = lsGet('destroy-go-title') || 'auto';
    if (v === 'none') return null;
    return own.find((t) => t.k === v) || own[0] || null;
  };
  // ランキングに送る：cl（迷宮の称号の階）と ns（不屈の潜行者）は、選んだ 1 つだけを立てる
  const titleFields = () => { const t = chosenTitle(); return t ? (t.k === 'ns' ? { cl: 0, ns: 1 } : { cl: +t.k.slice(1), ns: 0 }) : { cl: 0, ns: 0 }; };
  const myTitleBadge = () => { const f = titleFields(); return dojoBadge(f.cl) + nonstopBadge(f.ns); };
  function titlePicker() {
    const own = ownedTitles();
    if (own.length < 2) return '';
    const v = lsGet('destroy-go-title') || 'auto';
    const chip = (k, label) => `<button class="chip rule-chip" data-title="${k}" aria-pressed="${v === k}">${label}</button>`;
    return `<div class="on-titles"><span>🏅 名前の横に出す称号</span>${chip('auto', 'いちばん上')}${own.map((t) => chip(t.k, t.name)).join('')}${chip('none', '出さない')}</div>`;
  }
  const dojoBadge = (lv) => (DOJO_TITLES[lv] ? `<i class="badge-f badge-dojo dj-${lv}" title="${lv === 10 ? '破壊の迷宮 全階 ★3' : `破壊の迷宮 B${lv}F 撃破`}">${DOJO_TITLES[lv]}</i>` : '');
  // 星：勝つと ★1、待ったなしで ★2、さらに圧勝（KO・中押し・10 目以上）で ★3。置き石をもらったときは ★1 まで
  function dojoStars(title) {
    const m = title.match(/の([\d.]+)目勝ち/);
    const big = title.startsWith('K.O.') || title.includes('中押し') || (m && +m[1] >= 10);
    const helped = effectiveHandicap() && gameHumanColor() === BLACK;
    return helped ? 1 : usedUndo ? 1 : big ? 3 : 2;
  }
  // 全階 ★3 の報酬：専用の演出「黄金」（取った人だけが使える）
  function grantOugon() { grantFx('ougon'); }
  // 取った人だけが使える演出（黄金・消滅）を使えるようにする
  function grantFx(key) {
    if (secretUnlocked.has(key)) return;
    secretUnlocked.add(key); lsSet('destroy-go-unlocks', JSON.stringify([...secretUnlocked]));
    refreshThemeChoices(); syncProfile(); track(`演出「${themeOf(key).label}」を獲得`);
  }
  // 深淵層の最深部の報酬：まだ解放していない演出（隠し要素）と BGM を全部使えるようにする（ランキング報酬・黄金は別）
  function unlockAll() {
    let changed = false;
    for (const k of Object.keys(SECRETS)) if (!secretUnlocked.has(k)) { secretUnlocked.add(k); changed = true; }
    for (const b of BGMS) if (b.when && !bgmUnlocked.has(b.key)) { bgmUnlocked.add(b.key); changed = true; }
    if (!changed) return;
    lsSet('destroy-go-unlocks', JSON.stringify([...secretUnlocked])); lsSet('destroy-go-bgm-unlocks', JSON.stringify([...bgmUnlocked]));
    refreshThemeChoices(); buildBgmChips(); syncProfile();
  }
  // 深淵層：CPU にハンデ（置き石・HP）を付け、ルールをデストロイにする。もとの設定は覚えておき、迷宮を出たら戻す（保存はしない）
  let curFloor = 0; // 迷宮の何階で戦っているか（0：迷宮の外）
  let stageSaved = null;
  function setAbyss(f) {
    const a = ABYSS[f];
    if (!stageSaved) stageSaved = { mode, handicap, hcWho, hpBonus, hpBonusColor };
    mode = 'destroy'; handicap = a.hc; hcWho = 'cpu'; hpBonus = a.hp;
    hpBonusColor = a.hc ? BLACK : otherColor(humanColor); // HP を上乗せするのは CPU の色（置き石があれば CPU が黒）
  }
  function clearStage() {
    curFloor = 0;
    if (!stageSaved) return;
    ({ mode, handicap, hcWho, hpBonus, hpBonusColor } = stageSaved); stageSaved = null;
    renderMode(); renderRules();
  }
  function renderDojoHome() {
    if (dojoAll3()) grantOugon(); // 引き継ぎなどで達成していたときも
    if (dojoCleared(18)) { unlockAll(); if (CLEAR_READY) grantFx('clear'); }
    const n = dojoCount(), t = DOJO_TITLES[dojoTitleLv()];
    const a = abyssCount();
    $('#dojo-note').textContent = a >= 9 ? `深淵層まで完全制覇！${t ? `（${t}）` : ''}` : abyssOpen() ? `深淵層 ${a} / 9 階 突破${t ? `・${t}` : ''}` : `${n} / 9 階 突破${t ? `・${t}` : ''}`;
  }
  // 結果の画面：CPU 戦なら、ボスを倒したか（星・称号・撃破カード）と、勝ち抜き戦の続き
  function renderDojoResult(title, winner) {
    const box = $('#m-dojo');
    box.hidden = true; box.innerHTML = ''; dojoNext = 0;
    if (!cpuSide || net) return;
    $('#btn-again').textContent = 'もう一局';
    const lv = curFloor > 9 ? curFloor : cpuLevelInGame, boss = BOSSES[lv], win = winner && isMine(winner);
    track(win ? (curFloor ? `迷宮 B${lv}F を撃破` : `CPU Lv${lv} に勝った`) : (curFloor ? `迷宮 B${lv}F で負けた` : `CPU Lv${lv} に負けた`));
    let html = '', shown = 0;
    if (win) {
      const stars = shown = dojoStars(title), first = !dojoCleared(lv), more = stars > (dojo.stars[lv] || 0);
      const hadTitle = dojoTitleLv();
      if (more) { dojo.stars[lv] = stars; saveDojo(); syncProfile(); }
      html += `<p class="dj-win">B${lv}F ${boss} 撃破！</p><p class="dj-stars">${starsText(stars)}${first ? '<b>初撃破</b>' : more ? '<b>星が増えた</b>' : ''}</p>`;
      if (first && lv === 9 && !abyssCount()) html += `<p class="dj-title dj-abyss-open">▼ 迷宮の底に、さらに深い階層への道が開いた…<small>破壊の迷宮の画面で「深淵層」に挑めます</small></p>`;
      if (first && ABYSS_GIFTS[lv]) { html += `<p class="dj-title">🎁 ${ABYSS_GIFTS[lv]}！</p>`; if (lv === 18) { unlockAll(); if (CLEAR_READY) grantFx('clear'); } }
      if (lv === 18) claimPioneer();
      if (stars < 3) html += `<p class="dj-tip">${stars === 1 && usedUndo ? '待ったなしで勝つと ★2' : stars === 1 ? '置き石なし・待ったなしで勝つと ★2' : 'KO・中押し・10目以上の大差で勝つと ★3'}</p>`;
      const newTitle = dojoTitleLv() !== hadTitle && DOJO_TITLES[dojoTitleLv()];
      if (newTitle) track(`称号「${newTitle}」を獲得`);
      if (newTitle) {
        if (dojoTitleLv() === 10) grantOugon();
        html += dojoTitleLv() === 18
          ? `<p class="dj-title dj-master">👑 深淵層の最深部を突破！<br>最上位の称号「${newTitle}」を手に入れた！<small>ランキングで名前の横に出ます</small></p>`
          : dojoTitleLv() === 10
          ? `<p class="dj-title dj-master">👑 全階 ★3 達成！<br>特別な称号「${newTitle}」と、専用の演出「黄金」を手に入れた！<small>称号はランキングで名前の横に、演出は「対局の設定」で選べます</small></p>`
          : `<p class="dj-title">🏅 称号「${newTitle}」を手に入れた！<small>ランキングで名前の横に出ます</small></p>`;
        if (myRating) saveRating();
      }
      html += `<button id="dj-card" class="dj-card">📷 撃破カードをシェア</button>`;
      // 迷宮から挑んだときは、そのまま次の階へ進める（ノンストップ潜行は下で別に扱う）
      const nx = lv < 9 ? lv + 1 : lv === 9 ? 10 : lv < 18 ? lv + 1 : 0;
      if (curFloor && !gauntlet && nx) { dojoNext = nx; $('#btn-again').textContent = `▼ B${nx}F へ進む`; html += `<button id="dj-retry" class="dj-card">↻ この階にもう一度</button>`; }
    } else if (!gauntlet) html += `<p class="dj-lose">B${lv}F ${boss} に敗れた…</p>`;
    if (gauntlet && lv <= 9) {
      if (win && lv < 9) { gauntlet.next = lv + 1; $('#btn-again').textContent = `▼ 次の階へ：B${lv + 1}F ${BOSSES[lv + 1]}`; html += `<p class="dj-g">🔥 ノンストップ潜行：B${lv}F 突破</p>`; }
      else {
        const n = win ? 9 : lv - 1;
        const best = n > dojo.best, firstNs = n >= 9 && !nonstopDone();
        if (best) { dojo.best = n; saveDojo(); syncProfile(); }
        html += `<p class="dj-g">${n >= 9 ? '👑 ノンストップで最深部まで制覇！' : `🔥 ノンストップ潜行 終了：${n ? `B${n}F まで突破` : 'B1F で力尽きた'}`}${best ? '<b>自己ベスト</b>' : ''}</p>`;
        track(n >= 9 ? 'ノンストップ潜行 制覇' : `ノンストップ潜行 B${n}F まで`);
        if (firstNs) track(`称号「${NONSTOP_TITLE}」を獲得`);
        if (firstNs) { html += `<p class="dj-title dj-master">🏅 称号「${NONSTOP_TITLE}」を手に入れた！<small>ランキングで名前の横に出ます</small></p>`; if (myRating) saveRating(); }
        if (n >= 9) html += `<button id="dj-ns-card" class="dj-card dj-ns-card">📷 制覇カードをシェア</button>`;
        gauntlet = null;
      }
    }
    // 次の階のルール（表の階だけ。深淵層はデストロイ固定）
    const nextLv = dojoNext || (gauntlet && gauntlet.next);
    if (nextLv && nextLv <= 9) html += `<div class="dj-rule dj-next-rule"><span>次のルール</span>${HOME_SET.rule.list().map(([v, label]) => `<button class="chip rule-chip" data-v="${v}" aria-pressed="${v === HOME_SET.rule.now()}">${label}</button>`).join('')}</div>`;
    box.innerHTML = html; box.hidden = false;
    if (win) $('#dj-card').onclick = () => dojoCard(lv, shown);
    if ($('#dj-ns-card')) $('#dj-ns-card').onclick = () => nonstopCard();
    if ($('#dj-retry')) $('#dj-retry').onclick = () => { $('#modal').classList.remove('show'); dojoNext = 0; startDojo(lv); };
    box.querySelectorAll('.dj-next-rule .chip').forEach((b) => { b.onclick = () => { HOME_SET.rule.pick(b.dataset.v); box.querySelectorAll('.dj-next-rule .chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.v === HOME_SET.rule.now())); }; });
    renderDojoHome();
  }
  // 撃破カード：倒したボス・星・称号を 1 枚の画像にして共有する
  async function dojoCard(lv, stars) {
    track('撃破カードを作った');
    try { await document.fonts.load("80px 'Dela Gothic One'"); } catch (e) { /* 無視 */ }
    const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const bg = x.createRadialGradient(W / 2, H * 0.42, 50, W / 2, H * 0.42, H * 0.8);
    bg.addColorStop(0, lv > 9 ? '#2a0a4a' : lv === 9 ? '#4a0a2a' : '#3a0d16'); bg.addColorStop(0.6, '#0b0710'); bg.addColorStop(1, '#1a0830');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const fire = (y0, y1) => { const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, '#fff6c8'); g.addColorStop(0.4, '#ffcc33'); g.addColorStop(0.7, '#ff5a1f'); g.addColorStop(1, '#b3001b'); return g; };
    x.font = "80px 'Dela Gothic One', sans-serif"; x.fillStyle = fire(60, 140); x.shadowColor = '#ff3b2f'; x.shadowBlur = 24; x.fillText('デストロイ碁', W / 2, 110); x.shadowBlur = 0;
    x.font = "bold 44px sans-serif"; x.fillStyle = '#ffd23f'; x.fillText(lv > 9 ? '破壊の迷宮・深淵層' : '破壊の迷宮', W / 2, 250);
    x.font = "140px 'Dela Gothic One', sans-serif"; x.fillStyle = '#fff'; x.fillText(`B${lv}F`, W / 2, 420);
    fitFont(x, BOSSES[lv], 96, "'Dela Gothic One', sans-serif", W - 120); x.fillStyle = '#fff'; x.fillText(BOSSES[lv], W / 2, 580);
    x.save(); x.translate(W / 2, 780); x.rotate(-0.08);
    x.font = "190px 'Dela Gothic One', sans-serif"; x.lineWidth = 18; x.strokeStyle = '#1a0005'; x.strokeText('撃破！', 0, 0);
    x.fillStyle = fire(-90, 90); x.shadowColor = '#ff3b2f'; x.shadowBlur = 40; x.fillText('撃破！', 0, 0); x.restore(); x.shadowBlur = 0;
    x.font = "110px sans-serif"; x.fillStyle = '#ffd23f'; x.fillText(starsText(stars), W / 2, 990);
    const t = DOJO_TITLES[dojoTitleLv()];
    x.font = "bold 40px sans-serif"; x.fillStyle = '#e8dcf0';
    x.fillText(lv > 9 ? `深淵層 ${abyssCount()} / 9 階 突破${t ? `　称号「${t}」` : ''}` : `${dojoCount()} / 9 階 突破${t ? `　称号「${t}」` : ''}`, W / 2, 1110);
    x.font = "bold 34px sans-serif"; x.fillStyle = '#ffd23f'; x.fillText(PLAY_URL, W / 2, H - 70);
    x.font = "26px sans-serif"; x.fillStyle = 'rgba(255,255,255,0.6)'; x.fillText('#デストロイ碁 #囲碁　© ROBIT', W / 2, H - 28);
    const blob = await toPng(c);
    shareVideoDmg = null; shareImgs = null;
    openShare(blob, `destroy-go-lv${lv}.png`, true, `デストロイ碁の破壊の迷宮で「B${lv}F ${BOSSES[lv]}」を撃破！${starsText(stars)} https://${PLAY_URL}/?ref=share #デストロイ碁 #囲碁`);
    $('#share-dmg-row').hidden = true;
  }
  // ノンストップ潜行の制覇カード：金色の背景に「ノンストップ制覇」。B1F〜B9F のボスを並べる
  async function nonstopCard() {
    track('制覇カードを作った');
    try { await document.fonts.load("80px 'Dela Gothic One'"); } catch (e) { /* 無視 */ }
    const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const bg = x.createRadialGradient(W / 2, H * 0.4, 40, W / 2, H * 0.4, H * 0.85);
    bg.addColorStop(0, '#fff2b0'); bg.addColorStop(0.25, '#e0a52a'); bg.addColorStop(0.6, '#5a3208'); bg.addColorStop(1, '#140a02');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.save(); x.translate(W / 2, H * 0.4); x.globalAlpha = 0.18; x.fillStyle = '#fff'; // 放射状の光
    for (let i = 0; i < 24; i++) { x.rotate(Math.PI / 12); x.beginPath(); x.moveTo(0, 0); x.lineTo(-60, -H); x.lineTo(60, -H); x.closePath(); x.fill(); }
    x.restore();
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const ink = (font, text, y, fill, stroke = '#2a1400', lw = 14) => { x.font = font; x.lineWidth = lw; x.strokeStyle = stroke; x.lineJoin = 'round'; x.strokeText(text, W / 2, y); x.fillStyle = fill; x.fillText(text, W / 2, y); };
    ink("76px 'Dela Gothic One', sans-serif", 'デストロイ碁', 110, '#fff6c8', '#3a1a00', 12);
    ink("bold 46px sans-serif", '破壊の迷宮', 230, '#fff', '#3a1a00', 10);
    ink("150px 'Dela Gothic One', sans-serif", 'ノンストップ', 420, '#fff', '#3a1a00', 20);
    ink("190px 'Dela Gothic One', sans-serif", '制覇！', 620, '#ffe24a', '#3a1a00', 22);
    ink("bold 44px sans-serif", 'B1F〜B9F を負けずに連続撃破', 800, '#fff', '#3a1a00', 10);
    x.font = "bold 30px sans-serif"; x.fillStyle = '#fff6c8';
    for (let i = 1; i <= 9; i++) { const col = (i - 1) % 3, row = Math.floor((i - 1) / 3); x.fillText(`B${i}F ${BOSSES[i]}`, W / 2 + (col - 1) * 330, 900 + row * 52); }
    ink("bold 50px sans-serif", `称号「${NONSTOP_TITLE}」`, 1110, '#ffe24a', '#3a1a00', 10);
    x.font = "bold 34px sans-serif"; x.fillStyle = '#fff6c8'; x.fillText(PLAY_URL, W / 2, H - 70);
    x.font = "26px sans-serif"; x.fillStyle = 'rgba(255,255,255,0.75)'; x.fillText('#デストロイ碁 #囲碁　© ROBIT', W / 2, H - 28);
    const blob = await toPng(c);
    shareVideoDmg = null; shareImgs = null;
    openShare(blob, 'destroy-go-nonstop.png', true, `デストロイ碁の破壊の迷宮を、ノンストップで最深部まで制覇！（称号「${NONSTOP_TITLE}」） https://${PLAY_URL}/?ref=share #デストロイ碁 #囲碁`);
    $('#share-dmg-row').hidden = true;
  }
  // 迷宮の画面：B1F〜B9F を上から下へ（階段を下りる）。押すとその階のボスと対局。ルールもここで選べる。ノンストップ潜行もここから
  function openDojo() {
    if ($('#dojo-pop').hidden) track('破壊の迷宮を開いた');
    const next = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((lv) => !dojoCleared(lv));
    const floors = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((lv) => {
      const st = dojo.stars[lv] || 0, tl = DOJO_TITLES[lv];
      return `<button class="dj-stage${st ? ' done' : ''}${lv === next ? ' next' : ''}${lv === 9 ? ' boss' : ''}" data-lv="${lv}" style="--depth:${lv}">
        <span class="dj-lv">B${lv}F</span><span class="dj-name">${BOSSES[lv]}${tl ? `<small>🏅 ${tl}</small>` : ''}</span>
        <span class="dj-st">${st ? starsText(st) : lv === next ? '▼ 次はここ' : '☆☆☆'}</span>${st ? '<i class="dj-stamp">突破</i>' : ''}</button>`;
    }).join('');
    const rule = HOME_SET.rule.now();
    $('#dojo-body').innerHTML = `${myPioneer ? `<p class="dj-head">👑 あなたは<b>${pioneerName(myPioneer)}</b>です</p>` : ''}<p class="dj-head">${dojoCount()} / 9 階 突破${DOJO_TITLES[dojoTitleLv()] ? `　称号：<b>${DOJO_TITLES[dojoTitleLv()]}</b>` : ''}</p>
      <div class="dj-rule"><span>ルール</span>${HOME_SET.rule.list().map(([v, label]) => `<button class="chip rule-chip" data-v="${v}" aria-pressed="${v === rule}">${label}</button>`).join('')}</div>
      <div class="dj-floors">${floors}</div>
      ${abyssOpen() ? `<div class="dj-abyss-head">▼ さらに深く… <b>深淵層</b><small>ルールはデストロイ固定。CPU がハンデ（置き石・HP）をもらって待ち構える</small></div>
      <div class="dj-floors abyss">${abyssRows()}</div>` : '<div class="dj-abyss-lock">🔒 B9F の先に、何かがある…</div>'}
      <p class="dj-goal${dojoAll3() ? ' got' : ''}">👑 B1F〜B9F を全部 ★3 で特別な称号：<b>${dojoAll3() ? DOJO_TITLES[10] : '？？？'}</b>（★ ${[1, 2, 3, 4, 5, 6, 7, 8, 9].reduce((t, lv) => t + (dojo.stars[lv] || 0), 0)} / 27）</p>
      <p class="dj-help">★1 勝つ　★2 待ったなしで勝つ　★3 さらに KO・中押し・10目以上の大差<br>碁盤・持ち時間は「対局の設定」のまま</p>
      <button id="dj-gauntlet" class="dj-gauntlet">🔥 ノンストップ潜行<small>B1F から負けるまで休まず潜る（9路）。自己ベスト：${dojo.best ? `B${dojo.best}F` : 'まだなし'}<br>${nonstopDone() ? `🏅 称号「${NONSTOP_TITLE}」獲得済み` : '🏅 B9F まで勝ち抜くと称号がもらえる'}</small></button>`;
    $('#dojo-body').querySelectorAll('.dj-stage').forEach((b) => { b.onclick = () => startDojo(+b.dataset.lv); });
    $('#dojo-body').querySelectorAll('.dj-rule .chip').forEach((b) => { b.onclick = () => { HOME_SET.rule.pick(b.dataset.v); openDojo(); }; });
    $('#dj-gauntlet').onclick = () => { $('#size-chips .chip[data-size="9"]').click(); startDojo(1, true); };
    $('#dojo-pop').hidden = false;
    const nx = $('#dojo-body .dj-stage.next'); if (nx) nx.scrollIntoView({ block: 'nearest' });
  }
  function abyssRows() {
    const next = ABYSS_FLOORS.find((f) => !dojoCleared(f));
    return ABYSS_FLOORS.map((f, i) => {
      const st = dojo.stars[f] || 0, a = ABYSS[f], gift = ABYSS_GIFTS[f], tl = f === 18 && DOJO_TITLES[18]; // 10 は全階 ★3 の称号なので出さない
      const hd = [a.hc ? `置き石${a.hc}` : '', a.hp ? `HP+${a.hp * 100}%` : ''].filter(Boolean).join('・');
      return `<button class="dj-stage${st ? ' done' : ''}${f === next ? ' next' : ''}${f === 18 ? ' boss' : ''}" data-lv="${f}" style="--depth:${i + 1}">
        <span class="dj-lv">B${f}F</span><span class="dj-name">${BOSSES[f]}<small class="dj-hd">Lv${a.lv}・CPU ${hd}</small>${gift ? `<small>🎁 ${gift}</small>` : ''}${tl ? `<small>🏅 ${tl}</small>` : ''}</span>
        <span class="dj-st">${st ? starsText(st) : f === next ? '▼ 次はここ' : '☆☆☆'}</span>${st ? '<i class="dj-stamp">突破</i>' : ''}</button>`;
    }).join('');
  }
  function startDojo(lv, g = false) {
    $('#dojo-pop').hidden = true;
    gauntlet = g ? { lv: 1, next: 0 } : null;
    clearStage(); curFloor = lv;
    $('#opp-chips .chip[data-opp="cpu"]').click();
    $(`#level-chips .chip[data-level="${lv > 9 ? ABYSS[lv].lv : lv}"]`).click();
    if (lv > 9) setAbyss(lv); else $('#hc-chips .chip[data-hc="0"]').click();
    warmupCpu = false; FX.unlock(); newGame();
  }
  function endGame(title, body, winner = 0) {
    if (phase === 'replay') return;
    phase = 'over'; clock.stop(); cancelCharge();
    saveKifu(title, body, winner);
    $('#m-rate').textContent = '';
    if (net) { onlineIdle(); onlineGameEnd(winner); } // 結果の画面のまま放置されたら、接続を切る
    const show = () => {
      $('.m-title').textContent = title;
      $('.m-body').textContent = body;
      renderDojoResult(title, winner); renderNext();
      $('#modal').classList.add('show');
      FX.boom(0.6);
      // 隠し要素：人が勝ったとき（コンピューター戦なら人の側）
      if (winner && isMine(winner)) {
        if (dstate && title.startsWith('K.O.')) later(() => unlockSecret('thunder'), 700);
        if (cpuSide && cpuLevelInGame === 9) later(() => unlockSecret('light'), 700);
        if (cpuSide && cpuLevelInGame >= 5) later(() => unlockBgm('boss03'), 4900); // 演出の解放と重ならないよう後で
        if (warmupCpu && cpuSide && randomPlayed() < RANK_UNLOCK) {
          lsSet('destroy-go-random-played', randomPlayed() + 1); syncProfile(); renderRankTop();
          later(() => toast(rankButtonOpen() ? '🏆 ランクマッチのボタンが押せるようになりました！' : `ランクマッチまで：あと ${rankRandomLeft()} 局（CPU 戦は勝ったときだけ数えます）`), 1200);
        }
        // 上級ルールの CPU 戦で勝った（ランクマッチの開放の条件）
        if (cpuSide && dstate && dstate.advanced && !advCpuWon()) {
          lsSet('destroy-go-adv-cpu-win', '1'); syncProfile(); renderRankTop();
          later(() => toast(rankOpen() ? '🏆 上級ルールで勝った！ランクマッチに入れます' : `上級ルールで勝った！あとはランダムマッチ ${rankRandomLeft()} 局`), 1400);
        }
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
  // 結果の画面で、次の対局の相手・強さ・ルール・碁盤を選ぶ（⚙ 設定の同じボタンを押すので、選んだ内容は保存される）
  const NEXT_CHOICES = {
    opp: [['cpu', 'コンピューター'], ['human', '2人で']],
    lv: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((lv) => [lv, `Lv${lv}`]),
    rule: [['go', 'ふつうの囲碁'], ['simple', 'デストロイ初級'], ['advanced', 'デストロイ上級']],
    size: Object.keys(BOARDS).sort((a, b) => b - a).map((n) => [+n, `${n}路`]),
  };
  // 碁盤の大きさは、今の盤面を描き直すと崩れるので、次の対局を始めるときに変える
  let nextSize = 0;
  const applyNextSize = () => { if (nextSize && nextSize !== SIZE) $(`#size-chips .chip[data-size="${nextSize}"]`).click(); nextSize = 0; };
  const nextNow = { opp: () => opponent, lv: () => cpuLevel, rule: () => (mode === 'destroy' ? (dAdvanced ? 'advanced' : 'simple') : 'go'), size: () => nextSize || SIZE };
  function pickNext(k, v) {
    if (k === 'opp') $(`#opp-chips .chip[data-opp="${v}"]`).click();
    if (k === 'lv') $(`#level-chips .chip[data-level="${v}"]`).click();
    if (k === 'size') nextSize = v;
    if (k === 'rule') {
      $(`#mode-chips .chip[data-mode="${v === 'go' ? 'go' : 'destroy'}"]`).click();
      if (v !== 'go') $(`#dlevel-chips .chip[data-level="${v}"]`).click();
    }
    renderNext();
  }
  function renderNext() {
    const box = $('#m-next');
    box.hidden = !!net || warmupCpu || !!gauntlet || !!dojoNext || curFloor > 9 || phase === 'replay'; // 迷宮で次の階へ進むときは、迷宮の結果のほうでルールを選ぶ // オンライン対戦・ランクマッチまでの CPU 戦・ノンストップ潜行では選べない
    if (box.hidden) return;
    box.querySelectorAll('.chips').forEach((row) => {
      const k = row.dataset.k;
      if (!row.children.length) {
        for (const [v, label] of NEXT_CHOICES[k]) {
          const chip = document.createElement('button');
          chip.className = 'chip rule-chip'; chip.dataset.v = v; chip.textContent = label;
          chip.onclick = () => pickNext(k, v);
          row.appendChild(chip);
        }
      }
      row.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.v) === String(nextNow[k]())));
    });
    box.querySelector('[data-row="lv"]').hidden = opponent !== 'cpu';
  }
  $('#btn-again').onclick = () => {
    if (net) { onlineAgain(); return; }
    $('#modal').classList.remove('show');
    if (dojoNext) { const n = dojoNext; dojoNext = 0; startDojo(n); return; }
    if (gauntlet && gauntlet.next) { gauntlet.lv = gauntlet.next; gauntlet.next = 0; $(`#level-chips .chip[data-level="${gauntlet.lv}"]`).click(); newGame(); return; }
    applyNextSize(); newGame();
  };
  $('#btn-home').onclick = () => { applyNextSize(); warmupCpu = false; gauntlet = null; clearStage(); leaveOnline(); renderBeginner(); renderRankTop(); $('#modal').classList.remove('show'); endReplay(); showScreen('title'); phase = 'title'; stopBgm(); };

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
      el.querySelector('.time').textContent = clock.unlimited ? '∞' : fmt(rem); // 持ち時間なし
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

  // 時間切れが近いことを知らせる：残り 10 秒で 1 秒ごとに「ピッ」と画面のふちが赤く光り、残り 5 秒で「ピピッ」と速く強く光る。
  // 打つ人が自分のときだけ（コンピューターやオンラインの相手の番は鳴らさない）。演出中で時計が止まっているときも鳴らさない。
  // 光らせるのはふちだけで、点滅は 1 秒に 2 回まで（光に敏感な人のため）
  let alertLevel = 0, alertSec = 0;
  function timeAlert() {
    let level = 0, rem = 0;
    if (phase === 'play' && clock && clock.running && !fxHoldStart && !notMyTurn()) {
      rem = clock.remaining(game.turn);
      level = rem <= 0 ? 0 : rem <= 5000 ? 2 : rem <= 10000 ? 1 : 0;
    }
    if (level !== alertLevel) {
      alertLevel = level;
      $('#time-alert').className = level ? 'lv' + level : '';
      gameEl.classList.toggle('time-alert-5', level === 2);
    }
    const sec = level ? Math.ceil(rem / 1000) : 0;
    if (sec && sec !== alertSec) {
      if (level === 2) { FX.blip(1320, 0.07, 'square', 0.14); FX.blip(1320, 0.07, 'square', 0.14, 0.13); } else FX.blip(880, 0.08, 'square', 0.11);
    }
    alertSec = sec;
  }
  function tick() {
    if (phase === 'play' && fxHoldStart) {
      const now = performance.now();
      if (FX.busy() && now - fxHoldStart < FX_HOLD_MAX) { clock.holdNow(); lockUntil = Math.max(lockUntil, now + 100); }
      else fxHoldStart = 0;
    }
    gameEl.classList.toggle('fx-hold', phase === 'play' && fxHoldStart > 0);
    timeAlert();
    if (phase === 'play' || phase === 'paused') {
      const loser = game.turn;
      // オンライン対戦で相手の時間が切れたときは、相手からの知らせを少し待つ（届かなければこちらで決める）
      const waitPeer = net && phase === 'play' && clock.isTimeUp() && loser !== net.color && (net.zeroAt = net.zeroAt || performance.now()) > performance.now() - 5000;
      if (phase === 'play' && clock.isTimeUp() && !waitPeer) {
        updatePanels();
        if (net) Online.send({ t: 'timeout', c: loser, g: net.g });
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
    clock = new GoClock({ base: (net ? net.min : minutes()) * 60 * 1000, unlimited: !net && timeOff() });
    $('#btn-result').hidden = true; $('#btn-again').hidden = false; $('#btn-again').disabled = false;
    $('#btn-undo').hidden = $('#btn-pause').hidden = !!net; // オンライン対戦では待った・一時停止はなし
    if (net) Object.assign(net, { zeroAt: 0, again: {}, out: null, deadIn: null, deadWait: null, peerLeft: false, gone: false, nextOnly: false });
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
    dstate = mode === 'destroy' ? new DestroyRule.DestroyState(SIZE, net ? { color: BLACK, rate: 0 } : { color: hpBonusColor, rate: hpBonus }, dAdvanced) : null; ruleHist = [];
    dlog = []; $('#log-pop').hidden = true; $('#rules-pop').hidden = true; $('#btn-log').hidden = !dstate; // 履歴はデストロイルールのときだけ
    const hc = net ? 0 : effectiveHandicap();
    if (hc) { game.setHandicap(hc); toast(`置き石${hc}子・白から打ちます`); }
    cpuSide = !net && opponent === 'cpu' ? otherColor(gameHumanColor()) : 0;
    // 棋譜（終わったら端末に保存して、あとで見返せる）
    kifu = { date: Date.now(), size: SIZE, rules, mode, adv: dAdvanced, hc, hpb: { color: hpBonusColor, rate: hpBonus },
      cpu: cpuSide ? { side: cpuSide, level: cpuLevel } : null, moves: [], result: null };
    cpuLevelInGame = cpuLevel; cpuResignInGame = cpuResign; usedUndo = false;
    renderNames(); renderHp(); resetEyes();
    clock.start(game.turn);
    updatePanels();
    FX.gameStart();
    if (net) Online.send({ t: 'th', c: net.color, k: themes[net.color], g: net.g }); // 自分の演出を相手に知らせる
    maybeCpuTurn(); // コンピューターが黒なら先に打つ
    if (!net) track(cpuSide ? (curFloor ? `迷宮 B${curFloor}F に挑んだ` : `CPU Lv${cpuLevel} を始めた`) : '2人で対局を始めた');
  }

  $('#btn-start').onclick = () => { FX.unlock(); gauntlet = null; clearStage(); newGame(); };
  $('#btn-dojo').onclick = () => { FX.unlock(); openDojo(); };
  $('#dojo-close').onclick = () => { $('#dojo-pop').hidden = true; };
  // おすすめで始める：コンピューター Lv1・9路・置き石なし（ほかの設定は今のまま）。選んだ内容は保存されるので、次からもそのまま
  $('#btn-beginner').onclick = () => {
    FX.unlock(); clearStage();
    $('#opp-chips .chip[data-opp="cpu"]').click();
    $('#level-chips .chip[data-level="1"]').click();
    $('#hc-chips .chip[data-hc="0"]').click();
    $('#size-chips .chip[data-size="9"]').click();
    newGame();
  };
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
    if (logoHits >= 5) { track('タイトルのロゴを破壊した'); shatterLogo(e.clientX, e.clientY); return; }
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
    b.hidden = !!SEASON_REWARDS[t.key] && !unlocked(t.key); // シーズン報酬は、取った人のプレビューにだけ出す
    b.onclick = () => {
      if (phase !== 'preview') return;
      const mover = previewColor, other = otherColor(mover);
      if (themes[mover] === t.key) { runPreview(); return; }
      // 相手が使っている演出を選んだときは、相手と入れ替える（黒と白で同じ演出は使えないため）
      if (clash(themes[other], t.key)) themes[other] = clash(themes[mover], t.key) ? themeKeys().find((k) => !clash(k, t.key)) : themes[mover];
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
    warmupCpu = false; gauntlet = null; clearStage(); leaveOnline(); renderBeginner(); renderRankTop();
    endReplay(); endTutorial();
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
  // ---------- チュートリアル（はじめての人向け。9 路の盤で 1 問ずつ） ----------
  // type: 'play' は answer に打つと正解、'forbid' は打てない場所に打とうとすると正解、'view' は見るだけ
  const TUT_BASIC = [
    { title: '囲んで取る（真ん中）', type: 'play', b: [[3, 4], [5, 4], [4, 3]], w: [[4, 4]], answer: [4, 5],
      text: '石の上下左右の空いている点を<b>呼吸点</b>と言います。呼吸点が全部ふさがれると、その石は取られます。白はあと1つで取られる<b>アタリ</b>。最後の1か所に打って取ろう！',
      done: '取れた！ 相手の石を囲んで取るのが囲碁の基本です' },
    { title: '囲んで取る（辺）', type: 'play', b: [[3, 0], [5, 0]], w: [[4, 0]], answer: [4, 1],
      text: '盤の端（辺）の石は、呼吸点が3つしかありません。白の石を取ろう！', done: '辺は3方向で取れます' },
    { title: '囲んで取る（角）', type: 'play', b: [[1, 0]], w: [[0, 0]], answer: [0, 1],
      text: '角の石は、呼吸点が2つだけ。白の石を取ろう！', done: '角は2方向で取れます。角や辺の石は取られやすいので気をつけよう' },
    { title: 'まとめて取る', type: 'play', b: [[2, 4], [5, 4], [3, 3], [4, 3], [3, 5]], w: [[3, 4], [4, 4]], answer: [4, 5],
      text: 'つながった石は、かたまり全体の呼吸点を全部ふさぐと<b>まとめて取れます</b>。まとめて取るほど演出が派手に！ 取れる手は<b>長押しで「ため撃ち」</b>もできます（対局で試してね）',
      done: 'まとめて取れた！ たくさん取るほど演出が進化します' },
    { title: '打てない場所（禁止点）', type: 'forbid', b: [], w: [[3, 4], [5, 4], [4, 3], [4, 5]], answer: [4, 4],
      text: '白に囲まれた真ん中の点に、黒で打とうとしてみよう', done: '打てない！ 打った瞬間に取られてしまう場所には打てません（<b>禁止点</b>）' },
    { title: '取れるなら打てる', type: 'play', b: [[3, 3], [5, 3], [4, 2]], w: [[3, 4], [5, 4], [4, 3], [4, 5]], answer: [4, 4],
      text: 'さっきと同じ場所。でも今度は、上の白（アタリ）が取れます。<b>相手の石が取れるなら、禁止点にも打てます</b>。打ってみよう',
      done: '打てた！ 上の白を取ったので、黒の呼吸点ができました' },
    { title: '二眼で生きる', type: 'play', b: [[0, 1], [1, 1], [2, 1], [3, 1], [3, 0]], w: [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [4, 1], [4, 0]], answer: [1, 0],
      text: '石のかたまりの中に、離れた空き（<b>眼</b>）が2つあると、相手はどちらにも打てないので<b>ずっと取られません（二眼）</b>。左上の黒の中に1つ打って、眼を2つに分けよう',
      done: '二眼完成！ 取られなくなった石には<b>盾マーク</b>が付きます' },
    { title: '二眼を作らせない', type: 'play', b: [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [4, 1], [4, 0]], w: [[0, 1], [1, 1], [2, 1], [3, 1], [3, 0]], answer: [1, 0],
      // 黒が急所に打つ → 白が眼を作ろうとして打つ → 黒が最後の呼吸点に打って全部取る
      reply: [2, 0], next: [0, 0],
      replyText: '白は眼を作ろうと、右に打ってきた。でも白の呼吸点は<b>あと1つ</b>（アタリ）！ 最後の1か所に打って、白を全部取ろう',
      text: '今度は白が二眼を作ろうとしています。白が眼を2つに分けたい場所に、<b>先に打って</b>邪魔しよう',
      done: '全部取れた！ 二眼を作れなかった石は、こうして囲んで取りきれます' },
    { title: 'にじみとつながり', type: 'view', hint: 'both', b: [[2, 2], [2, 4], [3, 6], [6, 2]], w: [[6, 6], [5, 4], [6, 4]],
      text: '<b>デストロイ碁の用語</b>です（囲碁のふつうの用語ではありません）。<b>にじみ</b>：石のまわりの色で、その石の勢力の範囲がわかる。<b>つながり</b>：味方の石どうしを結ぶ線で、つながり具合がわかる。設定の「陣地ヒント」で切り替えられます' },
    { title: '勝ち負け', type: 'view', b: [[3, 0], [3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [3, 6], [3, 7], [3, 8]], w: [[5, 0], [5, 1], [5, 2], [5, 3], [5, 4], [5, 5], [5, 6], [5, 7], [5, 8]],
      text: '2人が続けて<b>パス</b>したら終局。自分の石で囲んだ空き（<b>地</b>）が多いほうの勝ちです（この盤なら黒の地は左側、白の地は右側）。<b>デストロイルール</b>では、石を取って相手の HP を 0 にすると KO 勝ち！' },
  ];
  // デストロイルールのチュートリアル。hp：最初の HP（{ b, w }）、pre：その前に起きたこと（コンボ・カウンターの判定用）
  // 初級：HP・ダメージ・クリティカル・K.O.・地の総攻撃（実際にパスして見る）
  const TUT_DESTROY = [
    { title: 'HP バトル', type: 'view', hp: {}, b: [[2, 2], [3, 3], [6, 6]], w: [[6, 2], [5, 5], [2, 6]],
      text: '<b>デストロイルール</b>では、黒と白それぞれに<b>HP</b>（上と下のゲージ）があります。<b>相手の石を取ると相手の HP が減り</b>、<b>0 にしたら K.O. 勝ち</b>。ふつうの囲碁と同じように打ちながら、HP を削り合います' },
    { title: '取るとダメージ', type: 'play', hp: {}, b: [[3, 4], [5, 4], [4, 3]], w: [[4, 4]], answer: [4, 5],
      text: '白の石を取って、白の HP を減らしてみよう（上の白のゲージを見てね）',
      done: '1 子取って <b>2 ダメージ</b>！ まとめて取るほど、1 子あたりのダメージも増えます（1〜3 子は 2、4〜6 子は 3、それ以上は 4）' },
    { title: 'クリティカル', type: 'play', hp: {}, b: [[2, 3], [2, 4], [6, 3], [6, 4], [3, 2], [4, 2], [5, 2], [3, 5], [4, 5]], w: [[3, 3], [4, 3], [5, 3], [3, 4], [4, 4], [5, 4]], answer: [5, 5],
      text: '白の 6 子をまとめて取ろう。<b>9路では 6 子以上</b>まとめて取ると……',
      done: '<b>CRITICAL!!</b> 一度にたくさん取ると、相手の<b>最大 HP の半分</b>のダメージ！ さらに 10 子以上（9路）なら<b>一撃 K.O.</b>' },
    { title: 'K.O. 勝ち', type: 'play', hp: { w: 2 }, b: [[1, 0]], w: [[0, 0]], answer: [0, 1],
      text: '白の HP は残り 2。角の白を取って、<b>とどめ</b>を刺そう！',
      done: '<b>K.O.!!</b> HP を 0 にしたら、地が少なくても<b>その場で勝ち</b>です' },
    { title: '地の総攻撃', type: 'pass', hp: { w: 25 }, b: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((y) => [3, y]), w: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((y) => [6, y]),
      text: 'K.O. しないまま 2 人がパスしたら終局。<b>自分の地 1 目につき、相手に 1 ダメージ</b>を同時に与えます（<b>地の総攻撃</b>）。黒の地は左の 27 目、白の地は右の 18 目。下の「<b>パスする</b>」を押してみよう',
      done: '黒の地 27 目で白に 27 ダメージ → 白の HP 25 は <b>0（K.O.!!）</b>。白の地 18 目で黒は 18 ダメージ、でも HP が残ったので<b>黒の勝ち</b>！ 地が多いほど大ダメージ。2 人とも残ったら<b>HP が多いほうの勝ち</b>' },
  ];
  // 上級：ため撃ち（反動）・背水・カウンター・コンボ・ラストスパート・2眼で回復（実際に打って見る）
  const TUT_ADV = [
    { title: '上級ルール', type: 'view', hp: {}, adv: true, b: [], w: [],
      text: '<b>上級</b>（ランクマッチのルール）は、初級に<b>ダメージが増える決まり</b>と<b>回復</b>が加わります。ため撃ち・背水・カウンター・コンボ・ラストスパート・2眼で回復。1 つずつ打って確かめよう' },
    { title: 'ため撃ち', type: 'play', charge: true, hp: {}, adv: true, b: [[2, 4], [5, 4], [3, 3], [4, 3], [3, 5]], w: [[3, 4], [4, 4]], answer: [4, 5],
      text: '取れる場所を<b>長押し</b>して溜めよう。ゲージが MAX になると自動で打ちます。<b>ダメージ 1.5 倍</b>！ ただし……',
      done: '2 子×2 = 4 が、ため撃ちで <b>6</b> に。でも<b>増えた 2 の分だけ、自分の HP も減ります（反動）</b>。ふだんの撃ち合いでは、相手との HP の差は溜めなくても同じです' },
    { title: 'ため撃ちでとどめ', type: 'play', charge: true, hp: { w: 5 }, adv: true, b: [[2, 4], [5, 4], [3, 3], [4, 3], [3, 5]], w: [[3, 4], [4, 4]], answer: [4, 5],
      text: '白の HP は残り 5。ふつうに取ると 4 ダメージで足りない。<b>長押しで溜めて</b>、とどめを刺そう',
      done: '<b>K.O.!!</b> 相手を K.O. したときは<b>反動を受けません</b>。ため撃ちは<b>とどめの一撃</b>に使うのが得です' },
    { title: '背水', type: 'play', hp: { b: 8 }, adv: true, b: [[2, 3], [2, 4], [5, 3], [5, 4], [3, 2], [4, 2], [3, 5]], w: [[3, 3], [4, 3], [3, 4], [4, 4]], answer: [4, 5],
      text: '黒の HP は残り 8（最大 HP の 4 分の 1 以下）。この状態で白の 4 子を取ろう',
      done: '<b>背水</b>：自分の HP が最大の 4 分の 1 以下のときは、ダメージ <b>1.2 倍</b>。追いつめられてからの逆転のチャンスです' },
    { title: 'カウンター', type: 'play', hp: {}, adv: true, pre: { last: [4, 4] }, b: [[3, 4], [5, 4], [3, 3], [5, 3], [4, 2]], w: [[4, 4], [4, 3]], answer: [4, 5],
      text: '白は今、真ん中の <b>E5</b> に打って黒の石を取ったところ（という場面）。その<b>取りに来た白の石ごと</b>取り返そう',
      done: '<b>COUNTER!!</b> 相手に取られた<b>直後</b>に、<b>相手が今打った石を含めて</b>取り返すと 1.5 倍（打って返しなど）。別の場所の石を取り返すだけではカウンターになりません' },
    { title: 'コンボ', type: 'play', hp: {}, adv: true, pre: { combo: 1 }, b: [[2, 3], [2, 4], [5, 3], [5, 4], [3, 2], [4, 2], [3, 5]], w: [[3, 3], [4, 3], [3, 4], [4, 4]], answer: [4, 5],
      text: '黒は前の手でも石を取った（という場面）。続けて白の 4 子を取ろう',
      done: '<b>2 COMBO!</b> 自分の手番で<b>続けて取る</b>と倍率アップ（2 連続 1.2 倍、3 連続 1.4 倍…最大 2 倍）。取れなかった手やパスで途切れます' },
    { title: 'ラストスパート', type: 'play', spurt: true, hp: {}, adv: true, b: [[2, 3], [2, 4], [5, 3], [5, 4], [3, 2], [4, 2], [3, 5]], w: [[3, 3], [4, 3], [3, 4], [4, 4]], answer: [4, 5],
      text: '終盤（盤の 7 割が石で埋まるか、2 人の残り時間が少なくなった）という場面。白の 4 子を取ろう',
      done: '<b>LAST SPURT</b>：終盤に入ると、最後まで<b>2 人とも 1.5 倍</b>。最後まで逆転があります' },
    { title: '2眼で回復', type: 'play', heal: true, hp: { b: 30 }, adv: true, b: [[0, 1], [1, 1], [2, 1], [3, 1], [3, 0]], w: [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [4, 1], [4, 0]], answer: [1, 0],
      text: '左上の黒の中に打って、眼を 2 つに分けよう（黒の HP は 30）',
      done: '<b>2眼で回復</b>：取られなくなった（2眼の）石 <b>4 子ごとに HP 1 回復</b>。最大 HP をこえた分は最大 HP も増えます（最初の 2 倍まで）' },
    { title: '倍率のまとめ', type: 'view', hp: {}, adv: true, b: [], w: [],
      text: '倍率は<b>全部かけ合わせ</b>ます（ため撃ち×背水×カウンター×コンボ×ラストスパート）。ただし合計は<b>最大 2.5 倍</b>まで。一撃で終わりすぎないようにしています' },
  ];
  let TUT = TUT_BASIC; // 今やっているチュートリアル（囲碁の基本／デストロイルール）
  const tutKey = () => (TUT === TUT_ADV ? 'destroy-go-tut-a' : TUT === TUT_DESTROY ? 'destroy-go-tut-d' : 'destroy-go-tut');
  const tut = { i: 0, solved: false, hint: -1, saved: null, wrong: 0, step: 0 };
  const tutAnswer = () => { const q = TUT[tut.i]; return game.idx(...(tut.step ? q.next : q.answer)); };
  function tutLoad(i) {
    tut.i = i; tut.solved = TUT[i].type === 'view'; tut.hint = -1; tut.wrong = 0; tut.step = 0; lockUntil = 0; tut.finished = null;
    $('#tut-prev').textContent = '◀ 前へ';
    const q = TUT[i];
    FX.clear(); BoardFX.clear(); BoardFX.resetTraces();
    game = new GoGame(9, rules); wiped = new Set(); dead = new Set(); terrGlow = null;
    dstate = q.hp ? new DestroyRule.DestroyState(9, null, !!q.adv) : null; // デストロイルールのチュートリアル（初級・上級）
    if (q.hp && q.hp.w !== undefined) dstate.hp[WHITE] = q.hp.w;
    if (q.hp && q.hp.b !== undefined) dstate.hp[BLACK] = q.hp.b;
    if (q.pre && q.pre.combo) dstate.combo[BLACK] = q.pre.combo;
    if (q.pre && q.pre.last) dstate.last = { mover: WHITE, captured: 1, point: game.idx(...q.pre.last) };
    for (const [x, y] of q.b) game.board[game.idx(x, y)] = BLACK;
    for (const [x, y] of q.w) game.board[game.idx(x, y)] = WHITE;
    game.turn = BLACK;
    hintMode = q.hint || 'none'; resetEyes();
    $('#tut-title').textContent = `${i + 1} / ${TUT.length}　${q.title}`;
    $('#tut-text').innerHTML = q.text;
    tutButtons(); draw(); updatePanels(); renderHp();
    lsSet(tutKey(), i);
  }
  function tutButtons() {
    $('#tut-prev').disabled = tut.i === 0;
    $('#tut-hint').hidden = TUT[tut.i].type === 'view' || TUT[tut.i].type === 'pass' || tut.solved; // 解けたらヒントはいらない
    $('#tut-pass').hidden = TUT[tut.i].type !== 'pass' || tut.solved;
    $('#tut-next').disabled = !tut.solved;
    $('#tut-next').textContent = tut.i === TUT.length - 1 ? 'クリア！ ▶' : '次へ ▶';
  }
  function tutTap(p, opts = {}) {
    const q = TUT[tut.i];
    if (tut.solved || q.type === 'view' || q.type === 'pass' || performance.now() < lockUntil) return;
    const ans = tutAnswer();
    if (q.charge && p === ans && !opts.max) { toast('ため撃ち：その場所を長押しして、MAX まで溜めよう'); return; }
    if (p !== ans) {
      tut.wrong++;
      toast(tut.wrong >= 2 ? '光っている場所に打ってみよう' : 'おしい！ もう一度考えてみよう（💡 ヒントもあるよ）');
      if (tut.wrong >= 2) { tut.hint = ans; draw(); }
      FX.blip(140, 0.12, 'sawtooth', 0.08);
      return;
    }
    tut.hint = -1; tut.wrong = 0;
    if (q.reply && tut.step === 0) { // 途中の手：黒を打ってから、白が打ち返す
      const [x, y] = game.xy(p); game.play(x, y); FX.stoneClick(); draw();
      tut.step = 1; lockUntil = performance.now() + 900;
      later(() => { const [rx, ry] = q.reply; game.play(rx, ry); FX.stoneClick(); $('#tut-text').innerHTML = q.replyText; draw(); }, 700);
      return;
    }
    tut.solved = true;
    if (q.type === 'forbid') { FX.blip(140, 0.12, 'sawtooth', 0.08); showBigNote('打てない！', '#ff6a6a'); }
    else {
      const [x, y] = game.xy(p), r = game.play(x, y);
      if (r.captured.length) {
        const k = canvas.getBoundingClientRect().width / geo.css;
        FX.capture(r.captured.map(stoneScreenPos), WHITE, geo.cell * 0.96 * k, themes[BLACK], opts.level || 0);
        BoardFX.apply(themes[BLACK], FX.tierIndex(r.captured.length), r.captured.map((c) => { const [cx, cy] = game.xy(c); return { x: px(cx), y: px(cy) }; }), geo);
      } else FX.stoneClick();
      checkNewEyes(300);
      if (dstate && r.captured.length) { // デストロイルール：ダメージを見せる
        const n = r.captured.length, h = dstate.hit(BLACK, n, { point: p, stones: r.captured, maxCharge: !!opts.max, spurt: !!q.spurt });
        if (h.recoil > 0) later(() => { popDamage(BLACK, `反動 -${h.recoil}`, 'recoil'); showRecoilFormula(BLACK, h); renderHp(); }, 1200);
        later(() => {
          popDamage(WHITE, h.kind === 'ko' || dstate.hp[WHITE] <= 0 ? 'K.O.!!' : `${h.kind === 'critical' ? 'CRITICAL!! ' : ''}-${h.amount}`, h.kind === 'ko' || dstate.hp[WHITE] <= 0 ? 'ko' : h.kind, h.tags);
          showFormula(WHITE, h, n); renderHp();
        }, 700);
        later(() => showBigNote(dstate.hp[WHITE] <= 0 ? 'K.O.!!' : '正解！', dstate.hp[WHITE] <= 0 ? '#ffd23f' : '#5cff8a'), 1500);
      } else later(() => showBigNote('正解！', '#5cff8a'), r.captured.length ? 900 : 0);
      if (dstate && q.heal) { // 2眼で回復
        const healed = dstate.heal(game.board);
        if (healed[BLACK]) later(() => { popDamage(BLACK, `+${healed[BLACK]}`, 'heal'); FX.heal(); showHealFormula(BLACK, healed[BLACK]); renderHp(); }, 700);
      }
    }
    $('#tut-text').innerHTML = `<span class="tut-ok">⭕ ${q.done}</span>`;
    tutButtons(); draw(); updatePanels();
  }
  function startTutorial(from = 0, course = TUT_BASIC) {
    TUT = course;
    track(course === TUT_ADV ? 'デストロイ上級のチュートリアルを始めた' : course === TUT_DESTROY ? 'デストロイ初級のチュートリアルを始めた' : 'チュートリアルを始めた');
    if (!tut.saved) tut.saved = { size: SIZE, hint: hintMode }; // チュートリアルから次のチュートリアルへ進んだときは、最初の設定を残す
    SIZE = 9; clock = new GoClock({ base: 60000 }); cpuSide = 0;
    gameSerial++; cpuToken++; setThinking(false);
    showScreen('game'); phase = 'tutorial';
    gameEl.classList.remove('scoring', 'previewing', 'replaying'); gameEl.classList.add('tutorial');
    $('#btn-result').hidden = true; $('#btn-log').hidden = true;
    for (const c of [BLACK, WHITE]) $('#p' + c + ' .p-name').firstChild.nodeValue = NAMES[c] + (c === BLACK ? '（あなた）' : '') + ' ';
    layout(); tutLoad(from); renderHp();
  }
  function endTutorial() {
    if (!tut.saved) return;
    SIZE = tut.saved.size; hintMode = tut.saved.hint; tut.saved = null;
    gameEl.classList.remove('tutorial');
  }
  // 地の総攻撃のチュートリアル：黒がパス → 白もパス → 地の多い順に光の弾が飛んで、相手の HP を削る
  function tutPass() {
    const q = TUT[tut.i];
    if (tut.solved || q.type !== 'pass') return;
    tut.solved = true; tutButtons();
    toast('黒がパス → 白もパス。終局！');
    const sc = game.score(new Set()), terr = { [BLACK]: sc.detail[BLACK].territory, [WHITE]: sc.detail[WHITE].territory };
    const left = { [BLACK]: dstate.hp[BLACK] - terr[WHITE], [WHITE]: dstate.hp[WHITE] - terr[BLACK] };
    later(() => showBigNote('地の総攻撃！', '#ffd23f'), 600);
    const order = terr[BLACK] <= terr[WHITE] ? [BLACK, WHITE] : [WHITE, BLACK];
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
          popDamage(victim, `地${terr[c]}目 -${terr[c]}`, 'critical');
          dstate.hp[victim] = Math.max(0, left[victim]); renderHp(); FX.boom(0.3 + Math.min(0.5, terr[c] / 60));
        }, Math.max(600, ms - 200));
      }, 500);
    }, 1400 + k * 2300));
    later(() => {
      if (dstate.hp[WHITE] <= 0) showBigNote('K.O.!!', '#ff3b3b');
      $('#tut-text').innerHTML = `<span class="tut-ok">⭕ ${q.done}</span>`;
      tutButtons();
    }, 1400 + 2 * 2300 + 400);
  }
  $('#tut-pass').onclick = tutPass;
  // クリアしたあと：左は「ホームへ」、右は次のチュートリアル（上級のあとは上級の CPU 戦）
  function tutFinish(next, label) {
    tut.finished = next;
    $('#tut-prev').disabled = false; $('#tut-prev').textContent = '🏠 ホームへ';
    $('#tut-next').disabled = false; $('#tut-next').textContent = label;
    $('#tut-hint').hidden = true; $('#tut-pass').hidden = true;
  }
  $('#tut-prev').onclick = () => { if (tut.finished) { goTitle(); return; } if (tut.i > 0) tutLoad(tut.i - 1); };
  $('#tut-hint').onclick = () => { tut.hint = tutAnswer(); draw(); };
  $('#tut-next').onclick = () => {
    if (tut.finished) {
      const nx = tut.finished; tut.finished = null;
      if (nx === 'cpu') { // 上級のルールで CPU と戦ってみる（9路・Lv1）
        goTitle(); HOME_SET.rule.pick('advanced'); $('#opp-chips .chip[data-opp="cpu"]').click();
        $('#level-chips .chip[data-level="1"]').click(); $('#size-chips .chip[data-size="9"]').click(); $('#btn-start').click();
      } else openTutorialCourse(nx);
      return;
    }
    if (!tut.solved) return;
    if (tut.i < TUT.length - 1) { tutLoad(tut.i + 1); return; }
    if (TUT === TUT_DESTROY || TUT === TUT_ADV) {
      const adv = TUT === TUT_ADV;
      lsSet(adv ? 'destroy-go-tut-a-done' : 'destroy-go-tut-d-done', '1'); track(adv ? 'デストロイ上級のチュートリアルをクリアした' : 'デストロイ初級のチュートリアルをクリアした');
      showBigNote(adv ? 'デストロイ上級 クリア！' : 'デストロイ初級 クリア！', '#ffd23f');
      $('#tut-title').textContent = 'クリア！';
      $('#tut-text').innerHTML = adv ? 'おつかれさま！ 上級のしくみもばっちり。<b>デストロイ上級</b>の CPU 戦で試して、ランクマッチに挑もう！'
        : 'おつかれさま！ これで HP バトルのしくみはばっちり。次は、ため撃ちなどが加わる<b>デストロイ上級</b>へ進もう！';
      tutFinish(adv ? 'cpu' : TUT_ADV, adv ? '上級で CPU と戦う ▶' : 'デストロイ上級へ ▶');
      return;
    }
    // クリア：ご褒美は BGM「冒険」（10 局遊んでも手に入る）
    try { localStorage.setItem('destroy-go-tut-done', '1'); } catch (e) { /* 無視 */ }
    track('チュートリアルをクリアした');
    unlockBgm('fantasy15', 'チュートリアルをクリアした');
    showBigNote('チュートリアル クリア！', '#ffd23f');
    $('#tut-title').textContent = 'クリア！';
    $('#tut-text').innerHTML = 'おつかれさま！ これで対局を始められます。まずは「おすすめで始める」（コンピューター Lv1・9路）がおすすめ。<br>石を取ると HP が減る<b>デストロイルール</b>は、「📖 チュートリアル」の「デストロイ初級」で覚えられます！';
    tutFinish(TUT_DESTROY, 'デストロイ初級へ ▶');
  };
  // 📖 チュートリアル：「囲碁の基本」か「デストロイルール」を選ぶ（途中までやっていたら続きから）
  function openTutorialCourse(course) {
    TUT = course;
    const from = Math.min(TUT.length - 1, +(lsGet(tutKey()) || 0));
    FX.unlock(); startTutorial(from > 0 && !confirmFrom(from) ? 0 : from, course);
  }
  $('#btn-tutorial').onclick = () => { $('#tut-pick').hidden = false; };
  $('#tut-pick-basic').onclick = () => { $('#tut-pick').hidden = true; openTutorialCourse(TUT_BASIC); };
  $('#tut-pick-destroy').onclick = () => { $('#tut-pick').hidden = true; openTutorialCourse(TUT_DESTROY); };
  $('#tut-pick-adv').onclick = () => { $('#tut-pick').hidden = true; openTutorialCourse(TUT_ADV); };
  $('#tut-pick-close').onclick = () => { $('#tut-pick').hidden = true; };
  $('#btn-tutorial-sm').onclick = () => $('#btn-tutorial').onclick();
  // はじめての人向けの案内（チュートリアル・おすすめで始める）は、チュートリアルを終えたか 1 局でも遊んだら隠す。
  // チュートリアルは、下の小さいボタンからいつでも開ける
  function renderBeginner() {
    let seen = false;
    try { seen = localStorage.getItem('destroy-go-tut-done') === '1' || +(localStorage.getItem('destroy-go-played') || 0) > 0; } catch (e) { /* 無視 */ }
    $('.beginner').hidden = false; $('#btn-tutorial-sm').hidden = true; void seen; // 案内はいつも出す
  }
  renderBeginner();
  // メンテナンスのお知らせ：始まる前は予告、始まったら「メンテナンス中」。終わったら on を false にする
  const MAINT = { on: true, start: new Date('2026-10-26T21:30:00+09:00'), label: '10月26日（月）21:30' };
  function renderMaint() {
    const el = $('#maint-note');
    if (!MAINT.on) { el.hidden = true; return; }
    el.innerHTML = Date.now() < MAINT.start
      ? `<b>⚠ 緊急メンテナンスのお知らせ</b><br>${MAINT.label} から<br>緊急メンテナンスを行います。<br>一部の機能が使えないことがあります。`
      : '<b>⚠ ただいま緊急メンテナンス中です</b><br>一部の機能が使えないことがあります。<br>終わりしだいお知らせします。ご迷惑をおかけします。';
    el.hidden = false;
  }
  renderMaint(); setInterval(renderMaint, 60000);
  // はじめて開いた人には、チュートリアルをやるか 1 回だけ聞く（強制はしない。チュートリアルを終えた・1 局でも遊んだ人には出さない）
  (function askTutorial() {
    const ask = !lsGet('destroy-go-tut-asked') && lsGet('destroy-go-tut-done') !== '1' && !(+lsGet('destroy-go-played') > 0);
    if (!ask || EMBEDDED) return;
    const done = () => { lsSet('destroy-go-tut-asked', '1'); $('#tut-ask').hidden = true; };
    $('#tut-ask-go').onclick = () => { done(); FX.unlock(); startTutorial(0); };
    $('#tut-ask-skip').onclick = () => { done(); track('チュートリアルをスキップした'); };
    $('#tut-ask').hidden = false;
  })();
  // 途中まで進めていたら、続きから始めるか聞く（埋め込み環境では confirm が使えないことがあるので、使えなければ続きから）
  function confirmFrom(i) { try { return window.confirm(`前回の続き（${i + 1}問目）から始めますか？\n「キャンセル」で最初から`); } catch (e) { return true; } }

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
  let rpLogAll = null; // ハイライトで見る、対局全体のダメージの履歴
  function rpReset() {
    clearTimeout(rpTimer);
    FX.clear(); BoardFX.clear(); BoardFX.resetTraces();
    game = new GoGame(SIZE, rpk.rules);
    if (rpk.hc) game.setHandicap(rpk.hc);
    dstate = rpk.mode === 'destroy' ? new DestroyRule.DestroyState(SIZE, rpk.hpb, rpk.adv) : null;
    wiped = new Set(); dead = new Set(); terrGlow = null; rpIdx = 0;
    dlog = [];
    $('#eyes').className = ''; // 対局の最後の「K.O.!!」などが残らないように（ハイライトの最後に出し直す）
  }
  // 1 手置く。animate なら石を取る演出・ダメージも見せる。演出の長さ（ms）を返す
  // showHeal：石を取らない手でも、2 眼の回復は見せる（ハイライトの自動再生で使う）。回復したかは rpHealed に残す
  let rpHealed = false;
  function rpApply(animate, showHeal = animate) {
    rpHealed = false;
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
      logHit(mover, r.captured.length, h); logHeal(healed); // 再生でもダメージの履歴を作る（📜 で見られる）
      if (animate && r.captured.length) {
        const victim = otherColor(mover), n = r.captured.length;
        later(() => {
          popDamage(victim, h.kind === 'ko' ? 'K.O.!!' : `${h.kind === 'critical' ? 'CRITICAL!! ' : ''}-${h.amount}`, h.kind, h.tags);
          showFormula(victim, h, n); renderHp();
        }, Math.min(hold, 900));
        if (h.recoil > 0) later(() => { popDamage(mover, `反動 -${h.recoil}`, 'recoil'); showRecoilFormula(mover, h); }, Math.min(hold, 900) + 450);
      }
      rpHealed = !!(healed[BLACK] || healed[WHITE]);
      if (showHeal) for (const c of [BLACK, WHITE]) if (healed[c]) later(() => { popDamage(c, `+${healed[c]}`, 'heal'); FX.heal(); showHealFormula(c, healed[c]); renderHp(); }, Math.min(hold, 900) + 650);
    }
    return hold;
  }
  function rpRender() {
    draw(); renderHp(); updatePanels();
    if (!$('#log-pop').hidden) renderLog();
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
  // 早送りの速さ（何も起きない手）。等倍は 1 手 0.88 秒。押すたびに ×2 → ×4 → ×8 と切り替わる
  const RP_SPEEDS = [2, 4, 8], RP_STEP = 880;
  let rpSpeed = 8;
  try { const v = +localStorage.getItem('destroy-go-rp-speed'); if (RP_SPEEDS.includes(v)) rpSpeed = v; } catch (e) { /* 無視 */ }
  const renderRpSpeed = () => { $('#rp-speed').textContent = `⏩×${rpSpeed}`; };
  $('#rp-speed').onclick = () => {
    rpSpeed = RP_SPEEDS[(RP_SPEEDS.indexOf(rpSpeed) + 1) % RP_SPEEDS.length];
    try { localStorage.setItem('destroy-go-rp-speed', rpSpeed); } catch (e) { /* 無視 */ }
    renderRpSpeed();
  };
  renderRpSpeed();
  function rpAutoStep() {
    if (rpIdx >= rpk.moves.length) { rpTimer = 0; rpFinish(); rpRender(); return; }
    const mv = rpk.moves[rpIdx];
    const t = mv.p >= 0 ? game.tryPlay(mv.p) : null, event = t && t.ok && t.captured.length > 0;
    const before = game.atariStones();
    const hold = rpApply(event, true);
    if (!event && mv.p >= 0) FX.stoneClick(); // 石を置く音（ハイライト・共有の動画でも聞こえるように）
    const atari = [...game.atariStones()].some((i) => !before.has(i)); // 新しくアタリになった（石にひびが入った）
    rpRender();
    // 石を取った手・2 眼で回復した手は止まって見せ、アタリになった手は等倍。何も起きない手は早送り
    rpTimer = setTimeout(rpAutoStep, event ? Math.max(1800, hold + 1500) : rpHealed ? 1800 : atari ? RP_STEP : RP_STEP / rpSpeed);
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
    $('#btn-result').hidden = true;
    $('#btn-log').hidden = k.mode !== 'destroy'; $('#log-pop').hidden = true; // デストロイルールの対局なら、再生中も 📜 履歴が見られる
    layout(); rpReset();
    // 履歴は対局全体の分を先に作っておく（まだ再生していない手の分は薄く出す）
    if (k.mode === 'destroy') { while (rpIdx < k.moves.length) rpApply(false); rpLogAll = dlog; rpReset(); } else rpLogAll = null;
    $('#rp-dmg').hidden = k.mode !== 'destroy'; renderRpDmg(); // ダメージの数字はデストロイルールのときだけ
    renderNames(); renderThemes(); rpRender();
  }
  function endReplay() {
    stopRec(true); rpLogAll = null;
    if (!rpSaved) return;
    $('#log-pop').hidden = true; $('#btn-log').hidden = true;
    rpStop(); SIZE = rpSaved.size; Object.assign(themes, rpSaved.themes); rpSaved = null; rpk = null;
    gameEl.classList.remove('replaying'); renderThemes();
  }
  // ---------- 📤 共有：ハイライトを動画にする：最初から自動再生しながら、📷 と同じ画面（720×900）に描いて録画する ----------
  // 音は効果音だけ入れる（BGM は入れない）。X に載せられる長さ（2 分 20 秒）を超えないよう 2 分 15 秒で止める
  let rec = null;
  const REC_MAX = 135000;
  // X に載せられるのは H.264 の mp4。Chrome・Edge は avc1 を指定すると H.264 で録れる。Safari は mp4 だけ（中身は H.264）。
  // H.264 で録れないブラウザでは WebM にして、そのことを知らせる
  function recType() {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
    const ok = (t) => MediaRecorder.isTypeSupported(t);
    const h264 = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1'].find(ok);
    if (h264) return { type: h264, x: true };
    if (ok('video/mp4') && !ok('video/webm')) return { type: 'video/mp4', x: true }; // Safari
    const webm = ['video/webm;codecs=vp9,opus', 'video/webm'].find(ok);
    return webm ? { type: webm, x: false } : null;
  }
  async function startRec() {
    track('共有の動画を作った');
    const rt = recType();
    if (!rt) { toast('この端末では動画にできません（📷 で画像ならシェアできます）'); return; }
    const type = rt.type;
    try { await document.fonts.load("80px 'Dela Gothic One'"); } catch (e) { /* 無視 */ }
    const out = document.createElement('canvas'); out.width = 720; out.height = 900;
    const x = out.getContext('2d'), stream = out.captureStream(30);
    const actx = FX.unlock();
    let dest = null, keep = null;
    if (actx && actx.createMediaStreamDestination) {
      dest = actx.createMediaStreamDestination(); actx.master.connect(dest);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      // 音が鳴っていない間は音のデータが途切れ、再生や X への投稿でその分が詰められて、あとの音が早く聞こえる。
      // 聞こえないほど小さな音を流し続けて、途切れないようにする
      if (actx.createConstantSource) { keep = actx.createConstantSource(); keep.offset.value = 0.0003; keep.connect(dest); keep.start(); }
    }
    const chunks = [], mr = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4000000 });
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec = { mr, dest, keep, actx, chunks, type, xOk: rt.x, dmg: shareDmg, t0: performance.now(), endAt: 0 };
    gameEl.classList.add('recording'); document.body.classList.add('rec-light'); $('#rp-rec').textContent = '■ やめる';
    toast('ハイライトを動画にしています。終わったら共有できます');
    mr.start(250);
    rpGoTo(0); FX.clear(); rpAutoStep();
    const frame = () => {
      if (!rec || rec.mr !== mr) return;
      x.save(); x.scale(720 / 1080, 720 / 1080); drawScene(x, rec.dmg); x.restore();
      const now = performance.now();
      if (!rpTimer && rpk && rpIdx >= rpk.moves.length && !rec.endAt) rec.endAt = now + 3000; // 最後の演出を見せてから止める
      if ((rec.endAt && now >= rec.endAt) || now - rec.t0 > REC_MAX) { stopRec(false); return; }
      requestAnimationFrame(frame);
    };
    frame();
  }
  function stopRec(cancel) {
    if (!rec) return;
    const r = rec; rec = null;
    gameEl.classList.remove('recording'); document.body.classList.remove('rec-light'); $('#rp-rec').textContent = '📤 共有';
    r.mr.onstop = () => {
      if (r.dest) try { r.actx.master.disconnect(r.dest); } catch (e) { /* 無視 */ }
      if (r.keep) try { r.keep.stop(); r.keep.disconnect(); } catch (e) { /* 無視 */ }
      if (cancel || !r.chunks.length) return;
      const blob = new Blob(r.chunks, { type: r.type.split(';')[0] });
      shareVideoDmg = r.dmg; shareImgs = null;
      openShare(blob, `destroy-go-highlight.${/mp4/.test(r.type) ? 'mp4' : 'webm'}`, r.xOk);
    };
    r.mr.stop();
    if (cancel) { rpStop(); rpRender(); }
  }
  $('#rp-rec').onclick = () => { if (rec) { stopRec(true); toast('録画をやめました'); } else startRec(); };
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
    if (document.hidden && phase === 'play' && !net) $('#btn-pause').onclick(); // オンライン対戦は止められない
    // 別のアプリやタブに移ったら BGM も止める（戻ったら続きから）
    if (document.hidden) stopBgm(); else if (phase !== 'title' && phase !== 'preview') playBgm();
  });

  // ---------- オンライン対戦（β）：合言葉の部屋で、打った手を送り合う ----------
  // 部屋を作った人の設定（碁盤・ルール・持ち時間）で対局する。色は部屋を作った人がランダムに決め、もう一局ごとに入れ替える。
  // 待った・一時停止はなし。パスで終局したら死に石は自動で判定する（部屋を作った人の画面で判定して送る）
  const onlineHandlers = { onMove: (m) => onlineMove(m), onPeer: (e) => onlinePeer(e) };
  const settingText = (st) => `${st.size}路・${st.mode === 'destroy' ? `デストロイ${st.adv ? '上級' : '初級'}` : `ふつうの囲碁（${RULES[st.rules].label}）`}・持ち時間${st.min}分`;
  function onlineView(html) { $('#online-body').innerHTML = html; }
  // ランダムマッチ（β）のルール。人が少ないうちは分かれないよう 1 つだけ。ランクマッチは上級でレートが動く
  // ランダムマッチ：ふだんは 9 路・3 分、週末（日本時間の土日）は 13 路・5 分。待合室は 1 つのまま（ルールは部屋を作った側のものになる）
  // 対戦タイム：人が集まりやすいように決めた時間（毎晩 21〜23 時・日本時間）。時間外でもマッチはできる
  const BATTLE_FROM = 21, BATTLE_TO = 23;
  const isBattleTime = () => { const h = new Date(Date.now() + 9 * 3600000).getUTCHours(); return h >= BATTLE_FROM && h < BATTLE_TO; };
  const isWeekend = () => [0, 6].includes(new Date(Date.now() + 9 * 3600000).getUTCDay());
  const randomRule = () => (isWeekend() ? { size: 13, mode: 'destroy', adv: false, rules: 'japanese', min: 5 } : { size: 9, mode: 'destroy', adv: false, rules: 'japanese', min: 3 });
  const RANK_RULE = { size: 9, mode: 'destroy', adv: true, rules: 'japanese', min: 3 };
  // ランクマッチの開放：ランダムマッチ（待ち時間の CPU 戦の勝ちも含む）を 3 局でボタンが押せるようになり、
  // 押すと、上級ルールの CPU 戦で 1 勝するよう案内する（上級を一度体験してからランクマッチに入る）。前にランクマッチを遊んだ人はそのまま
  const RANK_UNLOCK = 3;
  const advCpuWon = () => lsGet('destroy-go-adv-cpu-win') === '1';
  const rankPlayedBefore = () => lsGet('destroy-go-rank-played') === '1';
  const rankButtonOpen = () => rankPlayedBefore() || randomPlayed() >= RANK_UNLOCK;
  const rankOpen = () => rankPlayedBefore() || (randomPlayed() >= RANK_UNLOCK && advCpuWon());
  const rankRandomLeft = () => (rankButtonOpen() ? 0 : RANK_UNLOCK - randomPlayed());
  function rankLockText() {
    const r = rankRandomLeft();
    return r ? `ランダムマッチ（または待ち時間の CPU 戦の勝ち）あと ${r} 局` : !rankOpen() ? '上級ルールの CPU 戦で 1 勝' : '';
  }
  const randomPlayed = () => { try { return +localStorage.getItem('destroy-go-random-played') || 0; } catch (e) { return 0; } };
  // ---------- レート・ランキング ----------
  // 名前はゲームが組み合わせて作る（ふさわしくない名前が出ないように）。気に入らなければ引き直せる
  // 名前ガチャ：「〇〇の」＋「△△」＋2けたの数字。たまにレアな言葉が出て、片方なら金色（レア）、両方なら虹色（伝説）になる。
  // レアかどうかは名前の言葉で決まるので、ほかの人の画面でも同じ色で見える
  const NAME_A = ['燃える', '凍える', '光る', '荒ぶる', '静かな', '眠れる', '無敵の', '謎の', '疾風の', '雷鳴の', '孤高の', '見習いの', '伝説の', '爆裂の', '漆黒の', '純白の', '気まぐれな', 'はらぺこの',
    '暴走する', '怒れる', '笑う', '踊る', '泣き虫の', '真夜中の', '真紅の', '蒼き', '黄金の', '鋼の', '紅蓮の', '氷結の', '灼熱の', '電光の', '轟く', '砕ける', '崩れる', '目覚めた',
    '迷える', 'のんびり', 'せっかちな', 'ねむい', 'まったり', '期待の', '最強の', '最弱の', '隠れた', '流浪の', '天才', '秘密の', '週末の', '雨の日の', '月夜の', 'ひらめきの'];
  const NAME_B = ['碁石', '棋士', '天元', '星', '名人', '大石', '一手', 'コウ', 'アゲハマ', '碁盤', '黒石', '白石', '二眼', '布石', '定石', '打ち手',
    '小目', '三々', 'シチョウ', 'ゲタ', 'ハネ', 'ノビ', 'ツケ', 'ノゾキ', 'ワタリ', 'セキ', '地', '模様', '厚み', '中押し', 'ヨセ', '手筋',
    'ゴリラ', 'ドラゴン', '侍', '忍者', '魔王', '勇者', '騎士', '狼', '虎', '龍', 'タヌキ', 'ペンギン', 'カラス', 'ハムスター', '爆弾', '隕石', '火山', 'ロボ'];
  const RARE_A = ['覇王の', '神域の', '終焉の', '天下無双の', '破壊神の', '幻の', '永劫の', '星喰いの'];
  const RARE_B = ['デストロイヤー', '神の一手', '千年碁石', '碁神', '破壊王', '天地開闢', '黒龍', '流星'];
  // それぞれの言葉がレアになる確率（金色はおよそ 4%、虹色は 0.04%）。破壊の迷宮の B15F を突破すると少し上がる（金色およそ 6%）
  const rareP = () => (dojoCleared(15) ? 0.03 : 0.02);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const makeName = () => `${Math.random() < rareP() ? pick(RARE_A) : pick(NAME_A)}${Math.random() < rareP() ? pick(RARE_B) : pick(NAME_B)}${Math.floor(10 + Math.random() * 90)}`;
  // 0：ふつう、1：レア（金色）、2：伝説（虹色）
  const nameRank = (n) => (RARE_A.some((w) => String(n).startsWith(w)) ? 1 : 0) + (RARE_B.some((w) => String(n).includes(w)) ? 1 : 0);
  // 引き直しは 1 日 3 回まで（破壊の迷宮の B12F を突破すると 5 回）。引いたレアな名前は「キープ」に残り、あとでいつでも戻せる（回数は使わない）
  const KEEP_MAX = 8;
  const nameRolls = () => (dojoCleared(12) ? 5 : 3);
  const today = () => new Date().toLocaleDateString('sv-SE'); // 2026-10-24 の形（端末の日付）
  function rollsLeft() {
    let v = null; try { v = JSON.parse(localStorage.getItem('destroy-go-name-rolls') || 'null'); } catch (e) { /* 無視 */ }
    return v && v.d === today() ? Math.max(0, nameRolls() - v.n) : nameRolls();
  }
  function useRoll() { try { localStorage.setItem('destroy-go-name-rolls', JSON.stringify({ d: today(), n: nameRolls() - rollsLeft() + 1 })); } catch (e) { /* 無視 */ } }
  function keptNames() { try { return JSON.parse(localStorage.getItem('destroy-go-name-keep') || '[]'); } catch (e) { return []; } }
  function keepName(n) {
    if (!nameRank(n)) return;
    const k = keptNames().filter((x) => x !== n); k.unshift(n);
    // 多すぎたら、ふつうのレアから古い順に外す（伝説は残す）
    while (k.length > KEEP_MAX) { const i = k.map(nameRank).lastIndexOf(1); k.splice(i >= 0 ? i : k.length - 1, 1); }
    try { localStorage.setItem('destroy-go-name-keep', JSON.stringify(k)); } catch (e) { /* 無視 */ }
  }
  // プレイヤータグ：ID から作る 4 文字。名前を引き直しても変わらないので、同じ人だと分かる
  function playerTag(u) {
    if (!u) return '';
    let h = 2166136261; for (let i = 0; i < u.length; i++) { h ^= u.charCodeAt(i); h = Math.imul(h, 16777619); }
    const C = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let t = ''; h >>>= 0;
    for (let i = 0; i < 4; i++) { t += C[h % C.length]; h = Math.floor(h / C.length); }
    return t;
  }
  const tagHtml = (u) => (u ? `<small class="ptag" title="プレイヤータグ（名前を変えても変わりません）">#${playerTag(u)}</small>` : '');
  const nameHtml = (n) => { const r = nameRank(n); return `<b class="nm${r === 2 ? ' nm-legend' : r === 1 ? ' nm-rare' : ''}"${r ? ` title="${r === 2 ? '伝説の名前' : 'レアな名前'}"` : ''}>${esc(n)}</b>`; };
  const RATE0 = 1500;
  // 開発者の端末だけの名前。端末で localStorage の destroy-go-dev を '1' にすると使う
  // （ほかの人が名乗れないよう、Firebase のルールで「ROBIT」「開発」が入った名前は開発者の端末しか書けない）
  const DEV_NAME = 'ROBIT（開発者）';
  // 開発者：この端末で destroy-go-dev を '1' にしたか、引き継ぎコードで開発者の記録に切り替えた端末
  const isDev = () => devHere();
  let myRating = null; // { r, n, name }（オンライン対戦の画面を開いたときに読む）
  async function loadRating() {
    if (myRating) return myRating;
    try { myRating = await Online.getRating(); } catch (e) { myRating = null; }
    if (!myRating || typeof myRating.r !== 'number') myRating = { r: RATE0, n: 0, name: makeName(), fresh: true };
    if (isDev() && myRating.name !== DEV_NAME) { myRating.name = DEV_NAME; if (!myRating.fresh) saveRating(); }
    return myRating;
  }
  function saveRating() {
    const { r, n, name, sid, sn } = myRating, { cl, ns } = titleFields();
    Online.setRating({ r, n, name, ...(sid ? { sid, sn } : {}), ...(cl ? { cl } : {}), ...(ns ? { ns } : {}) }).catch(() => {});
  }
  // イロレーティング。最初の 10 局は大きく動かす
  function eloNext(me, opp, win) {
    const k = me.n < 10 ? 40 : 32, e = 1 / (1 + Math.pow(10, (opp.r - me.r) / 400));
    return Math.max(100, Math.round(me.r + k * ((win ? 1 : 0) - e)));
  }
  const RANDOM_CPU_AFTER = 30000; // これだけ待っても相手が来なければ、CPU と対戦するボタンを出す
  let seekStop = null;
  function stopSeek() { if (seekStop) { seekStop(); seekStop = null; } clearTimeout(stopSeek.t); }
  // view：'friend'（フレンド対戦の画面）か 'blank'（ランダム・ランク・ランキングの入口。中身はすぐ差し替える）
  let onlineEntry = 'blank';
  function openOnline(view = 'blank') {
    $('#online-pop').hidden = false;
    onlineEntry = view;
    if (view !== 'friend') { onlineView(''); return; }
    const st = { size: SIZE, mode, adv: dAdvanced, rules, min: minutes() };
    onlineView(`<p class="on-title">👥 フレンド対戦</p>
      <p>合言葉（4けたの数字）で、友だちとオンラインで対戦できます。</p>
      <button class="accent" id="on-create">部屋を作る</button>
      <p class="on-set">今の設定で対局：${settingText(st)}</p>
      <div class="on-or">── 合言葉を教えてもらったら ──</div>
      <div class="on-join"><input id="on-code" inputmode="numeric" maxlength="4" placeholder="0000" autocomplete="off"><button id="on-join" class="accent">入る</button></div>
      <p class="on-note">β版（テスト中）です。うまく動かないときは、不具合の報告から教えてください。<br>待った・一時停止はできません。対局中にアプリを閉じると、つながりが切れます。</p>`);
    bindFriend(st);
  }
  // 「戻る」：フレンド対戦から来たらその画面へ、それ以外はタイトルへ
  function onlineBack() {
    if (onlineEntry === 'friend') { openOnline('friend'); return; }
    $('#online-pop').hidden = true; renderRankTop();
  }
  function bindFriend(st) {
    $('#on-create').onclick = () => onlineCreate(st);
    $('#on-join').onclick = () => onlineJoin($('#on-code').value.trim());
    $('#on-code').onkeydown = (e) => { if (e.key === 'Enter') $('#on-join').onclick(); };
  }
  // ランダムマッチ：相手を探す → 見つけた側が部屋を作って合言葉を送り、待っていた側が入る
  // ---------- 初代デストロイヤー：ランクマッチを最初に終えた先着 100 人。名前の横に番号つきの印が出る ----------
  const FOUNDER_MAX = 100;
  let myFounder = 0;
  try { myFounder = +localStorage.getItem('destroy-go-founder') || 0; } catch (e) { /* 無視 */ }
  let foundersCache = null, foundersAt = 0;
  async function loadFounders() {
    if (foundersCache && Date.now() - foundersAt < 60000) return foundersCache;
    try {
      foundersCache = await Online.founders(); foundersAt = Date.now();
      // サーバーの記録に合わせる（運営が番号を取り消したときなど、この端末にだけ古い番号が残らないように）
      const n = foundersCache.list[Online.me()] || 0;
      if (n !== myFounder) { myFounder = n; try { localStorage.setItem('destroy-go-founder', String(n)); } catch (e) { /* 無視 */ } renderRankTop(); }
    } catch (e) { foundersCache = foundersCache || { count: 0, list: {} }; }
    return foundersCache;
  }
  const DEV_UID = 'RBJU7o2rpuTScawapNfCBFPXHhj2'; // 開発者（ROBIT）。初代デストロイヤーはもらわず、開発者の印をつける
  const devBadge = '<i class="badge-f badge-dev" title="デストロイ碁の開発者">🛠 開発者</i>';
  const meIsDev = () => isDev() || Online.me() === DEV_UID;
  // テスト用の端末（?tester=1 で一度開くと覚える。?tester=0 でやめる）。初代デストロイヤーの番号を取らない
  try {
    if (/[?&]tester=1\b/.test(location.search)) localStorage.setItem('destroy-go-tester', '1');
    if (/[?&]tester=0\b/.test(location.search)) localStorage.removeItem('destroy-go-tester');
  } catch (e) { /* 無視 */ }
  const isTester = () => lsGet('destroy-go-tester') === '1';
  const founderBadge = (n, short) => (n ? `<i class="badge-f" title="初代デストロイヤー：ランクマッチを最初に終えた先着 ${FOUNDER_MAX} 人">${short ? '初代' : '👑 初代デストロイヤー '}#${String(n).padStart(2, '0')}</i>` : '');
  const founderLeft = (f) => (isTester() && !meIsDev() ? `🧪 テスト用の端末なので、初代デストロイヤーはもらいません（先着${FOUNDER_MAX}人・残り${Math.max(0, FOUNDER_MAX - f.count)}枠）`
    : meIsDev() ? `🛠 開発者は初代デストロイヤーをもらいません（先着${FOUNDER_MAX}人・残り${Math.max(0, FOUNDER_MAX - f.count)}枠）`
    : f.list[Online.me()] || myFounder ? `👑 あなたは<b>初代デストロイヤー #${String(f.list[Online.me()] || myFounder).padStart(2, '0')}</b>です（先着${FOUNDER_MAX}人・残り${Math.max(0, FOUNDER_MAX - f.count)}枠）`
    : f.count >= FOUNDER_MAX ? '👑 初代デストロイヤー（先着100人）は締め切りました'
    : `👑 ランクマッチを1局終えると<b>初代デストロイヤー</b>の印がもらえます（先着${FOUNDER_MAX}人・残り${FOUNDER_MAX - f.count}枠）`);
  // 深淵の開拓者（先着 3 人）：破壊の迷宮の深淵層の最深部 B18F を突破した人が、ゲームを開いたとき（または突破したとき）に名乗り出る
  const PIONEER_MAX = 3;
  let myPioneer = +lsGet('destroy-go-pioneer') || 0, pioneersCache = null, pioneersAt = 0;
  async function loadPioneers() {
    if (pioneersCache && Date.now() - pioneersAt < 60000) return pioneersCache;
    try {
      pioneersCache = await Online.pioneers(); pioneersAt = Date.now();
      const n = pioneersCache.list[Online.me()] || 0;
      if (n !== myPioneer) { myPioneer = n; lsSet('destroy-go-pioneer', String(n)); }
    } catch (e) { pioneersCache = pioneersCache || { count: 0, list: {} }; }
    return pioneersCache;
  }
  const pioneerName = (n) => (n === 1 ? '深淵の開拓者' : `深淵の先駆者 #${n}`);
  const pioneerBadge = (n) => (n ? `<i class="badge-f badge-dojo pi-${n}" title="破壊の迷宮の深淵層を ${n} 番目に踏破した">${pioneerName(n)}</i>` : '');
  async function claimPioneer() {
    if (myPioneer || meIsDev() || isTester() || !dojoCleared(18) || !Online.available()) return;
    let n = 0;
    try { n = await Online.claimPioneer(PIONEER_MAX); } catch (e) { return; }
    if (!n) return;
    myPioneer = n; pioneersCache = null; lsSet('destroy-go-pioneer', String(n));
    track(`称号「${pioneerName(n)}」を獲得`); renderDojoHome();
    const el = $('#unlock-pop');
    el.innerHTML = `<b>👑 称号「${pioneerName(n)}」を手に入れた！</b><small>破壊の迷宮の深淵層を、世界で ${n} 番目に踏破した証。ランキングで名前の横に出ます</small>`;
    el.style.setProperty('--tc', n === 1 ? '#ffd23f' : n === 2 ? '#d8dce4' : '#e09a5a');
    el.className = ''; void el.offsetWidth; el.className = 'show';
    FX.heal();
  }
  async function claimFounder() {
    if (myFounder || meIsDev() || isTester()) return;
    let n = 0;
    try { n = await Online.claimFounder(FOUNDER_MAX); } catch (e) { return; }
    if (!n) return;
    myFounder = n; foundersCache = null;
    try { localStorage.setItem('destroy-go-founder', String(n)); } catch (e) { /* 無視 */ }
    renderRankTop(); syncProfile();
    const el = $('#unlock-pop');
    el.innerHTML = `<b>👑 初代デストロイヤー #${String(n).padStart(2, '0')} に選ばれた！</b><small>ランクマッチを最初に終えた先着${FOUNDER_MAX}人の証。ランキングで名前の横に出ます</small>`;
    el.style.setProperty('--tc', '#ffd23f');
    el.className = ''; void el.offsetWidth; el.className = 'show';
    FX.heal();
  }
  // ---------- 記録の引き継ぎ（引き継ぎコード）----------
  // レート・名前・初代デストロイヤーは Firebase にある。解放した演出・BGM などもここに写しておき、
  // 別の端末や製品版で引き継ぎコードを入れれば戻せるようにする
  const linked = () => lsGet('destroy-go-linked') === '1';
  const profileData = () => ({ fx: [...secretUnlocked], bgm: [...bgmUnlocked], founder: myFounder || 0, random: randomPlayed(), keep: keptNames(), adv: advCpuWon(), dojo });
  function syncProfile() { if (linked() && Online.available()) Online.saveProfile(profileData()).catch(() => {}); }
  // サーバーの記録と、この端末の記録を合わせる（どちらかで解放したものは全部使える）
  function mergeProfile(pf) {
    if (!pf) return;
    let changed = false;
    for (const k of pf.fx || []) if (!secretUnlocked.has(k)) { secretUnlocked.add(k); changed = true; }
    for (const k of pf.bgm || []) if (!bgmUnlocked.has(k)) { bgmUnlocked.add(k); changed = true; }
    if (changed) {
      lsSet('destroy-go-unlocks', JSON.stringify([...secretUnlocked])); lsSet('destroy-go-bgm-unlocks', JSON.stringify([...bgmUnlocked]));
      buildThemeChips(); renderThemes(); buildBgmChips();
    }
    if ((pf.random || 0) > randomPlayed()) lsSet('destroy-go-random-played', pf.random);
    if (pf.adv) lsSet('destroy-go-adv-cpu-win', '1');
    if (pf.dojo && pf.dojo.stars) { // 破壊の迷宮：階ごとに多いほうの星、ノンストップ潜行の記録も深いほう
      for (const [lv, n] of Object.entries(pf.dojo.stars)) if ((+n || 0) > (dojo.stars[lv] || 0)) dojo.stars[lv] = +n;
      dojo.best = Math.max(dojo.best, +pf.dojo.best || 0); saveDojo(); renderDojoHome();
    }
    for (const n of (pf.keep || []).slice().reverse()) if (!keptNames().includes(n)) keepName(String(n));
    renderRankTop();
  }
  // 連携している人は、開いたときにサーバーの記録を読む（初代デストロイヤーの番号も、今の ID のものに合わせる）
  async function restoreProfile() {
    if (!linked() || !Online.available() || EMBEDDED) return;
    try {
      const [pf, f] = await Promise.all([Online.loadProfile(), loadFounders()]);
      mergeProfile(pf);
      const n = f.list[Online.me()] || 0;
      if (n !== myFounder) { myFounder = n; lsSet('destroy-go-founder', String(n)); }
      myRating = null; await loadRating(); renderRankTop();
      syncProfile();
    } catch (e) { /* つながらないときは、この端末の記録のまま */ }
  }
  // Google 連携を出すか。個人情報（メールアドレス）を持たないため、引き継ぎコードだけにしている。
  // 前に Google と連携した人には「Google 連携を外す」を出す
  const GOOGLE_LINK = false;
  const PRIVACY_URL = 'privacy.html';
  async function openAccount() {
    $('#online-pop').hidden = false; onlineEntry = 'blank';
    onlineView('<p class="on-wait">準備しています</p>');
    try { await Online.ready(); } catch (e) { onlineError(e); return; }
    const a = Online.account();
    if ((a.linked || a.code) && !linked()) lsSet('destroy-go-linked', '1');
    const saved = lsGet('destroy-go-transfer-code') || '';
    const codeBox = a.code
      ? `<div class="on-box"><p class="on-box-title">🔑 引き継ぎコード</p>
          ${saved ? `<div class="on-tcode">${esc(saved)}</div><button id="on-copy">コピーする</button>` : '<p class="on-set">この記録には引き継ぎコードがあります（この端末では表示できません）。</p>'}
          <p class="on-set">別の端末や製品版で「コードを入れて記録を戻す」に入力すると、この記録が戻ります。<b>ほかの人には教えないでください。</b></p>
          <button id="on-recode">コードを作り直す</button></div>`
      : `<div class="on-box"><p class="on-box-title">🔑 引き継ぎコード（個人情報なし）</p>
          <p class="on-set">16文字のコードを発行します。メールアドレスなどは使いません。コードはメモやスクショで保存してください。</p>
          <button class="accent" id="on-issue">引き継ぎコードを発行する</button></div>`;
    const googleBox = !GOOGLE_LINK ? (a.linked ? `<div class="on-box"><p class="on-box-title">Google 連携</p>
          <p class="on-set">この記録は Google アカウントとつながっています。デストロイ碁はメールアドレスなどの個人情報を持たないことにしたので、外せます（先に引き継ぎコードを発行しておくと安心です）。</p>
          <button id="on-unlink">Google 連携を外す</button></div>` : '') : a.linked
      ? `<div class="on-box"><p class="on-box-title">Google 連携</p><p>✅ <b>Google と連携しています</b>${a.email ? `（${esc(a.email)}）` : ''}</p></div>`
      : `<div class="on-box"><p class="on-box-title">Google 連携</p>
          <p class="on-set">コードを覚えておかなくても、Google アカウントで記録を戻せます。メールアドレスは記録をつなぐためだけに使います。ほかのプレイヤーには見えません（運営の管理画面には表示されます）。</p>
          <button id="on-link">Google で連携する</button></div>`;
    onlineView(`<p class="on-title">🔗 記録の引き継ぎ</p>
      <p class="on-set">レート・名前・初代デストロイヤー・解放した演出と BGM を、別の端末や<b>製品版</b>に引き継げます。データを消してしまったときも戻せます。</p>
      ${codeBox}${googleBox}
      <div class="on-box"><p class="on-box-title">コードを入れて記録を戻す</p>
        <div class="on-join"><input id="on-tin" maxlength="19" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters"><button id="on-use" class="accent">戻す</button></div></div>
      <p class="on-note">コードを発行しなくても、今までどおり遊べます。<a href="${PRIVACY_URL}" target="_blank" rel="noopener">プライバシーポリシー</a></p>
      <button id="on-back">戻る</button>`);
    $('#on-back').onclick = onlineBack;
    const showCode = (code) => { lsSet('destroy-go-transfer-code', code); lsSet('destroy-go-linked', '1'); Online.saveProfile(profileData()).catch(() => {}); openAccount(); };
    const fail = (e) => toast(e && e.code === 'auth/operation-not-allowed' ? '引き継ぎコードはまだ準備中です'
      : e && e.code === 'auth/requires-recent-login' ? 'コードを作り直せませんでした。この端末でもう一度コードを入れて戻してから試してください'
      : `うまくいきませんでした（${(e && (e.code || e.message)) || '不明'}）`);
    if ($('#on-issue')) $('#on-issue').onclick = () => Online.issueCode().then(showCode).catch(fail);
    if ($('#on-recode')) $('#on-recode').onclick = () => { if (confirm('コードを作り直すと、前のコードは使えなくなります。作り直しますか？')) Online.issueCode().then(showCode).catch(fail); };
    if ($('#on-copy')) $('#on-copy').onclick = () => { try { navigator.clipboard.writeText(saved).then(() => toast('コピーしました')); } catch (e) { toast('コピーできませんでした。手で書き写してください'); } };
    $('#on-use').onclick = async () => {
      const code = $('#on-tin').value;
      if (!confirm('コードの記録に切り替えますか？\n\n・レートと名前は、コードの記録のものになります\n・解放した演出と BGM は、両方を合わせます')) return;
      try {
        await Online.useCode(code);
        lsSet('destroy-go-linked', '1'); lsSet('destroy-go-founder', '0');
        lsSet('destroy-go-transfer-code', code.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/.{4}/g).join('-'));
        location.reload();
      } catch (e) {
        toast(e && (e.code === 'bad-code' || /user-not-found|wrong-password|invalid-credential|invalid-login|invalid-email/.test(e.code || '')) ? 'コードがちがいます。もう一度確かめてください' : `戻せませんでした（${(e && (e.code || e.message)) || '不明'}）`);
      }
    };
    if ($('#on-unlink')) $('#on-unlink').onclick = () => {
      if (!confirm('Google 連携を外しますか？\n（レートなどの記録はそのまま残ります）')) return;
      Online.unlinkGoogle().then(() => { toast('Google 連携を外しました'); openAccount(); }).catch(fail);
    };
    if (!$('#on-link')) return;
    $('#on-link').onclick = () => {
      // ログイン画面は、押してすぐ開かないとブラウザに止められるので、待たずに呼ぶ
      Online.linkGoogle().then(async (r) => {
        if (r.other) {
          const ok = confirm('この Google アカウントには、前に連携した記録があります。\n前の記録に切り替えますか？\n\n・レートと名前は、前の記録のものになります\n・解放した演出と BGM は、両方を合わせます');
          if (!ok) return;
          await Online.switchTo(r.other);
          lsSet('destroy-go-linked', '1'); lsSet('destroy-go-founder', '0');
          location.reload();
          return;
        }
        lsSet('destroy-go-linked', '1');
        await Online.saveProfile(profileData()).catch(() => {});
        toast('Google と連携しました。記録が守られます');
        openAccount();
      }).catch((e) => {
        const c = e && e.code;
        const msg = c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request' ? '連携をやめました'
          : c === 'auth/popup-blocked' ? 'ログインの画面を開けませんでした。もう一度押すか、Safari / Chrome で開いてください'
          : c === 'auth/operation-not-allowed' ? 'Google 連携はまだ準備中です'
          : INAPP ? 'アプリの中のブラウザでは Google にログインできません。Safari / Chrome で開いてください'
          : `連携できませんでした（${c || (e && e.message) || '不明'}）`;
        toast(msg);
      });
    };
  }
  $('#btn-account').hidden = !Online.available() || EMBEDDED;
  $('#btn-account').onclick = () => { FX.unlock(); openAccount(); };
  restoreProfile();
  // ランキングの下の「名前ガチャ」：引き直し（1 日 3 回）とキープした名前
  function nameGachaBox(cur) {
    const left = rollsLeft(), keep = keptNames().filter((n) => n !== cur);
    return `<div class="on-gacha">
      <button id="on-rename"${left ? '' : ' disabled'}>🎲 名前を引き直す（今日あと${left}回）</button>
      <small>${left ? '今の名前は消えます。レアな名前は自動でキープされます' : '明日また引けます'}</small>
      ${keep.length ? `<div class="on-keep"><span>キープ中：</span>${keep.map((n, i) => `<button data-keep="${i}">${nameHtml(n)}</button>`).join('')}</div>` : ''}
    </div>`;
  }
  function bindNameGacha() {
    const setName = (n) => { myRating.name = n; if (!myRating.fresh) saveRating(); syncProfile(); renderRankTop(); };
    if ($('#on-rename')) $('#on-rename').onclick = () => {
      if (!rollsLeft()) return;
      keepName(myRating.name); useRoll();
      const n = makeName(); keepName(n); setName(n); nameGachaFx(n); showRanking();
      track(['名前ガチャを引いた（ふつう）', '名前ガチャで金色の名前', '名前ガチャで虹色の名前'][nameRank(n)]);
    };
    const keep = keptNames().filter((n) => n !== myRating.name);
    $('#online-body').querySelectorAll('[data-keep]').forEach((b) => {
      b.onclick = () => { keepName(myRating.name); setName(keep[+b.dataset.keep]); toast(`名前を「${keep[+b.dataset.keep]}」にしました`); showRanking(); };
    });
  }
  // 名前を引き直したときの知らせ。レアなら解放の知らせと同じ形で出す
  function nameGachaFx(n) {
    const r = nameRank(n);
    if (!r) { toast(`新しい名前：${n}`); return; }
    const el = $('#unlock-pop');
    el.innerHTML = r === 2 ? `<b>🌈 伝説の名前！</b><small>「${esc(n)}」 虹色に光ります（およそ 2500 回に 1 回）</small>`
      : `<b>✨ レアな名前！</b><small>「${esc(n)}」 金色に光ります</small>`;
    el.style.setProperty('--tc', r === 2 ? '#ff7ad9' : '#ffd23f');
    el.className = ''; void el.offsetWidth; el.className = 'show';
    FX.heal();
  }
  // ---------- シーズン：期間中のランクマッチの最終順位でご褒美（色違いの演出と、名前の横の称号） ----------
  // 締め切りは GitHub Actions（.github/workflows/season-close.yml）が自動で行い、結果を seasons/s{id} に書く
  const SEASON = { id: 1, label: 'シーズン1', start: Date.parse('2026-11-01T00:00:00+09:00'), end: Date.parse('2027-01-01T00:00:00+09:00'), endText: '12月31日', startText: '11月1日', minGames: 10 };
  const SEASON_TIERS = [
    { max: 3, tag: 'TOP3', fx: ['crimson', 'shimetsu', 'aoen'], cls: 'st-3' },
    { max: 10, tag: 'TOP10', fx: ['shimetsu', 'aoen'], cls: 'st-10' },
    { max: 50, tag: 'TOP50', fx: ['aoen'], cls: 'st-50' },
  ];
  const seasonTier = (rank) => SEASON_TIERS.find((t) => rank <= t.max);
  const seasonState = () => (Date.now() < SEASON.start ? 'before' : Date.now() < SEASON.end ? 'on' : 'after');
  // このシーズンに遊んだランクマッチの数（シーズンが変わったら 0 から）
  const seasonGames = (r) => (r && r.sid === SEASON.id ? r.sn || 0 : 0);
  const seasonCount = (before) => (seasonState() === 'on' ? { sid: SEASON.id, sn: seasonGames(before) + 1 } : {});
  let seasonCache = null, seasonAt = 0;
  async function loadSeason() {
    if (seasonState() !== 'after') return null;
    if (seasonCache && Date.now() - seasonAt < 300000) return seasonCache;
    try { seasonCache = (await Online.seasonResults(SEASON.id)) || { closed: false }; seasonAt = Date.now(); } catch (e) { /* つながらないときは出さない */ }
    return seasonCache;
  }
  const seasonResult = (res, u) => (res && res.closed && res.results ? res.results[u] : null);
  function seasonBadge(res, u) {
    const r = seasonResult(res, u), t = r && seasonTier(r.rank);
    return t ? `<i class="badge-f badge-season ${t.cls}" title="${SEASON.label} ${r.rank} 位">S${SEASON.id} ${t.tag}</i>` : '';
  }
  const SEASON_PRIZE = '1〜3位 紅雷・4〜10位 紫滅・11〜50位 蒼炎（色違いの演出）と称号';
  function seasonLine(me, res) {
    const st = seasonState();
    if (st === 'before') return `🏆 <b>${SEASON.label}</b>は ${SEASON.startText}〜${SEASON.endText}。ランクマッチを ${SEASON.minGames} 局以上遊んだ人の最終順位で、${SEASON_PRIZE}`;
    if (st === 'on') {
      const days = Math.max(1, Math.ceil((SEASON.end - Date.now()) / 86400000)), n = seasonGames(me);
      return `🏆 <b>${SEASON.label} 開催中</b>：あと ${days} 日（${SEASON.endText}まで）。あなたは ${n}／${SEASON.minGames} 局${n >= SEASON.minGames ? '（対象です）' : ''}<br><small>${SEASON_PRIZE}</small>`;
    }
    if (!res || !res.closed) return `🏆 <b>${SEASON.label} 終了</b>。結果を集計しています`;
    const r = seasonResult(res, Online.me()), t = r && seasonTier(r.rank);
    return t ? `🏆 <b>${SEASON.label} 終了</b>。あなたは <b>${r.rank} 位</b>（S${SEASON.id} ${t.tag}）！` : `🏆 <b>${SEASON.label} 終了</b>。上位 50 人には名前の横に称号が付いています`;
  }
  // 締め切りのあと、自分の順位のご褒美を受け取る（1 回だけ）
  async function claimSeason() {
    if (seasonState() !== 'after' || lsGet('destroy-go-season-claimed-' + SEASON.id) === '1') return;
    const res = await loadSeason();
    if (!res || !res.closed) return;
    lsSet('destroy-go-season-claimed-' + SEASON.id, '1');
    const r = seasonResult(res, Online.me()), t = r && seasonTier(r.rank);
    if (!t) return;
    for (const k of t.fx) secretUnlocked.add(k);
    lsSet('destroy-go-unlocks', JSON.stringify([...secretUnlocked]));
    refreshThemeChoices(); syncProfile();
    const el = $('#unlock-pop');
    el.innerHTML = `<b>🏆 ${SEASON.label}で ${r.rank} 位！</b><small>${t.fx.map((k) => `「${themeOf(k).label}」`).join('')}と称号「S${SEASON.id} ${t.tag}」を手に入れた</small>`;
    el.style.setProperty('--tc', themeOf(t.fx[0]).color);
    el.className = ''; void el.offsetWidth; el.className = 'show';
    FX.heal();
  }
  // ランクマッチを遊んだことがある人は、締め切りのあとに開いたときに受け取る
  if (seasonState() === 'after' && lsGet('destroy-go-rank-played') === '1' && Online.available() && !EMBEDDED) setTimeout(() => claimSeason().catch(() => {}), 1500);
  async function showRanking() {
    onlineView('<p class="on-wait">ランキングを読み込んでいます</p>');
    try {
      const [list, me, f, sr, pi] = await Promise.all([Online.topRatings(50), loadRating(), loadFounders(), loadSeason(), loadPioneers()]);
      const rows = list.map((v, i) => `<li data-u="${v.u}"${v.u === Online.me() ? ' class="on-mine"' : ''}><span>${i + 1}</span><span class="rk-name">${nameHtml(v.name)}<span class="rk-sub">${tagHtml(v.u)}${v.u === DEV_UID || (v.u === Online.me() && isDev()) ? devBadge : founderBadge(f.list[v.u], true)}${seasonBadge(sr, v.u)}${pioneerBadge(pi.list[v.u])}${dojoBadge(v.cl)}${nonstopBadge(v.ns)}</span></span><span>${v.r}</span><small>${v.n || 0}局</small></li>`).join('');
      onlineView(`<p class="on-set">ランクマッチ（上級・9路）のレート上位 50 人。名前を押すと、直近 5 局の棋譜が見られます</p>
        <p class="on-founder on-season">${seasonLine(me, sr)}</p>
        <p class="on-founder">${founderLeft(f)}</p>
        <ol class="on-rank">${rows || '<li class="on-empty">まだ誰もいません</li>'}</ol>
        <p class="on-me">あなた：${nameHtml(me.name)}${tagHtml(Online.me())}${meIsDev() ? devBadge : founderBadge(f.list[Online.me()] || myFounder)}${seasonBadge(sr, Online.me())}${pioneerBadge(pi.list[Online.me()] || myPioneer)}${myTitleBadge()}（レート ${me.r}・${me.n}局）</p>
        ${titlePicker()}${isDev() ? '' : nameGachaBox(me.name)}<button id="on-back">戻る</button>`);
      bindNameGacha();
      $('#online-body').querySelectorAll('[data-title]').forEach((b) => { b.onclick = () => { lsSet('destroy-go-title', b.dataset.title); if (myRating) saveRating(); showRanking(); }; });
      claimSeason().catch(() => {});
      $('#online-body').querySelectorAll('.on-rank li[data-u]').forEach((li) => { li.onclick = () => showPlayerKifus(li.dataset.u, li.querySelector('b').textContent); });
    } catch (e) { onlineView(`<p class="on-err">${e.message}</p><button id="on-back">戻る</button>`); }
    $('#on-back').onclick = onlineBack;
  }
  const esc = (t) => String(t || '').replace(/[<>&"]/g, '');
  // ランキングの人の直近 5 局。選ぶとハイライトの画面で見られる
  async function showPlayerKifus(u, name) {
    onlineView('<p class="on-wait">棋譜を読み込んでいます</p>');
    let list = [];
    try { list = await Online.listKifus(u); } catch (e) { onlineView(`<p class="on-err">${e.message}</p><button id="on-back">戻る</button>`); $('#on-back').onclick = showRanking; return; }
    const rows = list.map((k, i) => {
      const me = k.owner, foe = otherColor(me), win = k.result && k.result.winner === me;
      const date = k.date ? new Date(k.date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) : '';
      return `<li data-i="${i}"><span>${date}</span><b>vs ${esc(k.names && k.names[foe])}${k.tags && k.tags[foe] ? ` <small class="ptag">#${esc(k.tags[foe])}</small>` : ''}</b><span class="${win ? 'on-win' : 'on-lose'}">${win ? '勝ち' : '負け'}</span><small>${(k.moves || []).length}手</small></li>`;
    }).join('');
    onlineView(`<p class="on-title">${esc(name)} の直近の棋譜</p>
      <ol class="on-rank">${rows || '<li class="on-empty">まだ棋譜がありません</li>'}</ol>
      <p class="on-note">押すと、ハイライトの画面で見られます（早送り・1手ずつ・ダメージの履歴も使えます）</p><button id="on-back">ランキングに戻る</button>`);
    $('#on-back').onclick = showRanking;
    $('#online-body').querySelectorAll('.on-rank li[data-i]').forEach((li) => {
      li.onclick = () => {
        const k = list[+li.dataset.i];
        if (!k || !k.moves || !k.moves.length) return;
        k.moves = Array.isArray(k.moves) ? k.moves : Object.values(k.moves); // Firebase は配列をオブジェクトで返すことがある
        $('#online-pop').hidden = true;
        startReplay(k);
        toast(`${esc(k.names && k.names[BLACK])}（黒） vs ${esc(k.names && k.names[WHITE])}（白）`);
      };
    });
  }
  async function onlineRandom(kind = 'random') {
    track(kind === 'rank' ? 'ランクマッチを探した' : 'ランダムマッチを探した');
    const RULE = kind === 'rank' ? RANK_RULE : randomRule(), label = kind === 'rank' ? 'ランクマッチ' : 'ランダムマッチ';
    if (kind === 'rank') await loadRating();
    const view = (n) => onlineView(`<p class="on-wait">相手を探しています</p>
      <p class="on-set">${label}：${settingText(RULE)}</p>
      <p class="on-rule"><b>デストロイ碁オリジナルのルール</b>です。石を取ると相手にダメージ、HPを0にしても勝ち。<b>死に石は判定しない</b>ので、終わる前に取りきろう。待っている間にどうぞ<button id="on-rules">ルールを見る</button></p>
      <p class="on-founder" id="on-founder" hidden></p>
      <p class="on-set" id="on-count">${n ? `${label}を開いている人：${n}人` : ''}</p>
      <div id="on-cpu-box" hidden>${cpuLevelRow()}</div>
      <button id="on-cpu" hidden>待っている間、CPU と対戦する${kind === 'random' && randomPlayed() < RANK_UNLOCK ? '<small>勝つとランクマッチまでの 1 局に数えます</small>' : ''}</button><button id="on-cancel">やめる</button>`);
    view(0);
    $('#on-rules').onclick = () => openRulesFor(kind === 'rank');
    if (kind === 'rank' && !myFounder && !meIsDev()) loadFounders().then((f) => { const el = $('#on-founder'); if (el) { el.innerHTML = founderLeft(f); el.hidden = false; } });
    $('#on-cancel').onclick = () => { stopSeek(); Online.leave(); onlineBack(); };
    const showCpu = () => {
      if (!$('#on-cpu')) return;
      $('#on-cpu').hidden = false; $('#on-cpu-box').hidden = false; bindCpuLevelRow();
      // ランダムマッチの待ち時間は初級、ランクマッチの待ち時間は上級で
      $('#on-cpu').onclick = () => { stopSeek(); Online.leave(); startOnlineCpu(kind === 'rank'); warmupCpu = kind === 'random'; };
    };
    stopSeek.t = setTimeout(showCpu, RANDOM_CPU_AFTER);
    try {
      seekStop = await Online.seek(async (m) => {
        seekStop = null; clearTimeout(stopSeek.t);
        if (m.error) { onlineError(new Error('相手を探せませんでした。少ししてからもう一度試してください')); return; }
        if (!m.host) { onlineJoin(m.code, kind); return; }
        // 見つけた側：部屋を作って合言葉を相手に送る。15 秒たっても相手が入らなければ、探し直す
        const settings = { ...RULE, hostColor: Math.random() < 0.5 ? BLACK : WHITE };
        try {
          const code = await Online.create(settings, onlineHandlers);
          net = { code, host: true, settings, color: settings.hostColor, g: 1, min: settings.min, waiting: true, kind };
          Online.pair(m.partner, code);
          const n = net;
          setTimeout(() => { if (net === n && net.waiting) { leaveOnline(); onlineRandom(kind); } }, 15000);
        } catch (e) { onlineError(e); }
      }, (n) => {
        const el = $('#on-count'); if (el) el.textContent = `${label}を開いている人：${n}人`;
        if (n <= 1) { // 自分しかいないときは、待たずに CPU 戦のボタンを出す（探すのは続ける）
          clearTimeout(stopSeek.t); showCpu();
          if (el && !isBattleTime()) el.textContent += `（人が集まりやすいのは、毎晩 ${BATTLE_FROM}〜${BATTLE_TO} 時の対戦タイムです）`;
        }
      }, kind);
    } catch (e) { onlineError(e); }
  }
  function onlineError(e) {
    // Firebase の英語のエラー（auth/network-request-failed など）は、日本語の分かりやすい文にする
    let msg = (e && e.message) || 'つながりませんでした';
    if (/Firebase|auth\/|network|permission/i.test(msg)) msg = '通信できませんでした。ネットにつながっているか確かめて、もう一度試してください';
    onlineView(`<p class="on-err">${msg}</p><button id="on-back">戻る</button>`);
    $('#on-back').onclick = onlineBack;
    Online.leave(); net = null;
  }
  async function onlineCreate(st) {
    onlineView('<p class="on-wait">部屋を作っています</p>');
    const settings = { ...st, hostColor: Math.random() < 0.5 ? BLACK : WHITE };
    try {
      const code = await Online.create(settings, onlineHandlers);
      net = { code, host: true, settings, color: settings.hostColor, g: 1, min: settings.min, waiting: true };
      onlineView(`<p>相手にこの合言葉を伝えてください</p><div class="on-code">${code}</div>
        <p class="on-set">${settingText(settings)}</p><p class="on-wait">相手が入るのを待っています</p>
        ${navigator.share ? '<button id="on-share">合言葉を送る</button>' : ''}<button id="on-cancel">やめる</button>`);
      if ($('#on-share')) $('#on-share').onclick = () => navigator.share({ text: `デストロイ碁で対戦しよう！「オンライン対戦（β）」で合言葉 ${code} を入れてね\nhttps://${PLAY_URL}/?ref=invite` }).catch(() => {});
      $('#on-cancel').onclick = () => { leaveOnline(); onlineBack(); };
      const n = net;
      setTimeout(() => {
        if (net !== n || !net.waiting) return;
        leaveOnline();
        onlineView('<p>相手が来なかったので、部屋を閉じました。</p><button id="on-back">戻る</button>');
        $('#on-back').onclick = onlineBack;
      }, IDLE_WAIT);
    } catch (e) { onlineError(e); }
  }
  async function onlineJoin(code, kind = 'friend') {
    if (!/^\d{4}$/.test(code)) { toast('4けたの数字を入れてください'); return; }
    onlineView('<p class="on-wait">つないでいます</p>');
    try {
      const settings = await Online.join(code, onlineHandlers);
      net = { code, host: false, settings, color: otherColor(settings.hostColor), g: 1, min: settings.min, kind };
      onlineStart();
    } catch (e) { onlineError(e); }
  }
  // 部屋の設定で対局を始める（自分の保存した設定は変えない。タイトルに戻ったら元に戻す）
  function onlineStart() {
    const st = net.settings;
    if (!net.saved) net.saved = { SIZE, mode, dAdvanced, rules, themes: { ...themes } };
    SIZE = st.size; mode = st.mode; dAdvanced = !!st.adv; rules = st.rules;
    net.waiting = false;
    // ランダムマッチ・ランクマッチでは、取っていない報酬の演出は使えない（開発者も）
    rankedNow = net.kind === 'random' || net.kind === 'rank';
    if (rankedNow) {
      const ok = themeKeys();
      for (const c of [BLACK, WHITE]) if (!unlocked(themes[c])) themes[c] = ok.find((k) => k !== themes[otherColor(c)]) || 'default';
    }
    buildThemeChips(); renderThemes();
    $('#online-pop').hidden = true; $('#modal').classList.remove('show');
    newGame();
    toast(`${{ random: 'ランダムマッチ', rank: 'ランクマッチ' }[net.kind] || 'オンライン対戦'}：あなたは${NAMES[net.color]}です`);
    if (net.kind === 'rank' && myRating) Online.send({ t: 'rt', r: myRating.r, n: myRating.n, name: myRating.name, g: net.g });
  }
  function leaveOnline() {
    stopSeek();
    if (!net) return;
    if (phase === 'play' && !net.waiting) Online.send({ t: 'resign', c: net.color, g: net.g }); // 対局の途中でやめたら投了
    Online.send({ t: 'bye', g: net.g });
    Online.leave();
    const sv = net.saved;
    net = null;
    if (rankedNow) { rankedNow = false; buildThemeChips(); }
    if (sv) { SIZE = sv.SIZE; mode = sv.mode; dAdvanced = sv.dAdvanced; rules = sv.rules; Object.assign(themes, sv.themes); renderThemes(); renderRules(); }
    $('#btn-undo').hidden = $('#btn-pause').hidden = false;
    $('#btn-again').textContent = 'もう一局'; $('#btn-again').disabled = false;
  }
  // 放置対策：結果の画面で 3 分、相手を待つ画面で 10 分たったら接続を切る（無料プランの同時接続の枠を空けるため）
  const IDLE_OVER = 3 * 60 * 1000, IDLE_WAIT = 10 * 60 * 1000;
  function onlineIdle() {
    const n = net, g = net.g;
    setTimeout(() => {
      if (net !== n || net.g !== g || phase !== 'over') return;
      leaveOnline();
      $('#btn-again').hidden = true;
      toast('しばらく操作がなかったので、オンライン対戦の接続を切りました');
    }, IDLE_OVER);
  }
  // ランクマッチ：相手のレートが届いたら、途中で抜けても負けになるよう、先に「負け」で記録しておく（勝てば終局で直す）
  function rankStart(opp) {
    if (!net || net.kind !== 'rank' || !myRating || net.opp) return;
    net.opp = opp; net.before = { ...myRating };
    toast(`相手：${opp.name.replace(/[<>&]/g, '')}${opp.u ? ` #${playerTag(opp.u)}` : ''}（レート ${opp.r}）`);
    myRating.fresh = false;
    myRating.r = eloNext(net.before, opp, false); myRating.n = net.before.n + 1; Object.assign(myRating, seasonCount(net.before)); saveRating();
  }
  function onlineGameEnd(winner) {
    if (!net || net.ended === net.g) return;
    net.ended = net.g;
    // ランダム・ランクマッチは同じ相手と続けて対戦しない（同じ相手とレートを動かし合う不正を防ぐ）。終わったら次の相手を探す
    if (net.kind === 'random' || net.kind === 'rank') { net.nextOnly = true; $('#btn-again').textContent = '次の相手を探す'; }
    if (net.kind === 'random') { try { localStorage.setItem('destroy-go-random-played', randomPlayed() + 1); } catch (e) { /* 無視 */ } syncProfile(); }
    if (net.kind === 'rank' && net.opp && net.before) {
      const win = winner === net.color;
      myRating.r = eloNext(net.before, net.opp, win); myRating.n = net.before.n + 1; Object.assign(myRating, seasonCount(net.before)); saveRating();
      lsSet('destroy-go-rank-played', '1');
      // 棋譜をランキングで見られるようにする（名前とレートも残す）
      if (kifu && kifu.moves.length) {
        const foe = otherColor(net.color);
        const k = JSON.parse(JSON.stringify({ ...kifu, cpu: null, names: { [net.color]: myRating.name, [foe]: net.opp.name },
          rates: { [net.color]: net.before.r, [foe]: net.opp.r }, owner: net.color,
          tags: { [net.color]: playerTag(Online.me()), [foe]: playerTag(net.opp.u || net.oppU) } }));
        Online.saveKifu(k).catch(() => {});
      }
      const d = myRating.r - net.before.r;
      $('#m-rate').textContent = `レート ${net.before.r} → ${myRating.r}（${d >= 0 ? '+' : ''}${d}）`; // 結果の画面に出す
      $('#m-rate').className = d >= 0 ? 'up' : 'down';
      saveReminder('レートや名前');
      claimFounder();
    }
  }
  // もう一局：2人とも押したら、色を入れ替えて始める
  // 相手が抜けたら「もう一局」は待たない。ランダム・ランクマッチなら次の相手を探すボタンにする
  function peerGoneAfterGame() {
    if (!net || phase !== 'over' || net.peerLeft) return;
    net.peerLeft = true;
    const btn = $('#btn-again');
    if (net.kind === 'random' || net.kind === 'rank') { btn.textContent = '次の相手を探す'; btn.disabled = false; return; } // もともと次の相手を探す
    btn.textContent = '相手が抜けました'; btn.disabled = true;
    toast('相手が抜けました');
  }
  function onlineAgain() {
    if (net && (net.peerLeft || net.nextOnly)) { // 次の相手を探す
      const kind = net.kind;
      leaveOnline(); $('#modal').classList.remove('show');
      openOnline(); onlineRandom(kind);
      return;
    }
    if (!net || net.again[Online.me()]) return;
    net.again[Online.me()] = true;
    Online.send({ t: 'again', g: net.g });
    $('#btn-again').textContent = '相手を待っています…';
    onlineAgainCheck();
  }
  function onlineAgainCheck() {
    if (Object.keys(net.again).length < 2) return;
    net.g++; net.color = otherColor(net.color); net.opp = null; net.before = null;
    $('#btn-again').textContent = 'もう一局';
    onlineStart();
  }
  function onlinePeer(e) {
    if (!net) return;
    if (e.joined && net.host && net.waiting) { net.peer = e.joined; onlineStart(); return; }
    if (e.left && !net.waiting) { net.gone = true; if (phase === 'over') peerGoneAfterGame(); else toast('相手の接続が切れました'); }
    if (e.back && net.gone) { net.gone = false; toast('相手が戻ってきました'); }
  }
  // 死に石：部屋を作った人の画面で判定して送る（判定にはばらつきがあるので、2人で同じ結果を使う）
  function deadStones() {
    const ask = () => askAI({ type: 'dead', state: aiState() }).then((r) => r.dead);
    if (!net) return ask();
    if (net.host) return ask().then((d) => { Online.send({ t: 'dead', d, g: net.g }); return d; });
    return new Promise((res) => { if (net.deadIn) res(net.deadIn); else net.deadWait = res; });
  }
  // ふつうの囲碁で 2 人がパスしたら、死に石を自動で判定してそのまま計算する
  function onlineScore() {
    phase = 'over'; clock.stop();
    toast('死に石を自動で判定して計算します');
    const serial = gameSerial;
    deadStones().then((d) => {
      if (serial !== gameSerial) return;
      dead = new Set(d); draw();
      later(() => $('#btn-calc').onclick(), 1200);
    });
  }
  // オンライン対戦で、相手と色がかぶったとき：ランキング報酬を使っている人を優先し、もう片方（どちらも同じなら白）が別の演出に変える
  function resolveThemeClash() {
    if (!net) return;
    const mine = net.color, foe = otherColor(mine);
    if (!clash(themes[mine], themes[foe])) return;
    const rM = !!SEASON_REWARDS[themes[mine]], rF = !!SEASON_REWARDS[themes[foe]];
    if (rM && !rF) return; // 自分が優先。相手の画面で相手が変える
    if (rM === rF && mine === BLACK) return; // どちらも同じなら白が変える
    themes[mine] = themeKeys().find((k) => !clash(k, themes[foe])) || 'default';
    Online.send({ t: 'th', c: mine, k: themes[mine], g: net.g });
    toast(`相手と演出の色がかぶったので、${themeOf(themes[mine]).label}に変えました`);
  }
  // 相手から届いたものを盤に反映する（自分が送ったものは、もう反映してあるので飛ばす）
  function onlineMove(m) {
    if (!net || !m || m.u === Online.me()) return;
    if (!net.oppU) { // 相手が初代デストロイヤーなら知らせる
      net.oppU = m.u;
      if (m.u === DEV_UID) toast('相手は 🛠 開発者（ROBIT）');
      else Promise.all([loadFounders(), loadSeason()]).then(([f, sr]) => {
        if (!net || net.oppU !== m.u) return;
        const n = f.list[m.u], r = seasonResult(sr, m.u), t = r && seasonTier(r.rank);
        const who = [n ? `👑 初代デストロイヤー #${String(n).padStart(2, '0')}` : '', t ? `🏆 S${SEASON.id} ${t.tag}` : ''].filter(Boolean).join('・');
        if (who) toast(`相手は ${who}`);
      });
    }
    if (m.t === 'again') { if (m.g === net.g) { net.again[m.u] = true; onlineAgainCheck(); } return; }
    if (m.t === 'bye') { if (phase === 'over') peerGoneAfterGame(); else if (!net.waiting) toast('相手が対局をやめました'); return; }
    if (m.g !== net.g) return;
    const foe = otherColor(net.color);
    if (m.t === 'th') { if (m.c === foe) { themes[foe] = m.k; resolveThemeClash(); renderThemes(); draw(); } return; }
    if (m.t === 'rt') { rankStart({ r: m.r, n: m.n || 0, name: String(m.name || ''), u: m.u }); return; }
    if (m.t === 'dead') { const d = m.d || []; if (net.deadWait) { net.deadWait(d); net.deadWait = null; } else net.deadIn = d; return; }
    if (phase !== 'play') return;
    if (m.t === 'resign') { endGame(`${NAMES[otherColor(m.c)]}の中押し勝ち`, `${NAMES[m.c]}が投了しました`, otherColor(m.c)); return; }
    if (m.t === 'timeout') { updatePanels(); endGame(`${NAMES[otherColor(m.c)]}の時間切れ勝ち`, `${NAMES[m.c]}の持ち時間がなくなりました`, otherColor(m.c)); return; }
    if (game.turn !== foe) return; // 手番がずれた手は使わない
    net.applying = true; net.zeroAt = 0;
    try {
      if (m.t === 'pass') doPass('（相手）');
      else if (m.t === 'p') { spurtOverride = !!m.s; playAt(m.p, m.c || 0, !!m.x); }
    } finally { net.applying = false; spurtOverride = null; }
    if (typeof m.r === 'number' && net) { clock.remain[foe] = m.r; updatePanels(); } // 持ち時間は相手の画面の値に合わせる
  }
  // タイトルの「対局開始」の下：ランダムマッチはすぐ探し始め、フレンド対戦は合言葉の画面を開く
  document.querySelectorAll('.on-item.soon').forEach((el) => { el.onclick = () => toast(`「${el.firstChild.textContent}」は準備中です。お楽しみに！`); });
  $('#btn-random-top').onclick = () => { FX.unlock(); if (!Online.available()) { toast('オンライン対戦は準備中です'); return; } openOnline(); onlineRandom('random'); };
  $('#btn-online-rules').onclick = () => openRulesFor(false);
  $('#btn-friend-top').onclick = () => { FX.unlock(); track('フレンド対戦を開いた'); if (!Online.available()) { toast('オンライン対戦は準備中です'); return; } openOnline('friend'); };
  // ランクマッチは開放の条件をそろえるまで押せない（押すと、あと何が必要か案内する）
  function renderRankTop() {
    $('#btn-random-top span').textContent = isBattleTime() ? `🔥 対戦タイム中${isWeekend() ? '・13路' : ''}` : `${isWeekend() ? '週末は13路・' : ''}対戦タイム 毎晩${BATTLE_FROM}時〜`;
    const open = rankOpen(), btn = rankButtonOpen();
    $('#btn-rank-top').classList.toggle('locked', !btn);
    $('#rank-top-note').textContent = !btn ? `🔒 あと${rankRandomLeft()}局で開放` : open ? 'レートをかけて対戦' : 'まず上級をCPUで1勝';
    if (myRating && !myRating.fresh) $('#home-me').innerHTML = `${nameHtml(myRating.name)}${isDev() ? devBadge : founderBadge(myFounder)}　レート ${myRating.r}`;
    $('#btn-rank-top').title = open ? 'デストロイ上級・9路でレートをかけて対戦' : `ランクマッチまで：${rankLockText()}`;
  }
  renderRankTop();
  setInterval(() => { if (phase === 'title') renderRankTop(); }, 60000); // 対戦タイムの始まり・終わりで表示を変える
  $('#btn-rank-top').onclick = () => {
    FX.unlock(); if (!Online.available()) { toast('オンライン対戦は準備中です'); return; }
    if (!rankOpen() || lsGet('destroy-go-rank-intro') !== '1') { rankGuide(); return; }
    openOnline(); onlineRandom('rank');
  };
  // オンラインの画面から始める CPU 戦（待ち時間の CPU 戦・上級の練習）。強さは選べて、選んだ強さを覚えておく
  const onlineCpuLevel = () => Math.min(9, Math.max(1, +lsGet('destroy-go-online-cpu-level') || 1));
  const cpuLevelRow = () => `<div class="on-lv"><span>CPU の強さ</span>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((lv) => `<button data-lv="${lv}" aria-pressed="${lv === onlineCpuLevel()}">${lv}</button>`).join('')}</div>`;
  function bindCpuLevelRow() {
    $('#online-body').querySelectorAll('.on-lv button').forEach((b) => {
      b.onclick = () => { lsSet('destroy-go-online-cpu-level', b.dataset.lv); $('#online-body').querySelectorAll('.on-lv button').forEach((x) => x.setAttribute('aria-pressed', x === b)); };
    });
  }
  // adv：上級ルールにするか。9 路・置き石なしで始める
  function startOnlineCpu(adv) {
    $('#online-pop').hidden = true; clearStage();
    $('#opp-chips .chip[data-opp="cpu"]').click();
    $(`#level-chips .chip[data-level="${onlineCpuLevel()}"]`).click();
    $('#hc-chips .chip[data-hc="0"]').click();
    $('#size-chips .chip[data-size="9"]').click();
    $('#mode-chips .chip[data-mode="destroy"]').click();
    $(`#dlevel-chips .chip[data-level="${adv ? 'advanced' : 'simple'}"]`).click();
    FX.unlock(); newGame();
  }
  // ランクマッチの案内：開くまでの条件と、上級ルールで加わること。初めて入る前にも 1 回出す
  const ADV_POINTS = [
    ['ため撃ち', '取れる手を長押しして MAX まで溜めるとダメージ 1.5 倍。ただし増えた分だけ自分の HP も減る（反動）。相手を K.O. したときは反動なし'],
    ['背水・カウンター', '自分の HP が 4 分の 1 以下だと 1.2 倍（背水）。取られた直後に、取りに来た石ごと取り返すと 1.5 倍（カウンター）'],
    ['コンボ', '続けて取ると倍率が上がる'],
    ['ラストスパート', '終盤（2 人の残り時間が少ない・盤が 7 割埋まった）はダメージが増える'],
    ['2眼で回復', '2 眼で取られなくなった石が増えると HP が回復する'],
  ];
  function rankGuide() {
    const open = rankOpen(), btn = rankButtonOpen(), won = advCpuWon();
    openOnline();
    const head = !btn ? `<p class="on-rule">ランクマッチまで：<b>${rankLockText()}</b></p>`
      : !open ? '<p class="on-rule">あと 1 つ！<b>上級ルールの CPU 戦で 1 勝</b>すると、ランクマッチに入れます。</p>' : '';
    onlineView(`<p class="on-title">🏆 ランクマッチ（デストロイ上級）</p>
      ${head}<p>ランクマッチは<b>上級ルール</b>です。ランダムマッチ（初級）に、次のルールが加わります。</p>
      <ul class="on-list">${ADV_POINTS.map(([k, d]) => `<li><b>${k}</b>：${d}</li>`).join('')}</ul>
      <p class="on-rule">ランクマッチ・ランダムマッチでは<b>死に石を判定しません</b>。相手の地に残った死んでいる石は、パスする前に取りきろう（取ればダメージにもなる）。</p>
      ${open ? '<button class="accent" id="on-rank-go">わかった、ランクマッチへ</button>' : ''}
      ${btn && !open ? '<button class="accent" id="on-adv-cpu">上級ルールで CPU と戦う<small>勝つとランクマッチに入れます</small></button>'
        : `<button id="on-adv-cpu">${won ? 'CPU で上級を練習する' : '先に CPU で上級を試す'}</button>`}
      ${cpuLevelRow()}
      <button id="on-adv-rules">ルールを詳しく見る</button>
      <p class="on-note">β版のため、シーズンの合間にバランスを調整することがあります。</p>
      <button id="on-back">戻る</button>`);
    bindCpuLevelRow();
    if ($('#on-rank-go')) $('#on-rank-go').onclick = () => { lsSet('destroy-go-rank-intro', '1'); onlineRandom('rank'); };
    $('#on-adv-cpu').onclick = () => startOnlineCpu(true);
    $('#on-adv-rules').onclick = () => openRulesFor(true);
    $('#on-back').onclick = onlineBack;
  }
  $('#btn-ranking-top').onclick = () => { FX.unlock(); if (!Online.available()) { toast('オンライン対戦は準備中です'); return; } openOnline(); showRanking(); };
  $('#online-close').onclick = () => { if (seekStop) { stopSeek(); Online.leave(); } if (net && net.waiting) leaveOnline(); $('#online-pop').hidden = true; };

  homeReady = true;
  setTimeout(claimPioneer, 3000); // B18F を突破済みなら、深淵の開拓者に名乗り出る（オンラインの準備ができてから）
  // ホーム画面のアイコンから開いた（＝ホーム画面に追加してくれた）ことを、1 台につき 1 日 1 回だけ数える
  (function trackHomeScreen() {
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    if (!standalone) return;
    const d = new Date().toISOString().slice(0, 10);
    if (lsGet('destroy-go-hs-day') === d) return;
    lsSet('destroy-go-hs-day', d); track('ホーム画面のアイコンから開いた');
  })();
  window.addEventListener('appinstalled', () => track('ホーム画面に追加した')); // Android の Chrome などで、追加したその時
  renderDojoHome();
  renderThemes();
  renderRules();
  renderHints();
  requestAnimationFrame(tick);
})();
