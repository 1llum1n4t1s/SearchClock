// SearchClock — Google検索の期間指定を固定化するサービスワーカー
// declarativeNetRequestを使って検索前にURLを書き換える
// アイコンクリックで Google を新タブで開き、バッジで現在の qdr を表示する

importScripts('../shared/presets.js');

const GOOGLE_DOMAINS = [
  // NOTE: manifest.json の content_scripts.matches / host_permissions と必ず同期すること。
  // 片側欠落でドメインが部分機能不全になる。CLAUDE.md「制約事項」節も同時更新。
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

const ADD_RULE_ID = 1;     // tbs パラメータが無い URL に新規追加
const SKIP_RULE_ID = 2;    // 既に qdr を含む tbs はそのまま通す
const MERGE_RULE_ID = 3;   // tbs 有り & qdr 無し: 既存セグメント保持して qdr を先頭に挿入

// バッジ色
//   ON: 紫アクセント（presets.js の ACCENT_COLOR を共有、CSS --accent ライト値と一致）
//   OFF: 灰（once モードの「動いてはいるが控えめ」を示す）
const BADGE_BG = ACCENT_COLOR;
const BADGE_BG_OFF = '#9b948b';

// 現在 declarativeNetRequest に適用中の状態（onMessage と onChanged の二重起動を冪等性で吸収するため）
// SW 再起動時は null にリセットされる → 次回呼び出しで必ず updateRules が走る安全側
let appliedQdr = null;
let appliedKeepSetting = null;

// updateRules を Promise チェーンで直列化（並行実行による appliedQdr 汚染を防止）
// onMessage / onChanged / initRules すべてここを通すこと。
//
// 重要: qdr / keepSetting は **キュー実行時点で storage から再読込** する。
//      enqueue 時点と実行時点の値ズレ（連打中に keepSetting が変わる等）を消すため。
//      qdrOverride を指定するのは onMessage のみ（storage.set 前に DNR 確定したいケース）。
let rulesQueue = Promise.resolve();
function enqueueUpdateRules(qdrOverride) {
  const next = rulesQueue
    .catch(() => {}) // 前段の失敗で後続を止めない
    .then(async () => {
      const settings = await readSettings();
      const qdr = qdrOverride !== undefined ? qdrOverride : settings.qdr;
      await updateRules(qdr, settings.keepSetting);
    });
  // rulesQueue 自体は常に resolved に保ち、Promise チェーン参照が無限に伸びるのを防ぐ。
  // 戻り値 `next` は「今 enqueue したこの呼び出しの完了」を正しく返す。
  rulesQueue = next.catch(() => {});
  return next;
}

// 「期間を維持」がOFFのときは、保存済み qdr に関わらずルールを作らない。
// → 検索フォーム経由のリクエストには tbs を付与せず自然に「期間指定なし」になる。
// チップ選択時の URL は content.js が手動で tbs を付与するので、その回限りは効く。
//
// ルール構成（既存 tbs 値を保持しつつ qdr を付与する 3 段構成）:
//   SKIP  (priority 3, allow)   : tbs に qdr セグメント含む → そのまま通す
//   MERGE (priority 2, redirect): tbs あり & qdr なし → 既存セグメントを保持し qdr を先頭挿入
//                                  (例 tbs=isz:l → tbs=qdr:y,isz:l)
//   ADD   (priority 1, redirect): tbs なし → addOrReplaceParams で qdr=Y を新規追加
async function updateRules(qdr, keepSetting) {
  // 冪等チェック: 既に同状態なら DNR を触らず即帰る。
  // onMessage 経由で更新後に発火する onChanged の二重実行や、SW 起動直後の重複 init を吸収する。
  // SW 再起動時は appliedQdr=null なので必ず通り、安全側に倒れる。
  if (qdr === appliedQdr && keepSetting === appliedKeepSetting) return;

  const effectiveQdr = keepSetting ? qdr : '';

  // remove と add を単一呼び出しにまとめてルール空白期間をなくす
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ADD_RULE_ID, SKIP_RULE_ID, MERGE_RULE_ID],
    addRules: effectiveQdr ? [
      {
        id: SKIP_RULE_ID,
        priority: 3,
        action: { type: 'allow' },
        condition: {
          // declarativeNetRequest の regexFilter は **生の (URL エンコード済み) URL** に対して
          // 評価されるため、`qdr:` リテラルだけでなく `qdr%3A` (コロンを percent-encoded した形式) も
          // 受理する。共有 URL や URLSearchParams で生成されたリンクで encoded 形式が来た時に
          // MERGE_RULE が誤って既存 qdr を非qdr と判定して上書きするのを防ぐ。
          //
          // `/search` パス制約: Maps (`/maps?tbs=lrf:...`)、Shopping (`/search?tbm=shop&tbs=p_ord:...`
          // は /search なので可)、Images など他の Google サービスへ波及しないよう、
          // クエリは `/search?` 直後に限定する。ADD_RULE 側の urlFilter:'/search' と一貫させる狙い。
          regexFilter: '^https?://[^/]+/search\\?[^#]*[?&]tbs=[^&]*qdr(?::|%3[Aa])',
          requestDomains: GOOGLE_DOMAINS,
          resourceTypes: ['main_frame'],
        },
      },
      // 既存 tbs に qdr が含まれない場合 → 既存セグメントを capture group で保持しつつ
      // qdr を先頭に挿入。\1 = URL 先頭〜 "?" or "&"、\2 = 既存 tbs 値、\3 = 残りクエリ。
      // 画像サイズ (isz)、ソート (sbd) などのユーザー指定フィルタが消えないようにするのが目的。
      // `/search` パス制約は SKIP_RULE と同じ理由で必須（Maps の `tbs=lrf:...` 等に発火させない）。
      {
        id: MERGE_RULE_ID,
        priority: 2,
        action: {
          type: 'redirect',
          redirect: {
            regexSubstitution: `\\1tbs=${QDR_PREFIX}${effectiveQdr},\\2\\3`,
          },
        },
        condition: {
          regexFilter: '^(https?://[^/]+/search\\?[^#]*[?&])tbs=([^&]+)(.*)$',
          requestDomains: GOOGLE_DOMAINS,
          resourceTypes: ['main_frame'],
        },
      },
      // tbs パラメータ自体が無い URL に qdr を追加
      {
        id: ADD_RULE_ID,
        priority: 1,
        action: {
          type: 'redirect',
          redirect: {
            transform: {
              queryTransform: {
                addOrReplaceParams: [
                  { key: TBS_PARAM_KEY, value: `${QDR_PREFIX}${effectiveQdr}`, replaceOnly: false },
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

  // updateDynamicRules 失敗時は throw され、ここに到達しないため appliedQdr は更新されない。
  // → 次回 onChanged で冪等チェックが必ず失敗し、自動的に再試行される（暗黙のリトライ経路）。
  appliedQdr = qdr;
  appliedKeepSetting = keepSetting;

  await refreshBadge(qdr, keepSetting);
}

// バッジ + ツールチップを更新
//   keepSetting=ON + qdr あり: 紫背景で qdr ラベル（"1y" 等）を表示
//   keepSetting=ON + qdr なし: 紫背景で "·"（モード可視化）
//   keepSetting=OFF: 灰背景で "·"（once モードを示す控えめインジケータ）
async function refreshBadge(qdr, keepSetting) {
  try {
    const onWithQdr = keepSetting && qdr;
    const enLabel = QDR_EN_LABELS[qdr] || qdr;
    const jpLabel = QDR_LABELS[qdr] || qdr;

    const text = onWithQdr ? enLabel : '·';
    const color = keepSetting ? BADGE_BG : BADGE_BG_OFF;
    const title = onWithQdr
      ? `SearchClock — 現在: ${jpLabel}（維持中）`
      : keepSetting
        ? 'SearchClock — 維持モード(期間指定なし)'
        : 'SearchClock — 一回限りモード(検索ごとに自動オフ)';

    // 3 つの chrome.action API は相互独立なので並列実行（直列だと 3 RTT、並列で 1 RTT）
    await Promise.all([
      chrome.action.setBadgeBackgroundColor({ color }),
      chrome.action.setBadgeText({ text }),
      chrome.action.setTitle({ title }),
    ]);
  } catch (err) {
    // バッジ更新失敗は機能本体に影響しないので警告のみで続行
    console.warn('[SearchClock] バッジ更新失敗:', err?.message ?? err);
  }
}

// 現在のストレージから qdr / keepSetting を取得して正規化
async function readSettings() {
  const { qdr, keepSetting } = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return {
    qdr: VALID_QDR_VALUES.has(qdr) ? qdr : '',
    keepSetting: !!keepSetting,
  };
}

// 初期化（インストール/更新/ブラウザ起動の共通処理）
// readSettings はキュー内で実行されるのでここでは呼ばない（race 回避）
function initRules() {
  return enqueueUpdateRules();
}

chrome.runtime.onInstalled.addListener(initRules);
chrome.runtime.onStartup.addListener(initRules);

// 拡張機能アイコンクリック → Google を新タブで開く（popup を廃止したため）
// NOTE: manifest.json に default_popup を追加すると onClicked は発火しなくなる Chrome 仕様
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: 'https://www.google.com/' }).catch((err) => {
    console.warn('[SearchClock] タブ作成失敗:', err?.message ?? err);
  });
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  // onChanged の async ハンドラは uncaught rejection で SW クラッシュを招くため try/catch で包む
  try {
    if (area !== 'sync') return;
    if (!changes.qdr && !changes.keepSetting) return;
    // 冪等チェックは updateRules 冒頭で実施。readSettings もキュー内で走るので race なし。
    await enqueueUpdateRules();
  } catch (err) {
    console.warn('[SearchClock] onChanged ルール更新エラー:', err?.message ?? err);
  }
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
      // qdr を上書き指定。keepSetting はキュー内 readSettings で最新値を読む（race 回避）。
      // updateRules を先に実行して appliedQdr を確定 → その後 storage.set。
      // この順序により storage.set 完了で発火する onChanged が冪等チェックでスキップされる。
      await enqueueUpdateRules(msg.qdr);
      await chrome.storage.sync.set({ qdr: msg.qdr });
    } catch (err) {
      console.warn('[SearchClock] ルール更新エラー:', err?.message ?? err);
    }
    // ルール更新失敗時もナビゲーション優先（次の読み込みで再適用される設計）
    sendResponse({ done: true });
  })();
  return true; // 非同期レスポンス
});
