// Node 組み込みテストランナー (node:test) によるユニットテスト。依存ゼロ。
// 実行: `npm test` または `node --test src/shared/presets.test.js`
//
// 対象は extractQdrFromTbs / refPresetIndex / isSameSearchContext の純粋関数群。
// 拡張機能本体は依存しない（テストファイルは zip に含めない）。

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractQdrFromTbs,
  refPresetIndex,
  isSameSearchContext,
} = require('./presets.js');

test('extractQdrFromTbs: null/空文字は null を返す', () => {
  assert.equal(extractQdrFromTbs(null), null);
  assert.equal(extractQdrFromTbs(''), null);
  assert.equal(extractQdrFromTbs(undefined), null);
});

test('extractQdrFromTbs: 単独 qdr セグメント', () => {
  assert.equal(extractQdrFromTbs('qdr:y'), 'y');
  assert.equal(extractQdrFromTbs('qdr:h3'), 'h3');
  assert.equal(extractQdrFromTbs('qdr:y3'), 'y3');
});

test('extractQdrFromTbs: 複合 tbs から qdr を取り出す', () => {
  assert.equal(extractQdrFromTbs('qdr:y,sbd:1'), 'y');
  assert.equal(extractQdrFromTbs('isz:l,qdr:y'), 'y');
  assert.equal(extractQdrFromTbs('isz:l,qdr:y3,sbd:1'), 'y3');
});

test('extractQdrFromTbs: qdr セグメントが無ければ null', () => {
  assert.equal(extractQdrFromTbs('isz:l'), null);
  assert.equal(extractQdrFromTbs('sbd:1,isz:l'), null);
});

test('extractQdrFromTbs: qdr の前後に文字があると誤マッチしない', () => {
  // "aqdr:y" は qdr セグメントではない（先頭が a）
  assert.equal(extractQdrFromTbs('aqdr:y'), null);
  // "qdrz:y" のような変種にもマッチしない（コロン直前まで a-z0-9 制限）
  // → 注意: 現在の正規表現は qdr の直後にコロンを要求するため "qdrz:y" は通らない
  assert.equal(extractQdrFromTbs('qdrz:y'), null);
});

test('refPresetIndex: 不明値は "—" を返す', () => {
  assert.equal(refPresetIndex('invalid'), '—');
  assert.equal(refPresetIndex('xyz'), '—');
});

test('isSameSearchContext: qdr と補助パラメータだけの変更は同じ検索として扱う', () => {
  const current = new URL('https://www.google.com/search?q=test&tbs=qdr:y&start=10');
  const next = new URL('https://www.google.com/search?q=test&tbs=qdr:d&source=lnt');
  assert.equal(isSameSearchContext(current, next), true);
});

test('isSameSearchContext: 検索語が変わる関連検索は別検索として扱う', () => {
  const current = new URL('https://www.google.com/search?q=test&tbs=qdr:y');
  const next = new URL('https://www.google.com/search?q=other');
  assert.equal(isSameSearchContext(current, next), false);
});

test('isSameSearchContext: tbm または udm が変わる検索タイプ切替は別検索として扱う', () => {
  const current = new URL('https://www.google.com/search?q=test&tbs=qdr:y');
  const news = new URL('https://www.google.com/search?q=test&tbm=nws&tbs=qdr:y');
  const images = new URL('https://www.google.com/search?q=test&udm=2');
  assert.equal(isSameSearchContext(current, news), false);
  assert.equal(isSameSearchContext(current, images), false);
});
