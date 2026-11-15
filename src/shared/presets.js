// SearchClock — プリセット共有定義
// content.js / background.js から共通で参照される単一ソース
// 追加・変更はこのファイルだけ触ればよい

// labelKey / shortKey は _locales の表示専用キー（検索・照合には使わない）。
// en は chip の副表記とバッジ文字に使うコード（翻訳しない）。
const PRESETS = [
  { labelKey: 'presetOffLabel', shortKey: 'presetOffShort', en: 'off', value: '' },
  { labelKey: 'presetH3Label', shortKey: 'presetH3Short', en: '3h', value: 'h3' },
  { labelKey: 'presetH12Label', shortKey: 'presetH12Short', en: '12h', value: 'h12' },
  { labelKey: 'presetD1Label', shortKey: 'presetD1Short', en: '1d', value: 'd' },
  { labelKey: 'presetD3Label', shortKey: 'presetD3Short', en: '3d', value: 'd3' },
  { labelKey: 'presetW1Label', shortKey: 'presetW1Short', en: '1w', value: 'w' },
  { labelKey: 'presetM1Label', shortKey: 'presetM1Short', en: '1mo', value: 'm' },
  { labelKey: 'presetM3Label', shortKey: 'presetM3Short', en: '3mo', value: 'm3' },
  { labelKey: 'presetM6Label', shortKey: 'presetM6Short', en: '6mo', value: 'm6' },
  { labelKey: 'presetY1Label', shortKey: 'presetY1Short', en: '1y', value: 'y' },
  { labelKey: 'presetY3Label', shortKey: 'presetY3Short', en: '3y', value: 'y3' },
];

// qdr値 → 表示ラベルの _locales キー（実際の文言は Localizer.t で引く）。
// 'h'（1時間以内）はプリセットに無い Google 標準値だが、状態表示のために持つ。
const QDR_LABEL_KEYS = {
  ...Object.fromEntries(PRESETS.filter(p => p.value).map(p => [p.value, p.labelKey])),
  h: 'presetH1Label',
};

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

// テーマアクセントカラー（ライト用）。
// 参照箇所:
//   - background.js の BADGE_BG（拡張アイコンのバッジ背景）
//   - content.js の THEME_LIGHT --accent（注入パネルのアクセント）
// 値変更時に 2 箇所がズレないよう、ここを唯一の真実の源とする。
const ACCENT_COLOR = '#6B4FB3';

// tbs パラメータから qdr セグメントを抽出。Google の tbs は複合形式
// （"qdr:y,sbd:1" / "isz:l,qdr:y" など）を取りうるので , 区切りで qdr のみ拾う。
const QDR_SEGMENT_RE = new RegExp(`(?:^|,)${QDR_PREFIX}([a-zA-Z0-9]+)(?:,|$)`);
function extractQdrFromTbs(tbs) {
  if (!tbs) return null;
  const m = tbs.match(QDR_SEGMENT_RE);
  return m ? m[1] : null;
}

// Google 検索ツールの期間変更か、別の検索・検索タイプへの移動かを区別する。
// start や source など期間変更で変わり得る補助パラメータは比較せず、
// 検索内容と検索タイプを決める q / tbm / udm だけを契約とする。
function isSameSearchContext(currentUrl, nextUrl) {
  return ['q', 'tbm', 'udm'].every(
    (key) => currentUrl.searchParams.get(key) === nextUrl.searchParams.get(key),
  );
}

// qdr → 2 桁ゼロパディング済みインデックス文字列（"00"〜"10"）を O(1) で返す
const QDR_INDEX_LABELS = Object.fromEntries(
  PRESETS.map((p, i) => [p.value, String(i).padStart(2, '0')]),
);

// qdr の PRESETS 内インデックスを 2 桁ゼロパディング文字列で返す（"01", "00", "—"）
// editorial 風の "No." プレフィックスは呼び出し側（content.js）で連結する
function refPresetIndex(qdr) {
  return QDR_INDEX_LABELS[qdr || ''] ?? '—';
}

// Node.js テスト環境用の export。
// ブラウザ (拡張機能) では `module` が undefined なので無視される。
// content.js / background.js は importScripts や content_scripts の連結で読み込むためここに依存しない。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PRESETS,
    QDR_LABEL_KEYS,
    QDR_EN_LABELS,
    VALID_QDR_VALUES,
    DEFAULT_SETTINGS,
    TBS_PARAM_KEY,
    QDR_PREFIX,
    ACCENT_COLOR,
    QDR_SEGMENT_RE,
    QDR_INDEX_LABELS,
    extractQdrFromTbs,
    isSameSearchContext,
    refPresetIndex,
  };
}
