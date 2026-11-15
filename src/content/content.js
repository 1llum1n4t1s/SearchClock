// SearchClock — Google検索ページに設定パネルを埋め込み
// Shadow DOMでスタイルを完全に分離、Googleのライト/ダークテーマに自動対応
// PRESETS / QDR_LABELS / VALID_QDR_VALUES / DEFAULT_SETTINGS / refPresetIndex /
// TBS_PARAM_KEY / QDR_PREFIX / extractQdrFromTbs / isSameSearchContext は
// src/shared/presets.js から注入される
// （同一 content_scripts 内で共有、manifest.json の js 配列で先に読み込まれる）

function isDarkTheme() {
  const bg = window.getComputedStyle(document.body).backgroundColor;
  // rgb()/rgba()・カンマ/空白区切りの両形式を許容（ブラウザの serialization 揺れで
  // rgba(32, 33, 36, 1) 等が返るとダーク背景でもライト判定になる取りこぼし対策）
  const match = bg.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)/);
  if (!match) return false;
  // 完全透明は背景色不明のためライト扱い（rgba(0,0,0,0) を「黒」と誤検出しない）
  if (match[4] !== undefined && parseFloat(match[4]) === 0) return false;
  return (parseInt(match[1]) + parseInt(match[2]) + parseInt(match[3])) / 3 < 128;
}

function qdrToLabel(qdr) {
  if (!qdr) return '期間指定なし';
  if (qdr === 'h') return '1時間以内';
  return QDR_LABELS[qdr] || `Google指定 (${QDR_PREFIX}${qdr})`;
}

// URL の tbs から表示用 qdr を抽出。プリセット外のGoogle標準値も実状態として保持する。
// qdr が存在しない場合だけ '' を返し、保存可否は VALID_QDR_VALUES で別に判定する。
function urlQdr(url) {
  return extractQdrFromTbs(url.searchParams.get(TBS_PARAM_KEY)) || '';
}

// SW へ qdr 更新を送ってからナビゲーション。
// SW タイムアウト・起動失敗等でコールバック未到達でもページがフリーズしないよう、
// 強制遷移するフォールバックを持つ。二重ナビゲーションを防ぐため navigated フラグで一度きり。
//
// disableKeep=true は後勝ち（Google 検索ツールで期間変更）専用。README / ストア掲載文の
// 「Google 検索ツールで期間を変更すると拡張機能は自動オフ」を満たすため keepSetting も落とす。
// storage 書き込みは SW 側で qdr と同一 set にまとめる：ここで直接 storage.set すると
// 遷移でページが破棄され書き込みが取りこぼされうるため、応答を待てる SW 経由にする。
const NAV_FALLBACK_MS = 3000;
const MESSAGE_RETRY_MS = 100;

function sendSettingsMessage(msg, retries = 1) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const send = () => {
      attempts++;
      chrome.runtime.sendMessage(msg, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (!runtimeError && response?.done) {
          resolve();
          return;
        }
        if (attempts <= retries) {
          setTimeout(send, MESSAGE_RETRY_MS);
          return;
        }
        reject(new Error(response?.error || runtimeError?.message || 'settings update failed'));
      });
    };
    send();
  });
}

