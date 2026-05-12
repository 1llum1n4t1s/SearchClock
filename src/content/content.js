// SearchClock — Google検索ページに設定パネルを埋め込み
// Shadow DOMでスタイルを完全に分離、Googleのライト/ダークテーマに自動対応
// PRESETS / QDR_LABELS / VALID_QDR_VALUES / DEFAULT_SETTINGS / refPresetIndex /
// TBS_PARAM_KEY / QDR_PREFIX / extractQdrFromTbs は src/shared/presets.js から注入される
// （同一 content_scripts 内で共有、manifest.json の js 配列で先に読み込まれる）

function isDarkTheme() {
  const bg = window.getComputedStyle(document.body).backgroundColor;
  const match = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return false;
  return (parseInt(match[1]) + parseInt(match[2]) + parseInt(match[3])) / 3 < 128;
}

function qdrToLabel(qdr) {
  return qdr ? (QDR_LABELS[qdr] || qdr) : '期間指定なし';
}

// URL の tbs から qdr 値を抽出（不正値・存在しない場合は ''）
function urlQdr(url) {
  const qdr = extractQdrFromTbs(url.searchParams.get(TBS_PARAM_KEY));
  return qdr && VALID_QDR_VALUES.has(qdr) ? qdr : '';
}

// SW へ qdr 更新を送ってからナビゲーション。
// SW タイムアウト・起動失敗等でコールバック未到達でもページがフリーズしないよう、
// 3 秒で強制遷移するフォールバックを持つ。二重ナビゲーションを防ぐため navigated フラグで一度きり。
function sendQdrAndNavigate(qdr, dest) {
  let navigated = false;
  const go = () => {
    if (navigated) return;
    navigated = true;
    window.location.href = dest;
  };
  const fallback = setTimeout(go, 3000);
  chrome.runtime.sendMessage({ type: 'updateQdr', qdr }, () => {
    clearTimeout(fallback);
    void chrome.runtime.lastError; // SW 再起動時などのエラーは無視して遷移優先
    go();
  });
}

// Google が将来 #center_col を改名・廃止しても無音で全停止しないよう、複数候補を順に試す。
// 先頭ほど現在の Google 検索 UI の主要構造に近い。すべて見つからなければ警告して退出。
function findInjectionTarget() {
  return (
    document.getElementById('center_col') ||
    document.querySelector('#rcnt main') ||
    document.querySelector('main[role="main"]') ||
    document.querySelector('#rcnt') ||
    null
  );
}

