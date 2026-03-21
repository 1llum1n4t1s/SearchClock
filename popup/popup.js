// SearchClock — ポップアップ設定画面

// qdr値から表示ラベルを生成
function qdrToLabel(qdr) {
  if (!qdr) return '設定なし';

  const PRESET_LABELS = {
    h3: '3時間以内',
    h12: '12時間以内',
    d: '1日以内',
    d3: '3日以内',
    w: '1週間以内',
    m: '1ヶ月以内',
    m3: '3ヶ月以内',
    m6: '半年以内',
    y: '1年以内',
    y3: '3年以内',
  };

  return PRESET_LABELS[qdr] || qdr;
}

// ステータス表示を更新
function updateStatus(qdr) {
  const status = document.getElementById('status');
  status.textContent = qdr ? `現在の設定: ${qdrToLabel(qdr)}` : '設定なし';
  status.className = 'sc-status sc-active';
}

// プリセットラジオボタンの状態を更新
function updatePresetSelection(qdr) {
  const radios = document.querySelectorAll('input[name="qdr"]');
  for (const radio of radios) {
    radio.checked = radio.value === (qdr || '');
  }
}

// 設定を保存
async function saveQdr(qdr) {
  await chrome.storage.sync.set({ qdr: qdr || '' });
  updateStatus(qdr);
}

// 初期化
async function init() {
  // 保存済み設定を読み込み
  const { qdr } = await chrome.storage.sync.get({ qdr: '' });
  updatePresetSelection(qdr);
  updateStatus(qdr);

  // プリセット選択時
  const radios = document.querySelectorAll('input[name="qdr"]');
  for (const radio of radios) {
    radio.addEventListener('change', () => {
      saveQdr(radio.value);
    });
  }

  // 外部からの設定変更を監視
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.qdr) {
      const newQdr = changes.qdr.newValue;
      updatePresetSelection(newQdr);
      updateStatus(newQdr);
    }
  });
}

init();