function sendQdrAndNavigate(qdr, dest, disableKeep) {
  let navigated = false;
  const go = () => {
    if (navigated) return;
    navigated = true;
    window.location.href = dest;
  };
  const fallback = setTimeout(go, NAV_FALLBACK_MS);
  const msg = { type: 'updateQdr', qdr };
  if (disableKeep) msg.keepSetting = false;
  sendSettingsMessage(msg)
    .then(() => {
      clearTimeout(fallback);
      go();
    })
    .catch((err) => {
      // 一回限りモードは URL 自体に qdr を含むため、最終的には fallback で遷移を優先する。
      // 維持モードの設定失敗は警告を残し、成功したと偽装しない。
      console.warn('[SearchClock] 設定更新エラー:', err?.message ?? err);
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

// ─── サイド配置 ──────────────────────────────────────────
// パネルは document_idle で遅れて現れるため、検索結果の上へ差し込むと結果が下へずれ、
// 1件目をクリックしようとした瞬間にパネルを押してしまう。検索結果の列の外（サイド）へ置き、
// 結果のレイアウトを一切動かさないことを最優先にする。
// 差し込み先は Sonoyo の列 → Google の右カラム (#rhs) → 検索結果列の右側へ絶対配置 → 画面右下に固定、の順。
const PANEL_WIDTH = 380;
const SIDE_GAP = 28;
const SIDE_MARGIN_RIGHT = 14;
// これより狭い画面では右側に列を作る余白が無いため、固定表示に倒す
const FLOAT_MIN_VIEWPORT = 1100;

// 同じ作者の Sonoyo 拡張は #center_col の右外 (left: 100% + 28px, top: 0) か #rhs の先頭に
// 自前の列 #sonoyo-col を作る。SearchClock の side 配置と完全に同じ座標になり重なるため、
// その列があるときは列の先頭へ通常フローで載せ、縦に積んで共存させる。
const SONOYO_COLUMN_ID = 'sonoyo-col';

function findSlot() {
  if (window.innerWidth < FLOAT_MIN_VIEWPORT) return { mode: 'float' };
  const sonoyoCol = document.getElementById(SONOYO_COLUMN_ID);
  if (sonoyoCol) return { mode: 'sonoyo', el: sonoyoCol };
  const rhs = document.getElementById('rhs');
  if (rhs && window.getComputedStyle(rhs).display !== 'none') return { mode: 'rhs', el: rhs };
  const center = document.getElementById('center_col');
  if (center) {
    const box = center.getBoundingClientRect();
    const css = window.getComputedStyle(center);
    const room = Math.floor(document.documentElement.clientWidth - box.right - SIDE_GAP - SIDE_MARGIN_RIGHT);
    // 絶対配置の基準にするため position が static でないこと、はみ出しを切られないため
    // overflow-x が visible であることを確認する（満たさなければ固定表示へ）
    if (box.width > 0 && room >= PANEL_WIDTH && css.position !== 'static' && css.overflowX === 'visible') {
      return { mode: 'side', el: center };
    }
  }
  return { mode: 'float' };
}

// host 要素へのインライン style は Shadow DOM 内の :host より優先されるため、配置はここで決める
function placeRoot(root, slot) {
  if (slot.mode === 'sonoyo' || slot.mode === 'rhs') {
    root.style.cssText = `display:block;width:${PANEL_WIDTH}px;max-width:100%;margin:0 0 16px;`;
    slot.el.prepend(root);
  } else if (slot.mode === 'side') {
    // Google の grid / flex に新しい要素を割り当てず、検索結果列を基準に右外へ絶対配置する
    root.style.cssText = `display:block;position:absolute;left:calc(100% + ${SIDE_GAP}px);top:0;` +
      `width:${PANEL_WIDTH}px;margin:0;z-index:2;`;
    slot.el.appendChild(root);
  } else {
    // 狭い画面では検索結果の列と横方向に重なり得る。遅れて現れたパネルが1件目の上に
    // 被らないよう、上端ではなく画面右下へ固定する（Sonoyo の浮遊表示は右上なので重ならない）。
    root.style.cssText = `display:block;position:fixed;right:${SIDE_MARGIN_RIGHT}px;bottom:${SIDE_MARGIN_RIGHT}px;` +
      `width:${PANEL_WIDTH}px;max-width:calc(100vw - 28px);margin:0;z-index:2147483000;`;
    document.body.appendChild(root);
  }
}

// document_idle 時点で注入先が無いのは「遅延レンダリング中」か「画像検索など注入先を持たない
// 別レイアウトの /search ページ」。前者に備えて一定時間だけ出現を監視し、見つかり次第注入する。
// 期限まで現れなければ後者と判断して console.info で記録して退出する
// （console.warn 以上は chrome://extensions のエラー一覧に収集されノイズになるため info に留める。
//  DOM 変更の調査時はページの DevTools コンソールで info レベルを表示すれば確認できる）。
const INJECTION_TARGET_WAIT_MS = 10000;
let injectionWait = null;

function waitForInjectionTarget() {
  if (document.getElementById('searchclock-root') || injectionWait) return;
  if (findInjectionTarget()) {
    initSearchClock();
    return;
  }

  const stopWaiting = () => {
    if (!injectionWait) return;
    injectionWait.observer.disconnect();
    clearTimeout(injectionWait.timer);
    injectionWait = null;
  };
  const observer = new MutationObserver(() => {
    if (!findInjectionTarget()) return;
    stopWaiting();
    if (!document.getElementById('searchclock-root')) {
      initSearchClock();
    }
  });
  const timer = setTimeout(() => {
    stopWaiting();
    console.info('[SearchClock] 注入先 (#center_col / fallback) が見つかりません。別レイアウトの検索ページか、Google の DOM 変更の可能性があります。');
  }, INJECTION_TARGET_WAIT_MS);
  injectionWait = { observer, timer };
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function initSearchClock() {
  const injectionTarget = findInjectionTarget();
  if (!injectionTarget) {
    waitForInjectionTarget();
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
      // url.toString() は fragment まで含めて直列化するため、hash を退避せずに末尾へ
      // tbs を連結すると `...#frag&tbs=qdr:y` となり tbs がクエリではなく fragment 扱いになる。
      // 先に hash を外してクエリを組み立て、最後に戻す。
      const hash = url.hash;
      url.hash = '';
      url.searchParams.delete(TBS_PARAM_KEY);
      let dest = url.toString();

      const otherSegments = existingTbs
        ? existingTbs.split(',').filter((s) => !s.startsWith(QDR_PREFIX))
        : [];
      const newSegments = qdr ? [`${QDR_PREFIX}${qdr}`, ...otherSegments] : otherSegments;
      if (newSegments.length > 0) {
        dest += (dest.includes('?') ? '&' : '?') + `${TBS_PARAM_KEY}=${newSegments.join(',')}`;
      }
      dest += hash;

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
  // switch は離散的な change だけを発火するため、その場で保存を開始する。
  // タイマーへ遅延すると、直後のチップ選択やページ破棄でユーザーの変更が失われる。
  refs.keepInput.addEventListener('change', async () => {
    const next = !!refs.keepInput.checked;
    // updateUI で disabled にしているが、キーボード操作や race を念のため二重防御。
    // プリセット外 qdr は表示だけ行い、DNR へ保存できない値での維持 ON は拒否する。
    if (next && (!currentQdr || !VALID_QDR_VALUES.has(currentQdr))) {
      refs.keepInput.checked = false;
      return;
    }
    const updates = { type: 'updateKeepSetting', keepSetting: next };
    if (next) updates.qdr = currentQdr;
    try {
      await sendSettingsMessage(updates);
    } catch (err) {
      console.warn('[SearchClock] keepSetting 保存失敗:', err?.message ?? err);
      refs.keepInput.checked = !next; // UI ロールバック
    }
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
      if (linkUrl.pathname !== '/search') return;
      // 同じ検索語・検索タイプ内の qdr 変更だけを Google 検索ツールの後勝ちとみなす。
      // 関連検索や udm ベースの画像・ショッピング・AI モード切替は通常ナビゲーションとして
      // DNR に委ね、維持モードを解除しない。
      if (!isSameSearchContext(cachedCurrentUrl, linkUrl)) return;

      const linkQdr = extractQdrFromTbs(linkUrl.searchParams.get(TBS_PARAM_KEY));

      // qdr セグメントが変わっていない → 期間以外の tbs 変更なので対象外
      if (linkQdr === currentQdrParam) return;

      if (linkQdr === null) {
        // qdr が消えるリンク（「期間指定なし」を選んだ）→ 現在 qdr がある場合のみ対象
        if (!currentQdrParam) return;
        // 検索結果内のリンクは対象外
        if (link.closest('#rso')) return;
      }

      // 新しいタブ・ウィンドウで開く操作はブラウザ既定の遷移方法を維持する。
      // 後勝ちの状態更新だけは送り、現在タブを強制遷移させない。
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
        sendSettingsMessage({ type: 'updateQdr', qdr: '', keepSetting: false })
          .catch((err) => console.warn('[SearchClock] 設定更新エラー:', err?.message ?? err));
        return;
      }

      e.preventDefault();
      // linkUrl.href は new URL() で正規化・hostname 検証済みの値を使う（href 直渡しより防御的）
      // 第3引数 true: 後勝ちは「拡張機能を自動オフ」なので keepSetting も落とす。
      // 落とさないと storage.qdr='' で DNR ルールが無いのにモードチップだけ「維持中」に
      // 残り、次の検索フォーム実行で絞り込まれない偽の維持表示になる。
      sendQdrAndNavigate('', linkUrl.href, true);
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
    chrome.storage.sync.get(DEFAULT_SETTINGS, ({ keepSetting }) => {
      updateUI(refs, currentQdr, keepSetting);
    });
  };
  window.addEventListener('pageshow', pageshowHandler);

  // root を先に挿入してから監視を開始（observe を先に呼ぶと、Google ページの動的更新で
  // 「root がまだ body に入っていない」状態で cleanup が即発火してしまう）
  const slot = findSlot();
  placeRoot(root, slot);
  const slotParent = root.parentNode;

  // 破棄時の後始末。親と祖父母の両方を observe しているため同一フレームで 2 回 callback されうる。
  // cleaned フラグで二重実行を防止する。
  let cleaned = false;
  let resizeTimer = null;
  const teardown = () => {
    cleaned = true;
    chrome.storage.onChanged.removeListener(storageListener);
    document.removeEventListener('click', clickHandler, true);
    window.removeEventListener('pageshow', pageshowHandler);
    window.removeEventListener('resize', resizeHandler);
    clearTimeout(resizeTimer);
    observer.disconnect();
  };
  // 画面幅の変化や #rhs の後出しで最適な差し込み先が変わったら作り直す。
  // 表示状態は URL と storage が正本なので、作り直しても失われる状態は無い。
  const remountIfSlotChanged = () => {
    if (findSlot().mode === slot.mode) return;
    teardown();
    root.remove();
    initSearchClock();
  };

  // ルートの親と、その親の childList を監視することで、
  //   - root が差し込み先から取り除かれるケース
  //   - 差し込み先自体が差し替えられる SPA 的遷移
  //   - 右カラム (#rhs) が後から挿入されるケース
  // を捕捉。subtree: true は Google ページの mutation 頻度が高すぎて重いので使わない。
  const observer = new MutationObserver(() => {
    if (cleaned) return;
    if (!root.isConnected) {
      teardown();
      waitForInjectionTarget();
      return;
    }
    remountIfSlotChanged();
  });
  observer.observe(slotParent, { childList: true });
  if (slotParent.parentNode) {
    observer.observe(slotParent.parentNode, { childList: true });
  }

  const resizeHandler = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!cleaned) remountIfSlotChanged();
    }, 150);
  };
  window.addEventListener('resize', resizeHandler);
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

  const canKeep = !!qdr && VALID_QDR_VALUES.has(qdr);
  // 期間未設定またはプリセット外 qdr で維持 ON にすると、background が値を受理できず
  // バッジだけ「維持中」になる偽状態が成立する。先にプリセット選択を促すため disable。
  // ただし既に維持 ON の状態（維持中に「オフ」チップを選んだ直後など）では disable しない。
  // ON のまま操作不能にすると「維持中表示だが解除できない」袋小路になり、
  // 別の期間を選び直すまで OFF に戻せなくなるため（ON 方向だけを change ハンドラで拒否する）。
  refs.keepInput.disabled = !canKeep && !keepSetting;
  refs.keepInput.checked = !!keepSetting;
  refs.keepWrap.title = !canKeep
    ? qdr
      ? 'Google側の期間指定を表示中です（維持するにはプリセットを選んでください）'
      : '先に期間を選んでください（未設定では維持できません）'
    : keepSetting
      ? '期間を維持中：次の検索でも設定が適用されます'
      : '一回限り：次の検索で自動的にオフに戻ります';
  // モード表示: ON=keep / OFF=once（常時表示で「壊れた」誤認を防ぐ）
  const mode = keepSetting ? 'keep' : 'once';
  refs.modeChip.textContent = keepSetting ? '維持中' : '1回限り';
  refs.modeChip.dataset.mode = mode;
}

// DOM 要素を 1 行で組み立てる小さなヘルパ。
// buildPanel の「createElement → className → id → textContent → appendChild」の繰り返しを畳み、
// 段の構成（どの要素がどの親に入るか）をコードの入れ子で読めるようにする。
// innerHTML は使わず、文字列は textContent だけで入れる（将来的な XSS 混入を防止）。
//   props: className / id / text / dataset / attrs（setAttribute で設定する属性）/
//          それ以外のキー（type / name / value 等）はプロパティとしてそのまま代入
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  const { className, id, text, dataset, attrs, ...rest } = props;
  // type 等を先に代入し、旧実装と同じ属性順（type → id → aria-*）の DOM を保つ
  Object.assign(node, rest);
  if (className) node.className = className;
  if (id) node.id = id;
  if (dataset) Object.assign(node.dataset, dataset);
  for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  for (const child of children) node.appendChild(child);
  return node;
}