function initSearchClock() {
  const centerCol = findInjectionTarget();
  if (!centerCol) {
    console.warn('[SearchClock] 注入先 (#center_col / fallback) が見つかりません。Google の DOM 変更の可能性があります。');
    return;
  }

  // 現在URL: 通常ナビゲーションでは content script ごと作り直されるが、
  // bfcache 復元時は同一インスタンスが再利用されるため pageshow で更新可能なよう let
  let cachedCurrentUrl = new URL(window.location.href);
  // このページの実際の絞り込み状態（tbsパラメータが真実）
  let currentQdr = urlQdr(cachedCurrentUrl);

  const root = document.createElement('div');
  root.id = 'searchclock-root';
  const shadow = root.attachShadow({ mode: 'closed' });

  shadow.appendChild(Object.assign(document.createElement('style'), {
    textContent: getStyles(isDarkTheme()),
  }));

  const panel = buildPanel();
  shadow.appendChild(panel);

  // updateUI が触る要素を一度だけ解決してキャッシュ（毎回 getElementById する 7 回分を排除）
  const refs = {
    status: shadow.getElementById('sc-status'),
    tbs: shadow.getElementById('sc-tbs'),
    issueNo: shadow.getElementById('sc-issue-no'),
    panel: shadow.getElementById('sc-panel'),
    keepInput: shadow.getElementById('sc-keep-input'),
    keepWrap: shadow.getElementById('sc-keep'),
    modeChip: shadow.getElementById('sc-mode-chip'),
    radios: shadow.querySelectorAll('input[name="qdr"]'),
  };

  // 初期状態を反映（URLベースの qdr + storage の keepSetting）
  // NOTE: 旧版ではここで keepSetting=OFF 時に storage.qdr を強制クリアしていたが、
  // 複数タブで同じ Google を開いている時に「タブ A の OFF 時クリアがタブ B (ON モード) の
  // DNR ルールを破壊する」問題があったため廃止。background は keepSetting=false の間は
  // ルールを作らないので storage.qdr に残値があっても無害。
  chrome.storage.sync.get(DEFAULT_SETTINGS, ({ keepSetting }) => {
    updateUI(refs, currentQdr, keepSetting);
  });

  // プリセット選択 → background.jsのルール更新完了を待ってからナビゲーション
  for (const radio of refs.radios) {
    radio.addEventListener('change', () => {
      const qdr = radio.value;
      // URLSearchParams はコロンを %3A にエンコードしてしまうため手動で tbs を構築。
      // 既存 tbs から qdr セグメントだけ除去し、画像サイズ (isz) / ソート (sbd) などの
      // ユーザー指定フィルタは保持する。
      const url = new URL(window.location.href);
      const existingTbs = url.searchParams.get(TBS_PARAM_KEY);
      url.searchParams.delete(TBS_PARAM_KEY);
      let dest = url.toString();

      const otherSegments = existingTbs
        ? existingTbs.split(',').filter((s) => !s.startsWith(QDR_PREFIX))
        : [];
      const newSegments = qdr ? [`${QDR_PREFIX}${qdr}`, ...otherSegments] : otherSegments;
      if (newSegments.length > 0) {
        dest += (dest.includes('?') ? '&' : '?') + `${TBS_PARAM_KEY}=${newSegments.join(',')}`;
      }

      // storage.qdr を更新しておく：
      //   ON モードなら declarativeNetRequest ルールが再構築される
      //   OFF モードなら background はルールを作らないが、storage の値は表示同期に使われる
      sendQdrAndNavigate(qdr, dest);
    });
  }

  // 「期間を維持」switch のトグル
  // OFF→ON 切替時は、今このページで適用されている qdr (URL の tbs 由来) を新しい維持値として保存。
  // 「1年で絞り込み中に維持を ON にしたら 1年が引き継がれる」直感に合わせた挙動。
  // ON→OFF 切替時は keepSetting だけ変える（storage.qdr は次の updateQdr メッセージまで残るが、
  // background が keepSetting=false の間は DNR ルールを作らないので無害）。
  // storage.sync は MAX_WRITE_OPERATIONS_PER_MINUTE=120 のクォータがあるため、
  // 連打を 500ms debounce で吸収する（誤クリック連発でクォータ枯渇させない安全策）。
  let keepInputTimer = null;
  refs.keepInput.addEventListener('change', () => {
    const next = !!refs.keepInput.checked;
    // updateUI で disabled にしているが、キーボード操作や race を念のため二重防御。
    // qdr='' での「維持 ON」は紫バッジだけ点いて実際は固定されない偽状態を作るので拒否。
    if (next && !currentQdr) {
      refs.keepInput.checked = false;
      return;
    }
    clearTimeout(keepInputTimer);
    keepInputTimer = setTimeout(async () => {
      const finalNext = !!refs.keepInput.checked; // debounce 中に再変更された最終状態を採用
      const updates = finalNext
        ? { keepSetting: true, qdr: currentQdr }
        : { keepSetting: false };
      try {
        await chrome.storage.sync.set(updates);
      } catch (err) {
        console.warn('[SearchClock] keepSetting 保存失敗:', err?.message ?? err);
        refs.keepInput.checked = !finalNext; // UI ロールバック
      }
    }, 500);
  });

  // 外部からの変更を監視
  //   - keepSetting 変更 → pin pill の表示更新
  //   - qdr 変更 → URL は不変なので状態カードは更新しない（URLが真実）
  const storageListener = (changes, area) => {
    if (area !== 'sync') return;
    if (changes.keepSetting) {
      updateUI(refs, currentQdr, !!changes.keepSetting.newValue);
    }
  };
  chrome.storage.onChanged.addListener(storageListener);

  // Google検索ツールの期間フィルター変更を検出 → 拡張機能をオフ（後勝ち）
  // tbs 全体ではなく qdr セグメントだけを比較することで、画像サイズ等の
  // 期間外 tbs 変更（"isz:l,qdr:y" 等）での誤発動を防ぐ。
  let currentQdrParam = extractQdrFromTbs(cachedCurrentUrl.searchParams.get(TBS_PARAM_KEY));
  let currentTbm = cachedCurrentUrl.searchParams.get('tbm');

  const clickHandler = (e) => {
    const link = e.target.closest('a');
    if (!link || !link.href) return;
    // 文字列レベルの早期リターンで URL パースコストを削減
    // /search 含まないリンクは無関係。tbs 含まず & 現在も qdr 無しなら判定不要。
    const href = link.href;
    if (!href.includes('/search')) return;
    if (!href.includes('tbs=') && !currentQdrParam) return;

    try {
      const linkUrl = new URL(href);
      if (linkUrl.hostname !== cachedCurrentUrl.hostname) return;
      if (!linkUrl.pathname.includes('/search')) return;

      const linkQdr = extractQdrFromTbs(linkUrl.searchParams.get(TBS_PARAM_KEY));

      // qdr セグメントが変わっていない → 期間以外の tbs 変更なので対象外
      if (linkQdr === currentQdrParam) return;

      if (linkQdr === null) {
        // qdr が消えるリンク（「期間指定なし」を選んだ）→ 現在 qdr がある場合のみ対象
        if (!currentQdrParam) return;
        // 検索結果内のリンクは対象外
        if (link.closest('#rso')) return;
        // 検索タイプ切替（画像/ニュース等）は対象外
        if (linkUrl.searchParams.get('tbm') !== currentTbm) return;
      }

      e.preventDefault();
      // linkUrl.href は new URL() で正規化・hostname 検証済みの値を使う（href 直渡しより防御的）
      sendQdrAndNavigate('', linkUrl.href);
    } catch (err) {
      console.warn('[SearchClock] リンク処理エラー:', err instanceof Error ? err.message : err);
    }
  };
  document.addEventListener('click', clickHandler, true);

  // bfcache 復元時に状態を再評価（cachedCurrentUrl が古いままだと clickHandler が誤判定するため）
  const pageshowHandler = (e) => {
    if (!e.persisted) return;
    cachedCurrentUrl = new URL(window.location.href);
    currentQdr = urlQdr(cachedCurrentUrl);
    currentQdrParam = extractQdrFromTbs(cachedCurrentUrl.searchParams.get(TBS_PARAM_KEY));
    currentTbm = cachedCurrentUrl.searchParams.get('tbm');
    chrome.storage.sync.get(DEFAULT_SETTINGS, ({ keepSetting }) => {
      updateUI(refs, currentQdr, keepSetting);
    });
  };
  window.addEventListener('pageshow', pageshowHandler);

  // root を先に挿入してから監視を開始（observe を先に呼ぶと、Google ページの動的更新で
  // 「root がまだ body に入っていない」状態で cleanup が即発火してしまう）
  centerCol.insertBefore(root, centerCol.firstChild);

  // ルートが削除されたらクリーンアップ。
  // centerCol の childList と、その親の childList を両方監視することで、
  //   - root が centerCol から取り除かれるケース
  //   - centerCol 自体が差し替えられる SPA 的遷移
  // の両方を捕捉。subtree: true は Google ページの mutation 頻度が高すぎて重いので使わない。
  // 親と子の両方を observe しているため同一フレームで 2 回 callback されうる。
  // cleaned フラグで二重実行を防止（removeListener/disconnect 自体は冪等だが contains() の DOM 探索が無駄）。
  let cleaned = false;
  const observer = new MutationObserver(() => {
    if (cleaned) return;
    if (!document.body.contains(root)) {
      cleaned = true;
      chrome.storage.onChanged.removeListener(storageListener);
      document.removeEventListener('click', clickHandler, true);
      window.removeEventListener('pageshow', pageshowHandler);
      observer.disconnect();
    }
  });
  observer.observe(centerCol, { childList: true });
  if (centerCol.parentNode) {
    observer.observe(centerCol.parentNode, { childList: true });
  }
}

