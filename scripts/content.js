// SearchClock — Google検索ページに設定パネルを埋め込み
// Shadow DOMでスタイルを完全に分離、Googleのライト/ダークテーマに自動対応

// プリセット定義（HTML生成・ラベル変換の共通データ）
const PRESETS = [
  { label: 'オフ', shortLabel: 'オフ', value: '' },
  { label: '3時間以内', shortLabel: '3時間', value: 'h3' },
  { label: '12時間以内', shortLabel: '12時間', value: 'h12' },
  { label: '1日以内', shortLabel: '1日', value: 'd' },
  { label: '3日以内', shortLabel: '3日', value: 'd3' },
  { label: '1週間以内', shortLabel: '1週間', value: 'w' },
  { label: '1ヶ月以内', shortLabel: '1ヶ月', value: 'm' },
  { label: '3ヶ月以内', shortLabel: '3ヶ月', value: 'm3' },
  { label: '半年以内', shortLabel: '半年', value: 'm6' },
  { label: '1年以内', shortLabel: '1年', value: 'y' },
  { label: '3年以内', shortLabel: '3年', value: 'y3' },
];

// qdr値 → ラベルのマップ（PRESETSから自動生成）
const QDR_LABELS = Object.fromEntries(
  PRESETS.filter(p => p.value).map(p => [p.value, p.label])
);

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

  const root = document.createElement('div');
  root.id = 'searchclock-root';
  const shadow = root.attachShadow({ mode: 'closed' });

  shadow.appendChild(Object.assign(document.createElement('style'), {
    textContent: getStyles(isDarkTheme()),
  }));

  const panel = document.createElement('div');
  panel.className = 'sc-panel';
  panel.innerHTML = getPanelHTML();
  shadow.appendChild(panel);

  chrome.storage.sync.get({ qdr: '' }, ({ qdr }) => {
    updateUI(shadow, qdr);
  });

  // プリセット選択 → URLに直接tbs値を設定して即ナビゲーション
  for (const radio of shadow.querySelectorAll('input[name="qdr"]')) {
    radio.addEventListener('change', () => {
      const qdr = radio.value;
      const url = new URL(window.location.href);
      if (qdr) {
        url.searchParams.set('tbs', `qdr:${qdr}`);
      } else {
        url.searchParams.delete('tbs');
      }
      chrome.storage.sync.set({ qdr });
      window.location.href = url.toString();
    });
  }

  // 外部からの変更を監視
  const storageListener = (changes, area) => {
    if (area === 'sync' && changes.qdr) {
      updateUI(shadow, changes.qdr.newValue);
    }
  };
  chrome.storage.onChanged.addListener(storageListener);

  // ルートが削除されたらクリーンアップ
  const observer = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      chrome.storage.onChanged.removeListener(storageListener);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });

  centerCol.insertBefore(root, centerCol.firstChild);

  // Google検索ツールの期間フィルター変更を検出 → 拡張機能をオフ（後勝ち）
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link || !link.href) return;

    try {
      const url = new URL(link.href);
      if (url.hostname !== window.location.hostname) return;
      if (!url.pathname.includes('/search')) return;
      if (url.searchParams.get('tbs') === null) return;

      e.preventDefault();
      chrome.storage.sync.set({ qdr: '' }, () => {
        window.location.href = link.href;
      });
    } catch (err) {
      console.warn('[SearchClock] リンク処理エラー:', err.message);
    }
  }, true);
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

function getPanelHTML() {
  const presetHTML = PRESETS.map(({ shortLabel, value }) =>
    `<label class="sc-preset">
      <input type="radio" name="qdr" value="${value}">
      <span class="sc-chip">${shortLabel}</span>
    </label>`
  ).join('');

  return `
    <div class="sc-panel-header">
      <svg class="sc-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
      <span class="sc-panel-title">SearchClock</span>
      <span class="sc-status" id="sc-status">設定なし</span>
    </div>
    <div class="sc-panel-body">
      <div class="sc-presets">${presetHTML}</div>
    </div>
  `;
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
