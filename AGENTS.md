# AGENTS.md

このファイルは、このリポジトリで作業するエージェント向けの規約を示します。

## プロジェクト概要

SearchClock — Google検索の期間指定を固定化するChrome拡張機能（Manifest V3）。

検索結果ページのパネルで一回限りの期間指定（既定）と維持モードを選べる。利用者向けの機能・使い方は [README.md](README.md)、動作の詳細は [DESIGN.md](DESIGN.md) を参照する。

## ビルドコマンド

```bash
pnpm install                 # 依存関係インストール（sharp, puppeteer, chrome-webstore-upload-cli）
pnpm test                    # 共有関数、SW競合、コンテンツ再注入の回帰テスト
pnpm run check-domains       # manifest.json と background.js のドメインリスト同期検証（ズレで exit 1）
pnpm run generate-icons      # icons/icon.svg → icons/icon-{16,48,128}.png（1つでも失敗で exit 1）
pnpm run generate-screenshots # webstore/*.html → webstore/images/*.png（Puppeteer。失敗時 throw → exit 1）
pnpm run build               # check-domains → generate-icons → generate-screenshots を順次実行
```

単一テスト実行: `node --test --test-name-pattern '<pattern>' src/shared/presets.test.js`

Chrome がない Windows 環境では `PUPPETEER_EXECUTABLE_PATH` に Edge の `msedge.exe` の絶対パスを設定して `pnpm test` と `pnpm run build` を実行する。

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
両スクリプトは依存関係の固定インストールとアイコン生成を行い、失敗時は終了する。テスト・ドメイン同期検査・ストア画像生成は行わないため、配布前に上記の必須検証を済ませる。

## 設計の正本

コンポーネントの責務、データフロー、不変条件、採用済み設計判断は [DESIGN.md](DESIGN.md) を参照する。実装の責務や境界を変更したときは、同じ変更で `DESIGN.md` も更新する。

## リリースフロー

`/vava` スキルで自動化済み。流れは:
1. `package.json` / `manifest.json` の `version` を `x.y.z` に +0.0.1
2. README 更新 → `main` にコミット & push
3. `release/x.y.z` ブランチを作成して push → publish.yml が Chrome Web Store に公開
4. 古い `release/*` ブランチは削除

## 共有定義の変更

プリセット、qdr値、既定設定、ラベル、アクセントカラーは `src/shared/presets.js` を変更する。background と content に個別定義を増やさず、共有スクリプトを先に読み込む順序を保つ。期間変更・維持モード・後勝ち連携の不変条件は [DESIGN.md](DESIGN.md#重要な不変条件) を参照する。

## 制約事項

- `declarativeNetRequest`のリダイレクトには`host_permissions`が必要
- 対応ドメイン: google.com, google.co.jp, google.co.uk, google.ca, google.com.au, google.de, google.fr, google.es, google.it, google.co.kr, google.com.br
  - **追加・削除時は `manifest.json` の 2 箇所（`content_scripts.matches` / `host_permissions`）と `src/background/background.js` の `GOOGLE_DOMAINS` 配列を必ず同時に更新すること**
  - 同期は `pnpm run check-domains`（または `pnpm run build`）で自動検証される。3 箇所のいずれかにズレがあると exit 1 で失敗するので、CI でも検知できる。
- フォントは system font fallback のみ使用し、外部フォントの読み込みや `web_accessible_resources` でのフォント公開を追加しない。
