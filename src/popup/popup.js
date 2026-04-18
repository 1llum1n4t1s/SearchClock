// SearchClock — ポップアップ設定画面

const PRESET_LABELS = {
  h3: '3時間以内', h12: '12時間以内', d: '1日以内', d3: '3日以内',
  w: '1週間以内', m: '1ヶ月以内', m3: '3ヶ月以内', m6: '半年以内',
  y: '1年以内', y3: '3年以内',
};

function updateStatus(qdr) {
  const status = document.getElementById('status');
  status.textContent = qdr ? `現在の設定: ${PRESET_LABELS[qdr] || qdr}` : '設定なし';
  status.className = 'sc-status sc-active';
}

function updatePresetSelection(qdr) {
  for (const radio of document.querySelectorAll('input[name="qdr"]')) {
    radio.checked = radio.value === (qdr || '');
  }
}

async function init() {
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
      updatePresetSelection(changes.qdr.newValue);
      updateStatus(changes.qdr.newValue);
    }
  });
}

init();