// 区切り点（dot separator）
function buildDot() {
  return el('span', { className: 'sc-dot', attrs: { 'aria-hidden': 'true' }, text: '·' });
}

// プリセット 1 個分（radio + chip）。value='' は「オフ」として別配色にする。
function buildPresetChip({ shortLabel, en, value }) {
  return el('label', { className: 'sc-preset', dataset: value ? undefined : { off: 'true' } }, [
    el('input', { type: 'radio', name: 'qdr', value }),
    el('span', { className: 'sc-chip' }, [
      el('span', { className: 'sc-chip-jp', text: shortLabel }),
      el('span', { className: 'sc-chip-en', text: en }),
    ]),
  ]);
}

// パネルを DOM API で組み立てる。サイドに置く縦長コンパクト構成:
//   1 段目: mark · title …… モードチップ
//   2 段目: No. · 状態 …… tbs
//   3 段目: プリセット（4 列グリッド）
//   4 段目: 「期間を維持」switch
// id 付きの要素は initSearchClock の refs と updateUI が参照する。
function buildPanel() {
  return el('div', { className: 'sc-panel', id: 'sc-panel' }, [
    // ─── ヘッダー ─────
    el('div', { className: 'sc-header' }, [
      el('span', { className: 'sc-mark' }, [buildLogoSvg(12)]),
      el('span', { className: 'sc-title', text: 'SearchClock' }),
      // モードチップ（右寄せ・現在のモードを常時可視化、once 誤認防止）
      el('span', { className: 'sc-mode-chip', id: 'sc-mode-chip', dataset: { mode: 'once' }, text: '1回限り' }),
    ]),
    // ─── 状態行 ─────
    el('div', { className: 'sc-status-row' }, [
      el('span', { className: 'sc-issue' }, [
        el('span', { className: 'sc-issue-en', text: 'No.' }),
        el('span', { className: 'sc-issue-no', id: 'sc-issue-no', text: '—' }),
      ]),
      buildDot(),
      el('span', { className: 'sc-status', id: 'sc-status', text: '期間指定なし' }),
      // tbs ラベル（右寄せ）
      el('span', { className: 'sc-tbs-wrap' }, [
        el('span', { className: 'sc-tbs-label', text: 'tbs=' }),
        el('span', { className: 'sc-tbs', id: 'sc-tbs', text: '—' }),
      ]),
    ]),
    // ─── プリセット（4 列グリッド） ─────
    el('div', { className: 'sc-presets' }, PRESETS.map(buildPresetChip)),
    // ─── フッター：「期間を維持」switch + 日本語ラベル ─────
    el('div', { className: 'sc-footer' }, [
      el('label', { className: 'sc-keep', id: 'sc-keep' }, [
        el('span', { className: 'sc-keep-label', text: '期間を維持' }),
        el('span', { className: 'sc-keep-switch' }, [
          el('input', { type: 'checkbox', id: 'sc-keep-input', attrs: { 'aria-label': '期間を維持' } }),
          el('span', { className: 'sc-keep-track', attrs: { 'aria-hidden': 'true' } }),
        ]),
      ]),
    ]),
  ]);
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
      --rule-strong: #cdc5e0;
      --accent: ${ACCENT_COLOR};
      --accent-deep: #4D3590;
      --accent-soft: #ede9f7;
    }
  `;

// 注入パネル: サイドに置く縦長コンパクト構成（幅 PANEL_WIDTH、配置は placeRoot のインライン style）
const STYLES_COMMON = `
    :host {
      all: initial;
      display: block;
      width: ${PANEL_WIDTH}px;
      margin: 0;
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

    /* ── Header（mark · title …… モードチップ） ─────────── */
    .sc-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 10px 4px;
      min-height: 26px;
      flex-wrap: nowrap;
      overflow: hidden;
    }
    .sc-header .sc-mode-chip { margin-left: auto; }

    /* ── 状態行（No. · 状態 …… tbs） ─────────── */
    .sc-status-row {
      display: flex;
      align-items: baseline;
      gap: 5px;
      padding: 0 10px 5px;
      border-bottom: 1px dashed var(--rule);
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

    /* ── Footer（期間を維持） ─────────────── */
    .sc-footer {
      display: flex;
      justify-content: flex-end;
      padding: 0 10px 8px;
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

    /* ── Presets（幅 380px で 4 列 × 3 段に収める） ──────────── */
    .sc-presets {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 4px;
      padding: 7px 10px 7px;
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
