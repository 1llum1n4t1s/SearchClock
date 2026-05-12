// Node 組み込みテストランナー (node:test) によるユニットテスト。依存ゼロ。
// 実行: `npm test` または `node --test src/shared/presets.test.js`
//
// 対象は extractQdrFromTbs / refPresetIndex / VALID_QDR_VALUES の純粋関数群。
// 拡張機能本体は依存しない（テストファイルは zip に含めない）。

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractQdrFromTbs,
  refPresetIndex,
  VALID_QDR_VALUES,
  PRESETS,
  DEFAULT_SETTINGS,
  ACCENT_COLOR,
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

test('refPresetIndex: 全プリセットが 2 桁ゼロパディング文字列で返る', () => {
  for (let i = 0; i < PRESETS.length; i++) {
    const expected = String(i).padStart(2, '0');
    assert.equal(refPresetIndex(PRESETS[i].value), expected);
  }
});

test('refPresetIndex: 不明値は "—" を返す', () => {
  assert.equal(refPresetIndex('invalid'), '—');
  assert.equal(refPresetIndex('xyz'), '—');
});

test('refPresetIndex: null/undefined はオフ ("") として扱う', () => {
  // refPresetIndex は `qdr || ''` で正規化するため、null/undefined も '' 扱い
  assert.equal(refPresetIndex(null), '00');
  assert.equal(refPresetIndex(undefined), '00');
  assert.equal(refPresetIndex(''), '00');
});

test('VALID_QDR_VALUES: 全プリセット値を含み、不正値を含まない', () => {
  for (const preset of PRESETS) {
    assert.ok(VALID_QDR_VALUES.has(preset.value), `${preset.value} should be valid`);
  }
  assert.ok(!VALID_QDR_VALUES.has('invalid'));
  assert.ok(!VALID_QDR_VALUES.has(null));
  assert.ok(!VALID_QDR_VALUES.has(undefined));
});

test('VALID_QDR_VALUES: 空文字列 "" (オフ) は有効', () => {
  assert.ok(VALID_QDR_VALUES.has(''));
});

test('DEFAULT_SETTINGS: スキーマと既定値', () => {
  assert.deepEqual(DEFAULT_SETTINGS, { qdr: '', keepSetting: false });
});

test('ACCENT_COLOR: hex 形式', () => {
  assert.match(ACCENT_COLOR, /^#[0-9A-Fa-f]{6}$/);
});

test('PRESETS: 件数とラベルが揃っている', () => {
  assert.equal(PRESETS.length, 11);
  for (const p of PRESETS) {
    assert.ok(typeof p.label === 'string' && p.label.length > 0);
    assert.ok(typeof p.shortLabel === 'string' && p.shortLabel.length > 0);
    assert.ok(typeof p.en === 'string' && p.en.length > 0);
    assert.ok(typeof p.value === 'string');
  }
});
