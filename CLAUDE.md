# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

SearchClock — Google検索の期間指定を固定化するChrome拡張機能（Manifest V3）。

設定した期間（例: 1年以内）で常にGoogle検索結果を絞り込む。`declarativeNetRequest`を使って検索前にURLパラメータ（`tbs=qdr:VALUE`）を付与するため、二重ローディングなし。

## ビルドコマンド

```bash
npm install                  # 依存関係インストール（sharp, puppeteer, http-server）
npm run generate-icons       # icons/icon.svg → icons/icon-{16,48,128}.png
npm run generate-screenshots # webstore/*.html → webstore/images/*.png（Puppeteer）
npm run build                # 上記2つを順次実行
```

テストフレームワーク・Linter は未導入。Chrome で `chrome://extensions` → 「パッケージ化されていない拡張機能を読み込む」で動作確認する。

## パッケージング

```powershell
powershell -ExecutionPolicy Bypass -File zip.ps1   # Windows
./zip.sh                                            # macOS/Linux
```
`manifest.json`, `src/`, `icons/` を `search-clock.zip` に含める。`node_modules`, `webstore/`, `docs/`, `scripts/` は含まない。

## アーキテクチャ

- **manifest.json** — MV3拡張機能定義。権限は `declarativeNetRequest` + `storage`。ポップアップ付き。
- **src/shared/presets.js** — プリセット定義の単一ソース。`PRESETS` / `QDR_LABELS` / `VALID_QDR_VALUES` を公開。background / content / popup すべてから共有される。
- **src/background/background.js** — サービスワーカー。`declarativeNetRequest`の動的ルールを管理。remove+add を単一 `updateDynamicRules` で実行（ルール空白期間なし）。`onMessage` で sender.id 検証 + qdr ホワイトリスト検証を行い、`storage.onChanged` との二重起動を抑制。
- **src/content/content.js** — Google検索ページの`#center_col`先頭にインライン設定パネルを注入（Shadow DOM使用、DOM API で組み立て）。プリセット選択で即再検索。Google検索ツールの期間変更を検出して拡張機能をオフにする（後勝ち連携）。ライト/ダークテーマを自動検出。MutationObserver は `centerCol` 限定で監視、クリーンアップ時に click リスナーも解除。
- **src/popup/popup.html** — 拡張機能アイコンクリック時の設定ポップアップ（プリセットのラジオは popup.js が動的生成）。
- **src/popup/popup.js** — プリセット選択のロジック。`chrome.storage.sync`で設定保存。`PRESETS` を動的にラジオ化。
- **src/popup/popup.css** — ポップアップのスタイル（紫グラデーション系）。
- **icons/icon.svg** — マスターアイコン（時計+虫眼鏡）。`scripts/generate-icons.js`で全サイズ生成。
- **scripts/generate-icons.js** — sharp で SVG → PNG 変換。1つでも失敗すれば exit 1。
- **webstore/*.html** — ストア掲載画像のHTMLテンプレート。`webstore/generate-screenshots.js`（Puppeteer）でPNGに変換。
- **webstore/store-listing.txt** — Chrome Web Store申請用のコピペ用テキスト。
- **docs/privacy-policy.md** — Chrome Web Store 申請に必要なプライバシーポリシー。
- **.github/workflows/publish.yml** — `release/**` ブランチ push で Chrome Web Store に自動公開（Secrets: `CLIENT_ID` / `CLIENT_SECRET` / `REFRESH_TOKEN` / `EXTENSION_ID` 必須）。

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

## 制約事項

- `declarativeNetRequest`のリダイレクトには`host_permissions`が必要
- 対応ドメイン: google.com, google.co.jp, google.co.uk, google.ca, google.com.au, google.de, google.fr, google.es, google.it, google.co.kr, google.com.br
- テーマ検出はbodyの背景色RGB値で判定（brightness < 128でダーク）
