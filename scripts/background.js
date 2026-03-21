// SearchClock — Google検索の期間指定を固定化するサービスワーカー
// declarativeNetRequestを使って検索前にURLを書き換える

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

async function updateRules(qdr) {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [REDIRECT_RULE_ID, SKIP_RULE_ID],
  });

  if (!qdr) return;

  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [
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
    ],
  });
}

// 初期化（インストール/更新/ブラウザ起動の共通処理）
async function initRules() {
  const { qdr } = await chrome.storage.sync.get({ qdr: '' });
  await updateRules(qdr);
}

chrome.runtime.onInstalled.addListener(initRules);
chrome.runtime.onStartup.addListener(initRules);

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'sync' && changes.qdr) {
    await updateRules(changes.qdr.newValue);
  }
});
