// SearchClock — ポップアップ設定画面
// PRESETS / QDR_LABELS は ../shared/presets.js（popup.html で先にロード済み）

function updateStatus(qdr) {
  const status = document.getElementById('status');
  const label = QDR_LABELS[qdr];
  status.textContent = label ? `現在の設定: ${label}` : '設定なし';
  status.className = 'sc-status sc-active';
}

function updatePresetSelection(qdr) {
  for (const radio of document.querySelectorAll('input[name="qdr"]')) {
    radio.checked = radio.value === (qdr || '');
  }
}

// プリセットのラジオボタンを動的生成（プリセット追加時に HTML を触らなくてよい）
function renderPresets() {
  const container = document.getElementById('presets');
  const fragment = document.createDocumentFragment();
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

    fragment.appendChild(label);
  }
  container.appendChild(fragment);
}

async function init() {
  renderPresets();

  const { qdr } = await chrome.storage.sync.get({ qdr: '' });
  updatePresetSelection(qdr);
  updateStatus(qdr);

  for (const radio of document.querySelectorAll('input[name="qdr"]')) {
    radio.addEventListener('change', async () => {
      await chrome.storage.sync.set({ qdr: radio.value || '' });
      updateStatus(radio.value);
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.qdr) {
      const newVal = changes.qdr.newValue || '';
      updatePresetSelection(newVal);
      updateStatus(newVal);
    }
  });
}

init();
