// SearchClock — Google検索ページに設定パネルを埋め込み
// Shadow DOMでスタイルを完全に分離、Googleのライト/ダークテーマに自動対応

// モジュールレベルフラグで多重注入を防止
let initialized = false;
if (!initialized) {
  initialized = true;
  initSearchClock();
}

// Googleのダークテーマを検出
function isDarkTheme() {
  const bg = window.getComputedStyle(document.body).backgroundColor;
  const match = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return false;
  const brightness = (parseInt(match[1]) + parseInt(match[2]) + parseInt(match[3])) / 3;
  return brightness < 128;
}

function initSearchClock() {
  const centerCol = document.getElementById('center_col');
  if (!centerCol) return;

  const dark = isDarkTheme();

  const root = document.createElement('div');
  root.id = 'searchclock-root';
  const shadow = root.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = getStyles(dark);
  shadow.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'sc-panel';
  panel.innerHTML = getPanelHTML();
  shadow.appendChild(panel);

  // 設定読み込み・UI初期化
  chrome.storage.sync.get({ qdr: '' }, ({ qdr }) => {
    updateUI(shadow, qdr);
  });

  // プリセット選択 → 保存して再検索
  const radios = shadow.querySelectorAll('input[name="qdr"]');
  for (const radio of radios) {
    radio.addEventListener('change', () => {
      chrome.storage.sync.set({ qdr: radio.value }, () => {
        // 現在のURLからtbsパラメータを除去して再検索
        // → declarativeNetRequestが新しい設定でtbsを付与してくれる
        const url = new URL(window.location.href);
        url.searchParams.delete('tbs');
        window.location.href = url.toString();
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

  // ルートが削除されたらクリーンアップ
  const observer = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      chrome.storage.onChanged.removeListener(storageListener);
      observer.disconnect();
      initialized = false;
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
      if (!url.pathname.includes('/search')) return;

      const linkTbs = url.searchParams.get('tbs');
      // tbsパラメータがないか、qdr値が含まれてないリンクは無視
      if (linkTbs === null) return;

      // SearchClock自身のクリックは除外（Shadow DOM内なのでここに到達しないが念のため）
      if (e.target.closest('#searchclock-root')) return;

      // Google検索結果リンク（外部サイト）を除外：同一ドメインの/searchリンクのみ対象
      if (url.hostname !== window.location.hostname) return;

      // 拡張機能をオフにしてからナビゲーション
      e.preventDefault();
      chrome.storage.sync.set({ qdr: '' }, () => {
        window.location.href = link.href;
      });
    } catch {}
  }, true);
}

function updateUI(shadow, qdr) {
  const radios = shadow.querySelectorAll('input[name="qdr"]');
  for (const radio of radios) {
    radio.checked = radio.value === (qdr || '');
  }
  updateStatus(shadow, qdr);
}

function updateStatus(shadow, qdr) {
  const status = shadow.getElementById('sc-status');
  if (!status) return;
  status.textContent = qdr ? qdrToLabel(qdr) : '設定なし';
}

function qdrToLabel(qdr) {
  if (!qdr) return '設定なし';
  const labels = {
    h3: '3時間以内', h12: '12時間以内', d: '1日以内', d3: '3日以内', w: '1週間以内',
    m: '1ヶ月以内', m3: '3ヶ月以内', m6: '半年以内',
    y: '1年以内', y3: '3年以内',
  };
  return labels[qdr] || qdr;
}

function getPanelHTML() {
  const presets = [
    { label: 'オフ', value: '' },
    { label: '3時間', value: 'h3' },
    { label: '12時間', value: 'h12' },
    { label: '1日', value: 'd' },
    { label: '3日', value: 'd3' },
    { label: '1週間', value: 'w' },
    { label: '1ヶ月', value: 'm' },
    { label: '3ヶ月', value: 'm3' },
    { label: '半年', value: 'm6' },
    { label: '1年', value: 'y' },
    { label: '3年', value: 'y3' },
  ];

  const presetHTML = presets.map(({ label, value }) =>
    `<label class="sc-preset">
      <input type="radio" name="qdr" value="${value}">
      <span class="sc-chip">${label}</span>
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
  if (dark) {
    return `
      :host {
        all: initial;
        display: block;
        font-family: 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', sans-serif;
        font-size: 13px;
        color: #e8eaed;
        width: 100%;
        margin-bottom: 12px;
      }

      .sc-panel {
        width: 100%;
        background: #303134;
        border: 1px solid #3c4043;
        border-radius: 12px;
        overflow: hidden;
      }

      .sc-panel-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 12px;
        background: #3c4043;
        color: #e8eaed;
      }

      .sc-logo {
        flex-shrink: 0;
        width: 14px;
        height: 14px;
        color: #8ab4f8;
      }

      .sc-panel-title {
        font-size: 12px;
        font-weight: 600;
        color: #e8eaed;
        flex: 1;
      }

      .sc-panel-body {
        padding: 10px 12px;
      }

      .sc-presets {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }

      .sc-preset {
        cursor: pointer;
      }

      .sc-preset input[type="radio"] {
        display: none;
      }

      .sc-chip {
        display: inline-block;
        padding: 5px 10px;
        border: 1px solid #5f6368;
        border-radius: 16px;
        font-size: 11px;
        font-weight: 500;
        color: #bdc1c6;
        background: #303134;
        transition: all 0.15s ease;
        user-select: none;
      }

      .sc-chip:hover {
        background: #3c4043;
        border-color: #8ab4f8;
        color: #8ab4f8;
      }

      .sc-preset input[type="radio"]:checked + .sc-chip {
        background: #8ab4f8;
        border-color: #8ab4f8;
        color: #202124;
        font-weight: 600;
      }

      .sc-status {
        font-size: 10px;
        color: #9aa0a6;
        padding: 2px 6px;
        border-radius: 10px;
        background: rgba(255,255,255,0.08);
        white-space: nowrap;
      }
    `;
  }

  // ライトテーマ
  return `
    :host {
      all: initial;
      display: block;
      font-family: 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', sans-serif;
      font-size: 13px;
      color: #202124;
      width: 100%;
      margin-bottom: 12px;
    }

    .sc-panel {
      width: 100%;
      background: linear-gradient(135deg, #f0f4ff 0%, #faf0ff 100%);
      border: 1px solid #d4d0f0;
      border-radius: 12px;
      overflow: hidden;
    }

    .sc-panel-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      background: linear-gradient(135deg, #667eea22 0%, #764ba222 100%);
      border-bottom: 1px solid #d4d0f0;
    }

    .sc-logo {
      flex-shrink: 0;
      width: 14px;
      height: 14px;
      color: #5b5fc7;
    }

    .sc-panel-title {
      font-size: 12px;
      font-weight: 600;
      color: #4a4a6a;
      flex: 1;
    }

    .sc-panel-body {
      padding: 10px 12px;
    }

    .sc-presets {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }

    .sc-preset {
      cursor: pointer;
    }

    .sc-preset input[type="radio"] {
      display: none;
    }

    .sc-chip {
      display: inline-block;
      padding: 5px 10px;
      border: 1px solid #c8c4e8;
      border-radius: 16px;
      font-size: 11px;
      font-weight: 500;
      color: #4a4a6a;
      background: rgba(255, 255, 255, 0.8);
      transition: all 0.15s ease;
      user-select: none;
    }

    .sc-chip:hover {
      background: #ede9fe;
      border-color: #8b7cf7;
      color: #5b46d6;
    }

    .sc-preset input[type="radio"]:checked + .sc-chip {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-color: transparent;
      color: #fff;
      font-weight: 600;
      box-shadow: 0 1px 4px rgba(102, 126, 234, 0.3);
    }

    .sc-status {
      font-size: 10px;
      color: #7c6faa;
      padding: 2px 6px;
      border-radius: 10px;
      background: rgba(123, 97, 255, 0.08);
      white-space: nowrap;
    }
  `;
}
