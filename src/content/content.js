// SearchClock — Google検索ページに設定パネルを埋め込み
// Shadow DOMでスタイルを完全に分離、Googleのライト/ダークテーマに自動対応
// PRESETS / QDR_LABELS は src/shared/presets.js から注入される（同一 content_scripts 内で共有）

// DOM上の既存要素で多重注入を防止（content scriptのletフラグはナビゲーションでリセットされるため不可）
if (!document.getElementById('searchclock-root')) {
  initSearchClock();
}

function isDarkTheme() {
  const bg = window.getComputedStyle(document.body).backgroundColor;
  const match = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return false;
  return (parseInt(match[1]) + parseInt(match[2]) + parseInt(match[3])) / 3 < 128;
}

function qdrToLabel(qdr) {
  return qdr ? (QDR_LABELS[qdr] || qdr) : '設定なし';
}

function initSearchClock() {
  const centerCol = document.getElementById('center_col');
  if (!centerCol) return;

  // 現在URLはナビゲーションで content script ごと作り直されるので一度だけパース
  const cachedCurrentUrl = new URL(window.location.href);

  const root = document.createElement('div');
  root.id = 'searchclock-root';
  const shadow = root.attachShadow({ mode: 'closed' });

  shadow.appendChild(Object.assign(document.createElement('style'), {
    textContent: getStyles(isDarkTheme()),
  }));

  const panel = buildPanel();
  shadow.appendChild(panel);

  chrome.storage.sync.get({ qdr: '' }, ({ qdr }) => {
    updateUI(shadow, qdr);
  });

  // プリセット選択 → background.jsのルール更新完了を待ってからナビゲーション
  for (const radio of shadow.querySelectorAll('input[name="qdr"]')) {
    radio.addEventListener('change', () => {
      const qdr = radio.value;
      // URLSearchParamsはコロンを%3Aにエンコードしてしまうため手動でtbsを構築
      const url = new URL(window.location.href);
      url.searchParams.delete('tbs');
      let dest = url.toString();
      if (qdr) {
        dest += (dest.includes('?') ? '&' : '?') + `tbs=qdr:${qdr}`;
      }
      chrome.runtime.sendMessage({ type: 'updateQdr', qdr }, () => {
        void chrome.runtime.lastError; // SW 再起動時などのエラーは無視して遷移優先
        window.location.href = dest;
      });
    });
  }

  // 外部からの変更を監視
  const storageListener = (changes, area) => {
    if (area === 'sync' && changes.qdr) {
      updateUI(shadow, changes.qdr.newValue);
    }
  };
  chrome.storage.onChanged.addListener(storageListener);

  // Google検索ツールの期間フィルター変更を検出 → 拡張機能をオフ（後勝ち）
  const clickHandler = (e) => {
    const link = e.target.closest('a');
    if (!link || !link.href) return;

    try {
      const linkUrl = new URL(link.href);
      if (linkUrl.hostname !== cachedCurrentUrl.hostname) return;
      if (!linkUrl.pathname.includes('/search')) return;

      const linkTbs = linkUrl.searchParams.get('tbs');
      const currentTbs = cachedCurrentUrl.searchParams.get('tbs');

      // tbs変更なし → 対象外
      if (linkTbs === currentTbs) return;

      if (linkTbs === null) {
        // tbsなしリンク（「期間指定なし」）→ 現在tbsがある場合のみ対象
        if (!currentTbs) return;
        // 検索結果内のリンクは対象外
        if (link.closest('#rso')) return;
        // 検索タイプ切替（画像/ニュース等）は対象外
        if (linkUrl.searchParams.get('tbm') !== cachedCurrentUrl.searchParams.get('tbm')) return;
      }

      e.preventDefault();
      chrome.runtime.sendMessage({ type: 'updateQdr', qdr: '' }, () => {
        void chrome.runtime.lastError;
        window.location.href = link.href;
      });
    } catch (err) {
      console.warn('[SearchClock] リンク処理エラー:', err.message);
    }
  };
  document.addEventListener('click', clickHandler, true);

  // ルートが削除されたらクリーンアップ（centerCol 限定で監視コスト削減）
  const observer = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      chrome.storage.onChanged.removeListener(storageListener);
      document.removeEventListener('click', clickHandler, true);
      observer.disconnect();
    }
  });
  observer.observe(centerCol, { childList: true });

  centerCol.insertBefore(root, centerCol.firstChild);
}

