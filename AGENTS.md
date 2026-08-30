# AGENTS.md

このファイルは、このリポジトリで作業するエージェント向けの規約を示します。

## プロジェクト概要

SearchClock — Google検索の期間指定を固定化するChrome拡張機能（Manifest V3）。

設定した期間（例: 1年以内）で常にGoogle検索結果を絞り込む。`declarativeNetRequest`を使って検索前にURLパラメータ（`tbs=qdr:VALUE`）を付与するため、二重ローディングなし。

## ビルドコマンド

```bash
pnpm install                 # 依存関係インストール（sharp, puppeteer, chrome-webstore-upload-cli）
pnpm test                    # 共有関数、SW競合、コンテンツ再注入の回帰テスト
pnpm run check-domains       # manifest.json と background.js のドメインリスト同期検証（ズレで exit 1）
pnpm run generate-icons      # icons/icon.svg → icons/icon-{16,48,128}.png（1つでも失敗で exit 1）
pnpm run generate-screenshots # webstore/*.html → webstore/images/*.png（Puppeteer。失敗時 throw → exit 1）
pnpm run build               # check-domains → generate-icons → generate-screenshots を順次実行
```

単一テスト実行: `node --test src/shared/presets.test.js --test-name-pattern '<pattern>'`

Linter は未導入。Chrome で `chrome://extensions` → 「パッケージ化されていない拡張機能を読み込む」で動作確認する。

## 必須検証

コード、依存、生成設定を変更した後は、次をすべて実行する。

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run build
git diff --check
```

## パッケージング

```powershell
pwsh -NoProfile -File zip.ps1                      # Windows
./zip.sh                                            # macOS/Linux
```
`manifest.json`, `src/`, `icons/` を `search-clock.zip` に含める。`src/**/*.test.*`, `node_modules`, `webstore/`, `docs/`, `scripts/` は含まない。

## 設計の正本

コンポーネントの責務、データフロー、不変条件、採用済み設計判断は [DESIGN.md](DESIGN.md) を参照する。実装の責務や境界を変更したときは、同じ変更で `DESIGN.md` も更新する。

## リリースフロー

`/vava` スキルで自動化済み。流れは:
1. `package.json` / `manifest.json` の `version` を `x.y.z` に +0.0.1
2. README 更新 → `main` にコミット & push
3. `release/x.y.z` ブランチを作成して push → publish.yml が Chrome Web Store に公開
4. 古い `release/*` ブランチは削除

## プリセット一覧

オフ / 3時間 / 12時間 / 1日 / 3日 / 1週間 / 1ヶ月 / 3ヶ月 / 半年 / 1年 / 3年

## 期間指定の仕組み

Googleの`tbs`クエリパラメータで期間を制御:
- `qdr:h3` = 3時間以内, `qdr:h12` = 12時間以内, `qdr:d` = 1日以内
- `qdr:d3` = 3日以内, `qdr:w` = 1週間以内, `qdr:m` = 1ヶ月以内
- `qdr:m3` = 3ヶ月以内, `qdr:m6` = 半年以内, `qdr:y` = 1年以内
- `qdr:y3` = 3年以内

## 後勝ち連携

- **拡張機能で期間変更** → URLからtbsパラメータを除去して再ナビゲーション → declarativeNetRequestが新しいtbsを付与
- **Google検索ツールで期間変更** → content.jsがクリックを検出 → chrome.storageでqdrを空に → declarativeNetRequestルール削除 → Googleの設定で再ナビゲーション

## 動作モード（keepSetting）

`chrome.storage.sync.keepSetting`（default `false`）で挙動を切替:

- **ON（keep）**: 設定した qdr が常に適用される。declarativeNetRequest が検索リクエストに tbs を付与し続ける。アイコンに qdr バッジ表示。
- **OFF（once、デフォルト）**: 検索を実行するたびに自動でオフへ戻る。background はルールを作らないため、検索フォーム経由のリクエストには tbs が付かない。チップ選択は content.js が URL に手動で tbs を付与してナビゲートする「1 回限り」の絞り込み。次の検索フォーム実行で自然にオフへ戻る。
- 結果ページの状態表示は **URL の tbs を真実** として算出する（storage.qdr ではない）。
- 注入パネル右端の switch で keepSetting を切替（popup は廃止済み）。**期間未設定（qdr=''）の状態では switch は disabled** — 先にプリセットを選ばないと ON にできない（DNR ルール無しの偽維持状態を防止）。

## 制約事項

- `declarativeNetRequest`のリダイレクトには`host_permissions`が必要
- 対応ドメイン: google.com, google.co.jp, google.co.uk, google.ca, google.com.au, google.de, google.fr, google.es, google.it, google.co.kr, google.com.br
  - **追加・削除時は `manifest.json` の 2 箇所（`content_scripts.matches` / `host_permissions`）と `src/background/background.js` の `GOOGLE_DOMAINS` 配列を必ず同時に更新すること**
  - 同期は `pnpm run check-domains`（または `pnpm run build`）で自動検証される。3 箇所のいずれかにズレがあると exit 1 で失敗するので、CI でも検知できる。
- テーマ検出はbodyの背景色RGB値で判定（brightness < 128でダーク）
- フォントは system font fallback のみ使用（IBM Plex Sans JP など web_accessible_resources でのフォント公開は廃止済み・フィンガープリント窓口を閉じるため）