// UI 全体の状態を更新（qdr は URL から導出した実絞り込み、keepSetting は維持モード）
// refs は initSearchClock で一度だけキャッシュされた DOM 参照
function updateUI(refs, qdr, keepSetting) {
  for (const radio of refs.radios) {
    radio.checked = radio.value === (qdr || '');
  }

  refs.status.textContent = qdrToLabel(qdr);
  refs.tbs.textContent = qdr ? `${QDR_PREFIX}${qdr}` : '—';
  refs.issueNo.textContent = refPresetIndex(qdr);
  refs.panel.classList.toggle('is-active', !!qdr);

  // 期間未設定で維持 ON にすると background は qdr='' のため DNR ルール無しで動き、
  // バッジだけ「維持中」になる偽の維持状態が成立してしまう。先にプリセット選択を促すため disable。
  refs.keepInput.disabled = !qdr;
  refs.keepInput.checked = !!keepSetting;
  refs.keepWrap.title = !qdr
    ? '先に期間を選んでください（未設定では維持できません）'
    : keepSetting
      ? '期間を維持中：次の検索でも設定が適用されます'
      : '一回限り：次の検索で自動的にオフに戻ります';
  // モード表示: ON=keep / OFF=once（常時表示で「壊れた」誤認を防ぐ）
  const mode = keepSetting ? 'keep' : 'once';
  refs.keepWrap.dataset.mode = mode;
  refs.modeChip.textContent = keepSetting ? '維持中' : '1回限り';
  refs.modeChip.dataset.mode = mode;
}

