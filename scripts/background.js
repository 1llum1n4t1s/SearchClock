// SearchClock — Google検索の期間指定を固定化するサービスワーカー
// declarativeNetRequestを使って検索前にURLを書き換える

// 対応するGoogleドメイン一覧
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

// 設定に基づいてdeclarativeNetRequestルールを更新
async function updateRules(qdr) {
  // 既存ルールを削除
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [REDIRECT_RULE_ID],
  });

  // オフの場合はルール追加しない
  if (!qdr) {
    return;
  }

  // 期間指定パラメータを常に上書き（拡張機能の設定を優先）
  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [
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

// 拡張機能インストール/更新時
chrome.runtime.onInstalled.addListener(async () => {
  const { qdr } = await chrome.storage.sync.get({ qdr: '' });
  await updateRules(qdr);
});

// ブラウザ起動時
chrome.runtime.onStartup.addListener(async () => {
  const { qdr } = await chrome.storage.sync.get({ qdr: '' });
  await updateRules(qdr);
});

// 設定変更を監視（ポップアップやコンテンツスクリプトからの変更）
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'sync' && changes.qdr) {
    await updateRules(changes.qdr.newValue);
  }
});
