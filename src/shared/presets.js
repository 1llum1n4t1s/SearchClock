// SearchClock — プリセット共有定義
// content.js / popup.js から共通で参照される単一ソース
// 追加・変更はこのファイルだけ触ればよい

const PRESETS = [
  { label: 'オフ', shortLabel: 'オフ', value: '' },
  { label: '3時間以内', shortLabel: '3時間', value: 'h3' },
  { label: '12時間以内', shortLabel: '12時間', value: 'h12' },
  { label: '1日以内', shortLabel: '1日', value: 'd' },
  { label: '3日以内', shortLabel: '3日', value: 'd3' },
  { label: '1週間以内', shortLabel: '1週間', value: 'w' },
  { label: '1ヶ月以内', shortLabel: '1ヶ月', value: 'm' },
  { label: '3ヶ月以内', shortLabel: '3ヶ月', value: 'm3' },
  { label: '半年以内', shortLabel: '半年', value: 'm6' },
  { label: '1年以内', shortLabel: '1年', value: 'y' },
  { label: '3年以内', shortLabel: '3年', value: 'y3' },
];

// qdr値 → 日本語ラベル
const QDR_LABELS = Object.fromEntries(
  PRESETS.filter(p => p.value).map(p => [p.value, p.label])
);

// 有効な qdr 値（空文字=オフも含む）。background.js の onMessage 検証で使用
const VALID_QDR_VALUES = new Set(PRESETS.map(p => p.value));