// 区切り点（dot separator）を作る小さなヘルパ
function buildDot() {
  const dot = document.createElement('span');
  dot.className = 'sc-dot';
  dot.setAttribute('aria-hidden', 'true');
  dot.textContent = '·';
  return dot;
}

// パネルを DOM API で組み立て（innerHTML を避けて将来的な XSS 混入を防止）
function buildPanel() {
  const panel = document.createElement('div');
  panel.className = 'sc-panel';
  panel.id = 'sc-panel';

  // ─── ヘッダー（1 行に圧縮：mark · title · No. · 状態 · tbs · keep pill） ─────
  const header = document.createElement('div');
  header.className = 'sc-header';

  const mark = document.createElement('span');
  mark.className = 'sc-mark';
  mark.appendChild(buildLogoSvg(12));
  header.appendChild(mark);

  const title = document.createElement('span');
  title.className = 'sc-title';
  title.textContent = 'SearchClock';
  header.appendChild(title);

  header.appendChild(buildDot());

  const issue = document.createElement('span');
  issue.className = 'sc-issue';
  const issueEn = document.createElement('span');
  issueEn.className = 'sc-issue-en';
  issueEn.textContent = 'No.';
  const issueNo = document.createElement('span');
  issueNo.className = 'sc-issue-no';
  issueNo.id = 'sc-issue-no';
  issueNo.textContent = '—';
  issue.appendChild(issueEn);
  issue.appendChild(issueNo);
  header.appendChild(issue);

  header.appendChild(buildDot());

  const status = document.createElement('span');
  status.className = 'sc-status';
  status.id = 'sc-status';
  status.textContent = '期間指定なし';
  header.appendChild(status);

  // tbs ラベル（右寄せ）
  const tbsWrap = document.createElement('span');
  tbsWrap.className = 'sc-tbs-wrap';
  const tbsLabel = document.createElement('span');
  tbsLabel.className = 'sc-tbs-label';
  tbsLabel.textContent = 'tbs=';
  const tbs = document.createElement('span');
  tbs.className = 'sc-tbs';
  tbs.id = 'sc-tbs';
  tbs.textContent = '—';
  tbsWrap.appendChild(tbsLabel);
  tbsWrap.appendChild(tbs);
  header.appendChild(tbsWrap);

  // モードチップ（switch の左隣・現在のモードを常時可視化、once 誤認防止）
  const modeChip = document.createElement('span');
  modeChip.className = 'sc-mode-chip';
  modeChip.id = 'sc-mode-chip';
  modeChip.dataset.mode = 'once';
  modeChip.textContent = '1回限り';
  header.appendChild(modeChip);

  // 「期間を維持」switch + 日本語ラベル
  const keepWrap = document.createElement('label');
  keepWrap.className = 'sc-keep';
  keepWrap.id = 'sc-keep';

  const keepLabel = document.createElement('span');
  keepLabel.className = 'sc-keep-label';
  keepLabel.textContent = '期間を維持';
  keepWrap.appendChild(keepLabel);

  const keepSwitch = document.createElement('span');
  keepSwitch.className = 'sc-keep-switch';

  const keepInput = document.createElement('input');
  keepInput.type = 'checkbox';
  keepInput.id = 'sc-keep-input';
  keepInput.setAttribute('aria-label', '期間を維持');
  keepSwitch.appendChild(keepInput);

  const keepTrack = document.createElement('span');
  keepTrack.className = 'sc-keep-track';
  keepTrack.setAttribute('aria-hidden', 'true');
  keepSwitch.appendChild(keepTrack);

  keepWrap.appendChild(keepSwitch);
  header.appendChild(keepWrap);

  panel.appendChild(header);

  // ─── プリセット行（1 行 11 列） ───────────────────────
  const presetsWrap = document.createElement('div');
  presetsWrap.className = 'sc-presets';
  for (const { shortLabel, en, value } of PRESETS) {
    const label = document.createElement('label');
    label.className = 'sc-preset';
    if (!value) label.dataset.off = 'true';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'qdr';
    input.value = value;
    label.appendChild(input);

    const chip = document.createElement('span');
    chip.className = 'sc-chip';

    const jp = document.createElement('span');
    jp.className = 'sc-chip-jp';
    jp.textContent = shortLabel;
    chip.appendChild(jp);

    const enEl = document.createElement('span');
    enEl.className = 'sc-chip-en';
    enEl.textContent = en;
    chip.appendChild(enEl);

    label.appendChild(chip);
    presetsWrap.appendChild(label);
  }
  panel.appendChild(presetsWrap);

  return panel;
}

