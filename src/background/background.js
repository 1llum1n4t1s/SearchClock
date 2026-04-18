// SearchClock — Google検索の期間指定を固定化するサービスワーカー
// declarativeNetRequestを使って検索前にURLを書き換える

importScripts('../shared/presets.js');

const GOOGLE_DOMAINS = [
  'www.google.com',
  'www.google.co.jp',
  'www.google.co.uk',
  'www.google.ca',
  'www.google.com.au',
  'www.google.de',
  'www.google.fr',
  'www.google.es',
  'www.google.it',
  'www.google.co.kr',
  'www.google.com.br',
];

const REDIRECT_RULE_ID = 1;
const SKIP_RULE_ID = 2;

// onMessage 経由で updateRules を実行した直後は onChanged が二重発火するため、
// 1回だけスキップするフラグ（SW 再起動時は false にリセットされる＝安全な側）
let suppressNextOnChanged = false;

async function updateRules(qdr) {
  // remove と add を単一呼び出しにまとめてルール空白期間をなくす
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [REDIRECT_RULE_ID, SKIP_RULE_ID],
    addRules: qdr ? [
      // 既にtbsパラメータがあるURLはスキップ（content.jsが直接設定した値を尊重）
      {
        id: SKIP_RULE_ID,
        priority: 2,
        action: { type: 'allow' },
        condition: {
          regexFilter: '.*[?&]tbs=.*',
          requestDomains: GOOGLE_DOMAINS,
          resourceTypes: ['main_frame'],
        },
      },
      // tbsがないURLに期間指定パラメータを追加
      {
        id: REDIRECT_RULE_ID,
        priority: 1,
        action: {
          type: 'redirect',
          redirect: {
            transform: {
              queryTransform: {
                addOrReplaceParams: [
                  { key: 'tbs', value: `qdr:${qdr}`, replaceOnly: false },
                ],
              },
            },
          },
        },
        condition: {
          urlFilter: '/search',
          requestDomains: GOOGLE_DOMAINS,
          resourceTypes: ['main_frame'],
        },
      },
    ] : [],
  });
}

// 初期化（インストール/更新/ブラウザ起動の共通処理）
async function initRules() {
  const { qdr } = await chrome.storage.sync.get({ qdr: '' });
  // 起動時は保存済み値を検証（破損していたらオフにフォールバック）
  const safeQdr = VALID_QDR_VALUES.has(qdr) ? qdr : '';
  await updateRules(safeQdr);
}

chrome.runtime.onInstalled.addListener(initRules);
chrome.runtime.onStartup.addListener(initRules);

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync' || !changes.qdr) return;
  if (suppressNextOnChanged) {
    // onMessage ハンドラが既に updateRules を走らせた直後の二重起動
    suppressNextOnChanged = false;
    return;
  }
  const newVal = changes.qdr.newValue;
  if (!VALID_QDR_VALUES.has(newVal)) return;
  await updateRules(newVal);
});

// content.jsからのメッセージでルール更新 → 完了後に応答（ナビゲーション前にルール確定）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 自分の拡張機能からのメッセージのみ受理（同一ブラウザ内の別拡張機能からの送信を排除）
  if (!sender || sender.id !== chrome.runtime.id) return;
  if (msg?.type !== 'updateQdr') return;

  // qdr 値のホワイトリスト検証
  if (!VALID_QDR_VALUES.has(msg.qdr)) {
    sendResponse({ done: false, error: 'invalid qdr' });
    return false;
  }

  (async () => {
    try {
      suppressNextOnChanged = true;
      await chrome.storage.sync.set({ qdr: msg.qdr });
      await updateRules(msg.qdr);
    } catch (err) {
      suppressNextOnChanged = false;
      console.warn('[SearchClock] ルール更新エラー:', err);
    }
    sendResponse({ done: true });
  })();
  return true; // 非同期レスポンス
});