function updateUI(shadow, qdr) {
  for (const radio of shadow.querySelectorAll('input[name="qdr"]')) {
    radio.checked = radio.value === (qdr || '');
  }
  const status = shadow.getElementById('sc-status');
  if (status) {
    status.textContent = qdrToLabel(qdr);
  }
}

// パネルを DOM API で組み立て（innerHTML を避けて将来的な XSS 混入を防止）
function buildPanel() {
  const panel = document.createElement('div');
  panel.className = 'sc-panel';

  const header = document.createElement('div');
  header.className = 'sc-panel-header';
  header.appendChild(buildLogoSvg(14));

  const titleEl = document.createElement('span');
  titleEl.className = 'sc-panel-title';
  titleEl.textContent = 'SearchClock';
  header.appendChild(titleEl);

  const status = document.createElement('span');
  status.className = 'sc-status';
  status.id = 'sc-status';
  status.textContent = '設定なし';
  header.appendChild(status);

  const body = document.createElement('div');
  body.className = 'sc-panel-body';

  const presetsWrap = document.createElement('div');
  presetsWrap.className = 'sc-presets';
  for (const { shortLabel, value } of PRESETS) {
    const label = document.createElement('label');
    label.className = 'sc-preset';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'qdr';
    input.value = value;
    label.appendChild(input);

    const chip = document.createElement('span');
    chip.className = 'sc-chip';
    chip.textContent = shortLabel;
    label.appendChild(chip);

    presetsWrap.appendChild(label);
  }
  body.appendChild(presetsWrap);

  panel.appendChild(header);
  panel.appendChild(body);
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

function getStyles(dark) {
  // 共通CSS
  const common = `
    :host {
      all: initial;
      display: block;
      font-family: 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', sans-serif;
      font-size: 13px;
      width: 100%;
      margin-bottom: 12px;
    }
    .sc-panel { width: 100%; border-radius: 12px; overflow: hidden; }
    .sc-panel-header { display: flex; align-items: center; gap: 6px; padding: 4px 12px; }
    .sc-logo { flex-shrink: 0; width: 14px; height: 14px; }
    .sc-panel-title { font-size: 12px; font-weight: 600; flex: 1; }
    .sc-panel-body { padding: 10px 12px; }
    .sc-presets { display: flex; flex-wrap: wrap; gap: 5px; }
    .sc-preset { cursor: pointer; }
    .sc-preset input[type="radio"] { display: none; }
    .sc-chip {
      display: inline-block; padding: 5px 10px;
      border-radius: 16px; font-size: 11px; font-weight: 500;
      transition: all 0.15s ease; user-select: none;
    }
    .sc-status { font-size: 10px; padding: 2px 6px; border-radius: 10px; white-space: nowrap; }
  `;

  // テーマ別CSS
  const theme = dark ? `
    :host { color: #e8eaed; }
    .sc-panel { background: #303134; border: 1px solid #3c4043; }
    .sc-panel-header { background: #3c4043; color: #e8eaed; }
    .sc-logo { color: #8ab4f8; }
    .sc-panel-title { color: #e8eaed; }
    .sc-chip { border: 1px solid #5f6368; color: #bdc1c6; background: #303134; }
    .sc-chip:hover { background: #3c4043; border-color: #8ab4f8; color: #8ab4f8; }
    .sc-preset input[type="radio"]:checked + .sc-chip { background: #8ab4f8; border-color: #8ab4f8; color: #202124; font-weight: 600; }
    .sc-status { color: #9aa0a6; background: rgba(255,255,255,0.08); }
  ` : `
    :host { color: #202124; }
    .sc-panel { background: linear-gradient(135deg, #f0f4ff 0%, #faf0ff 100%); border: 1px solid #d4d0f0; }
    .sc-panel-header { background: linear-gradient(135deg, #667eea22 0%, #764ba222 100%); border-bottom: 1px solid #d4d0f0; }
    .sc-logo { color: #5b5fc7; }
    .sc-panel-title { color: #4a4a6a; }
    .sc-chip { border: 1px solid #c8c4e8; color: #4a4a6a; background: rgba(255, 255, 255, 0.8); }
    .sc-chip:hover { background: #ede9fe; border-color: #8b7cf7; color: #5b46d6; }
    .sc-preset input[type="radio"]:checked + .sc-chip { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-color: transparent; color: #fff; font-weight: 600; box-shadow: 0 1px 4px rgba(102, 126, 234, 0.3); }
    .sc-status { color: #7c6faa; background: rgba(123, 97, 255, 0.08); }
  `;

  return common + theme;
}