function buildLogoSvg(size) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'sc-logo');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '10');
  svg.appendChild(circle);

  const hand = document.createElementNS(SVG_NS, 'polyline');
  hand.setAttribute('points', '12,6 12,12 16,14');
  svg.appendChild(hand);

  return svg;
}

// フォントは system font fallback のみ（フィンガープリント窓口を閉じるため
// web_accessible_resources でのフォント公開は廃止）
// Hiragino Sans / Noto Sans JP / Segoe UI が日本語環境ではほぼ常に利用可能

// テーマ変数（ライト = ラベンダー紙×紫、ダーク = 墨黒×明紫）
const THEME_DARK = `
    :host {
      --ink: #efe8df;
      --ink-soft: #b0a89c;
      --ink-faint: #6b6358;
      --paper: #1d181f;
      --paper-deep: #14101a;
      --paper-card: #25202a;
      --rule: #3a3340;
      --rule-soft: #2a242e;
      --rule-strong: #54454f;
      --accent: #a892e2;
      --accent-deep: #c2b0eb;
      --accent-soft: #2a2240;
    }
  `;
const THEME_LIGHT = `
    :host {
      --ink: #1f1c2b;
      --ink-soft: #564f6b;
      --ink-faint: #988ea7;
      --paper: #fbfaff;
      --paper-deep: #f3f0fa;
      --paper-card: #ffffff;
      --rule: #e4dff0;
      --rule-soft: #efebf6;
      --rule-strong: #cdc5e0;
      --accent: ${ACCENT_COLOR};
      --accent-deep: #4D3590;
      --accent-soft: #ede9f7;
    }
  `;

