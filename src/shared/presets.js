// SearchClock — プリセット共有定義
// content.js / background.js から共通で参照される単一ソース
// 追加・変更はこのファイルだけ触ればよい

const PRESETS = [
  { label: 'オフ',     shortLabel: 'オフ',  en: 'off', value: ''   },
  { label: '3時間以内', shortLabel: '3時間', en: '3h',  value: 'h3' },
  { label: '12時間以内', shortLabel: '12時間', en: '12h', value: 'h12' },
  { label: '1日以内',   shortLabel: '1日',   en: '1d',  value: 'd'  },
  { label: '3日以内',   shortLabel: '3日',   en: '3d',  value: 'd3' },
  { label: '1週間以内', shortLabel: '1週間', en: '1w',  value: 'w'  },
  { label: '1ヶ月以内', shortLabel: '1ヶ月', en: '1mo', value: 'm'  },
  { label: '3ヶ月以内', shortLabel: '3ヶ月', en: '3mo', value: 'm3' },
  { label: '半年以内',   shortLabel: '半年',   en: '6mo', value: 'm6' },
  { label: '1年以内',   shortLabel: '1年',   en: '1y',  value: 'y'  },
  { label: '3年以内',   shortLabel: '3年',   en: '3y',  value: 'y3' },
];

// qdr値 → 日本語ラベル
const QDR_LABELS = Object.fromEntries(
  PRESETS.filter(p => p.value).map(p => [p.value, p.label])
);

// qdr値 → 英語短縮ラベル（mono サブテキスト用、'' も含む）
const QDR_EN_LABELS = Object.fromEntries(
  PRESETS.map(p => [p.value, p.en])
);

// 有効な qdr 値（空文字=オフも含む）。background.js の onMessage 検証で使用
const VALID_QDR_VALUES = new Set(PRESETS.map(p => p.value));

// chrome.storage.sync.get に渡すデフォルト値（散在防止）
//   keepSetting=false: 検索を実行するたびに自動でオフに戻る（チップ選択は1回限り）
//   keepSetting=true:  設定した qdr が常に適用される
const DEFAULT_SETTINGS = {
  qdr: '',
  keepSetting: false,
};

// Google の URL パラメータ仕様（マジック文字列の集約）
const TBS_PARAM_KEY = 'tbs';
const QDR_PREFIX = 'qdr:';

// tbs パラメータから qdr セグメントを抽出。Google の tbs は複合形式
// （"qdr:y,sbd:1" / "isz:l,qdr:y" など）を取りうるので , 区切りで qdr のみ拾う。
const QDR_SEGMENT_RE = new RegExp(`(?:^|,)${QDR_PREFIX}([a-zA-Z0-9]+)(?:,|$)`);
function extractQdrFromTbs(tbs) {
  if (!tbs) return null;
  const m = tbs.match(QDR_SEGMENT_RE);
  return m ? m[1] : null;
}

// qdr → "No. 03" 形式のインデックス文字列を O(1) で返す Map ルックアップ
const QDR_INDEX_LABELS = Object.fromEntries(
  PRESETS.map((p, i) => [p.value, String(i).padStart(2, '0')]),
);

// qdr の PRESETS 内インデックスを 2 桁ゼロパディング文字列で返す（"01", "00", "—"）
// editorial 風の "No. 03" 表示用
function refPresetIndex(qdr) {
  return QDR_INDEX_LABELS[qdr || ''] ?? '—';
}
