# 変更履歴

Git のバージョン記録・コミット差分と既存の変更履歴をもとに、確認できた版ごとの変更点をまとめています。「Git 記録日」は公開日ではありません。番号の欠番だけから未確認のリリースは補っていません。

## 未リリース

## [1.0.11] — Git 記録日: 2026-08-30

- 公開前の検証と配布パッケージを整備
- 検索設定の競合とパネル再注入を修正
- 依存関係を更新

出典: [版の記録](https://github.com/1llum1n4t1s/SearchClock/commit/ec067a08c76b9feac8bcf82e245b1a47f2c9a13b) / [変更差分](https://github.com/1llum1n4t1s/SearchClock/compare/5d8bb54d13c099432a7ec82a6c268da42758abfb...ec067a08c76b9feac8bcf82e245b1a47f2c9a13b)。

## [1.0.10] — Git 記録日: 2026-08-08

- 維持モード中の DNR 誤発火と後勝ち時の keepSetting 不整合を修正
- ランディングページを追加

出典: [版の記録](https://github.com/1llum1n4t1s/SearchClock/commit/5d8bb54d13c099432a7ec82a6c268da42758abfb) / [変更差分](https://github.com/1llum1n4t1s/SearchClock/compare/7f7edad7b3b4b889cdf37ec0eab5f30666601a3c...5d8bb54d13c099432a7ec82a6c268da42758abfb)。

## [1.0.9] — Git 記録日: 2026-07-27

- actions/checkout を v7.0.1 へ更新し SHA pin コメントを実態に合わせる
- bump pnpm/action-setup from 4.3.0 to 6.0.9 (#13)
- bump actions/setup-node from 6.4.0 to 7.0.0 (#12)
- AGENTS.md を Claude Code 向けに最適化して CLAUDE.md へ移行

出典: [版の記録](https://github.com/1llum1n4t1s/SearchClock/commit/7f7edad7b3b4b889cdf37ec0eab5f30666601a3c) / [変更差分](https://github.com/1llum1n4t1s/SearchClock/compare/6780164f729858565df8393ab6996c9f4fd968bd...7f7edad7b3b4b889cdf37ec0eab5f30666601a3c)。

## [1.0.8] — Git 記録日: 2026-07-18

- 注入先ログ対策・依存 CVE 解消・pnpm 移行

出典: [版の記録](https://github.com/1llum1n4t1s/SearchClock/commit/6780164f729858565df8393ab6996c9f4fd968bd) / [変更差分](https://github.com/1llum1n4t1s/SearchClock/compare/2b7bff5b526362edd7300485256de84102f6bcc0...6780164f729858565df8393ab6996c9f4fd968bd)。

## [1.0.7] — Git 記録日: 2026-05-13

- Google Maps・Shopping へ検索期間のルールが誤適用される問題と、期間維持の不整合を修正。
- ページ構造の変更、設定更新の競合、操作タイムアウトへの対応を改善。

出典: [版の記録](https://github.com/1llum1n4t1s/SearchClock/commit/2b7bff5b526362edd7300485256de84102f6bcc0) / [変更差分](https://github.com/1llum1n4t1s/SearchClock/compare/c7a44ce7d95bbf7f310b914ebe9d692dd23eb442...2b7bff5b526362edd7300485256de84102f6bcc0)。

## [1.0.6] — Git 記録日: 2026-05-10

- 「期間を維持」モード追加とeditorial UI刷新（popup廃止）

出典: [版の記録](https://github.com/1llum1n4t1s/SearchClock/commit/c7a44ce7d95bbf7f310b914ebe9d692dd23eb442) / [変更差分](https://github.com/1llum1n4t1s/SearchClock/compare/9025bf9ab0e454d72c84acc66ebc12075d9e5583...c7a44ce7d95bbf7f310b914ebe9d692dd23eb442)。

## [1.0.5] — Git 記録日: 2026-04-18

- 検索期間のプリセットを共通化し、不正な期間指定とメッセージ送信元を検証。
- ページ監視とクリック処理の後片付けを改善し、検索ルールの重複更新を防止。

出典: [版の記録](https://github.com/1llum1n4t1s/SearchClock/commit/9025bf9ab0e454d72c84acc66ebc12075d9e5583) / [変更差分](https://github.com/1llum1n4t1s/SearchClock/compare/114c57de73c1279caa9785f2c68a87511a08d851...9025bf9ab0e454d72c84acc66ebc12075d9e5583)。

## [1.0.4] — Git 記録日: 2026-03-23

- v1.0.4 — オフ切替・期間再読込・Google検索ツール連携の修正

出典: [版の記録](https://github.com/1llum1n4t1s/SearchClock/commit/114c57de73c1279caa9785f2c68a87511a08d851) / [変更差分](https://github.com/1llum1n4t1s/SearchClock/compare/b3fa4c49883dfccc3efda3c51b729fa8580a89b1...114c57de73c1279caa9785f2c68a87511a08d851)。

## [1.0.2] — Git 記録日: 2026-03-21

- v1.0.2 — 期間切替バグ修正 + コード最適化

出典: [版の記録](https://github.com/1llum1n4t1s/SearchClock/commit/b3fa4c49883dfccc3efda3c51b729fa8580a89b1) / [変更差分](https://github.com/1llum1n4t1s/SearchClock/compare/ade5d4b2a2e6bf2f746b90c5316e608fb30d9bdd...b3fa4c49883dfccc3efda3c51b729fa8580a89b1)。

## [1.0.0] — Git 記録日: 2026-03-21

- SearchClock Chrome拡張機能の初期実装

出典: [版の記録](https://github.com/1llum1n4t1s/SearchClock/commit/ade5d4b2a2e6bf2f746b90c5316e608fb30d9bdd)。