// 注入パネル: 縦の高さを最小化（ヘッダ + chip 行の 2 段、合計 ~62px）
const STYLES_COMMON = `
    :host {
      all: initial;
      display: block;
      width: 100%;
      margin: 0 0 10px;
      font-family: "Hiragino Sans", "Noto Sans JP", "Segoe UI", system-ui, sans-serif;
      font-size: 12px;
      line-height: 1.4;
      color: var(--ink);
    }

    .sc-panel {
      background: var(--paper);
      border: 1px solid var(--rule);
      border-radius: 10px;
      overflow: hidden;
      position: relative;
      transition: border-color 200ms ease, box-shadow 200ms ease;
    }
    /* 上端の小口飾り（accent + ink） */
    .sc-panel::before {
      content: "";
      position: absolute;
      top: 0; left: 14px; right: 14px;
      height: 1.5px;
      background: linear-gradient(
        to right,
        var(--accent) 0,
        var(--accent) 24px,
        var(--ink) 24px,
        var(--ink) 26px,
        transparent 26px
      );
    }
    .sc-panel.is-active {
      border-color: var(--rule-strong);
      box-shadow: inset 2px 0 0 var(--accent);
    }

    /* ── Header (1行に集約、~28px) ─────────── */
    .sc-header {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 6px 12px 5px;
      border-bottom: 1px dashed var(--rule);
      min-height: 26px;
      flex-wrap: nowrap;
      overflow: hidden;
    }
    .sc-mark {
      display: inline-grid; place-items: center;
      width: 18px; height: 18px;
      color: var(--accent);
      flex-shrink: 0;
      align-self: center;
    }
    .sc-logo { display: block; }

    .sc-title {
      font-family: "Hiragino Mincho ProN", "Hiragino Mincho Pro", "Noto Serif JP", Georgia, serif;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.04em;
      color: var(--ink);
      flex-shrink: 0;
    }

    .sc-dot {
      color: var(--ink-faint);
      font-size: 11px;
      line-height: 1;
      flex-shrink: 0;
    }

    .sc-issue {
      display: inline-flex; align-items: baseline; gap: 3px;
      font-family: "SFMono-Regular", "Cascadia Mono", Consolas, "Courier New", monospace;
      font-size: 9px;
      color: var(--ink-faint);
      letter-spacing: 0.08em;
      flex-shrink: 0;
    }
    .sc-issue-en {
      font-style: italic;
      font-family: "Hiragino Mincho ProN", "Hiragino Mincho Pro", "Noto Serif JP", Georgia, serif;
    }
    .sc-issue-no {
      font-variant-numeric: tabular-nums;
      color: var(--accent-deep);
      font-weight: 600;
      font-size: 10.5px;
    }

    .sc-status {
      font-family: "Hiragino Mincho ProN", "Hiragino Mincho Pro", "Noto Serif JP", Georgia, serif;
      font-size: 11.5px;
      font-weight: 600;
      letter-spacing: 0.03em;
      color: var(--ink);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sc-panel.is-active .sc-status { color: var(--accent-deep); }

    .sc-tbs-wrap {
      margin-left: auto;
      display: inline-flex; align-items: baseline; gap: 2px;
      font-family: "SFMono-Regular", "Cascadia Mono", Consolas, "Courier New", monospace;
      font-size: 9.5px;
      letter-spacing: 0.04em;
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
    }
    .sc-tbs-label { color: var(--ink-faint); }
    .sc-tbs { color: var(--ink-soft); }
    .sc-panel.is-active .sc-tbs { color: var(--accent); font-weight: 600; }

    /* ── Mode chip（1回限り / 維持中の常時可視化） ── */
    .sc-mode-chip {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      border-radius: 99px;
      font-family: "Hiragino Sans", "Noto Sans JP", "Segoe UI", sans-serif;
      font-size: 9.5px;
      letter-spacing: 0.06em;
      font-weight: 600;
      flex-shrink: 0;
      border: 1px solid var(--rule-strong);
      background: var(--paper-deep);
      color: var(--ink-soft);
      transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
    }
    .sc-mode-chip[data-mode="keep"] {
      background: var(--accent-soft);
      color: var(--accent-deep);
      border-color: var(--accent);
    }

    /* ── Switch（期間を維持） ─────────────── */
    .sc-keep {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 2px 8px 2px 10px;
      background: var(--paper-card);
      border: 1px solid var(--rule);
      border-radius: 99px;
      cursor: pointer;
      flex-shrink: 0;
      transition:
        background 140ms ease,
        border-color 140ms ease;
    }
    .sc-keep:hover {
      border-color: var(--rule-strong);
    }
    .sc-keep:has(input:checked) {
      background: var(--accent-soft);
      border-color: var(--accent);
    }
    .sc-keep-label {
      font-family: "Hiragino Sans", "Noto Sans JP", "Segoe UI", sans-serif;
      font-size: 11.5px;
      letter-spacing: 0.04em;
      color: var(--ink-soft);
      font-weight: 500;
      user-select: none;
      transition: color 140ms ease;
    }
    .sc-keep:hover .sc-keep-label { color: var(--ink); }
    .sc-keep:has(input:checked) .sc-keep-label {
      color: var(--accent-deep);
      font-weight: 600;
    }

    .sc-keep-switch {
      position: relative;
      width: 26px;
      height: 14px;
      flex-shrink: 0;
    }
    .sc-keep-switch input {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      opacity: 0;
      cursor: pointer;
      z-index: 2;
    }
    .sc-keep-track {
      position: absolute;
      inset: 0;
      background: var(--rule-strong);
      border-radius: 5px;
      transition: background 180ms ease;
    }
    .sc-keep-track::before {
      content: "";
      position: absolute;
      width: 10px;
      height: 10px;
      top: 2px;
      left: 2px;
      background: var(--paper);
      border-radius: 3px;
      transition: transform 200ms cubic-bezier(0.65, 0, 0.35, 1);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }
    .sc-keep-switch input:checked + .sc-keep-track {
      background: var(--accent);
    }
    .sc-keep-switch input:checked + .sc-keep-track::before {
      transform: translateX(12px);
    }
    .sc-keep-switch input:focus-visible + .sc-keep-track {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    /* ── Presets (1 行 × N 列、N = PRESETS.length) ──────────── */
    .sc-presets {
      display: grid;
      grid-template-columns: repeat(${PRESETS.length}, minmax(0, 1fr));
      gap: 4px;
      padding: 5px 10px 7px;
    }
    /* 狭幅では半数列にフォールバック */
    @media (max-width: 640px) {
      .sc-presets { grid-template-columns: repeat(${Math.ceil(PRESETS.length / 2)}, minmax(0, 1fr)); }
    }

    .sc-preset {
      cursor: pointer;
      display: block;
      position: relative;
    }
    .sc-preset input[type="radio"] {
      position: absolute;
      opacity: 0;
      pointer-events: none;
      inset: 0;
    }

    .sc-chip {
      display: flex;
      flex-direction: row;
      align-items: baseline;
      justify-content: center;
      gap: 4px;
      padding: 4px 4px 3px;
      background: var(--paper-card);
      border: 1px solid var(--rule);
      border-radius: 5px;
      transition:
        border-color 140ms ease,
        background 140ms ease,
        color 140ms ease;
      user-select: none;
      text-align: center;
      line-height: 1.15;
      min-height: 24px;
      white-space: nowrap;
    }
    .sc-chip-jp {
      font-size: 10.5px;
      font-weight: 600;
      color: var(--ink);
      letter-spacing: 0.02em;
    }
    .sc-chip-en {
      font-family: "SFMono-Regular", "Cascadia Mono", Consolas, "Courier New", monospace;
      font-size: 8px;
      color: var(--ink-faint);
      letter-spacing: 0.06em;
      font-variant-numeric: tabular-nums;
    }

    .sc-preset:hover .sc-chip {
      border-color: var(--rule-strong);
    }
    .sc-preset:hover .sc-chip-en { color: var(--ink-soft); }

    .sc-preset input:checked + .sc-chip {
      border-color: var(--accent);
      background: var(--accent-soft);
    }
    .sc-preset input:checked + .sc-chip .sc-chip-jp { color: var(--accent-deep); }
    .sc-preset input:checked + .sc-chip .sc-chip-en { color: var(--accent); }

    .sc-preset[data-off="true"] input:checked + .sc-chip {
      background: var(--paper-deep);
      border-color: var(--ink);
    }
    .sc-preset[data-off="true"] input:checked + .sc-chip .sc-chip-jp { color: var(--ink); }
    .sc-preset[data-off="true"] input:checked + .sc-chip .sc-chip-en { color: var(--ink-soft); }

    .sc-preset input:focus-visible + .sc-chip {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }

    @media (prefers-reduced-motion: reduce) {
      * { transition: none !important; animation: none !important; }
    }
  `;

// テーマ別 CSS をモジュール初期化時に 1 度だけ構築（毎ページの concat コストを排除）
const STYLES_DARK = THEME_DARK + STYLES_COMMON;
const STYLES_LIGHT = THEME_LIGHT + STYLES_COMMON;

function getStyles(dark) {
  return dark ? STYLES_DARK : STYLES_LIGHT;
}

// 全 const/function 宣言の初期化後に注入を起動（const は巻き上げされず TDZ になるため、
// 冒頭で initSearchClock を呼ぶと STYLES_DARK/LIGHT 参照が ReferenceError になる）。
// DOM上の既存要素で多重注入を防止（content scriptのletフラグはナビゲーションでリセットされるため不可）
if (!document.getElementById('searchclock-root')) {
  initSearchClock();
}
