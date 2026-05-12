// Google ドメインリストが 3 箇所で同期しているか検証する。
//   1. manifest.json の content_scripts[0].matches
//   2. manifest.json の host_permissions
//   3. src/background/background.js の GOOGLE_DOMAINS 配列
//
// 片側欠落は無音の部分機能不全（DNR は動くが content script が注入されない／その逆）を生むため、
// npm run build に組み込んで CI とローカルビルドで自動チェックする。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');
const BACKGROUND_PATH = path.join(ROOT, 'src/background/background.js');

function stripPattern(pattern) {
  // `*://www.google.com/search*` → `www.google.com`
  // `*://www.google.com/*`       → `www.google.com`
  const m = pattern.match(/^\*:\/\/([^/]+)\//);
  return m ? m[1] : null;
}

function extractFromManifest(manifestJson, key) {
  const arr = key === 'matches'
    ? manifestJson.content_scripts?.[0]?.matches
    : manifestJson.host_permissions;
  if (!Array.isArray(arr)) {
    throw new Error(`manifest.json: ${key} が配列ではありません`);
  }
  return arr.map(stripPattern).filter(Boolean);
}

function extractFromBackground(source) {
  // const GOOGLE_DOMAINS = [ ... ]; ブロックを抽出
  const m = source.match(/const\s+GOOGLE_DOMAINS\s*=\s*\[([\s\S]*?)\];/);
  if (!m) throw new Error('background.js: GOOGLE_DOMAINS 配列が見つかりません');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function diff(label, expected, actual) {
  const missing = expected.filter((d) => !actual.includes(d));
  const extra = actual.filter((d) => !expected.includes(d));
  const ok = missing.length === 0 && extra.length === 0;
  return { label, ok, missing, extra };
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const background = fs.readFileSync(BACKGROUND_PATH, 'utf8');

  const matches = extractFromManifest(manifest, 'matches');
  const hostPerms = extractFromManifest(manifest, 'host_permissions');
  const bgDomains = extractFromBackground(background);

  // 真実の源は background.js の GOOGLE_DOMAINS とする（コードがコメントで「真実の源」を持つ慣習）
  const checks = [
    diff('manifest.content_scripts.matches', bgDomains, matches),
    diff('manifest.host_permissions', bgDomains, hostPerms),
  ];

  const failed = checks.filter((c) => !c.ok);

  console.log('🔍 Google ドメインリスト同期チェック');
  console.log(`  真実の源 (background.js): ${bgDomains.length} ドメイン`);
  for (const c of checks) {
    const status = c.ok ? '✅' : '❌';
    console.log(`  ${status} ${c.label}: ${c.ok ? 'OK' : `差分あり (不足=${c.missing.length}, 余剰=${c.extra.length})`}`);
    if (c.missing.length) console.log(`     不足: ${c.missing.join(', ')}`);
    if (c.extra.length) console.log(`     余剰: ${c.extra.join(', ')}`);
  }

  if (failed.length) {
    console.error('\n❌ 同期失敗: manifest.json と background.js のドメインリストを揃えてください。');
    process.exit(1);
  }
  console.log('\n🎉 全 3 箇所のドメインリストが一致しています。');
}

main();
