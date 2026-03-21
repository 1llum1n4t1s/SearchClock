# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

SearchClock — Google検索の期間指定を固定化するChrome拡張機能（Manifest V3）。

設定した期間（例: 1年以内）で常にGoogle検索結果を絞り込む。`declarativeNetRequest`を使って検索前にURLパラメータ（`tbs=qdr:VALUE`）を付与するため、二重ローディングなし。

## ビルドコマンド

```bash
npm install                # 依存関係インストール（sharp, puppeteer）
npm run generate-icons     # icons/icon.svg → images/icon-{16,48,128}.png
npm run generate-screenshots # webstore/*.html → webstore/images/*.png
npm run build              # 上記2つを順次実行
```

## パッケージング

```powershell
powershell -ExecutionPolicy Bypass -File zip.ps1
```
manifest.json, scripts/, popup/, images/ をZIPに含める。node_modules や webstore/ は含まない。

## アーキテクチャ

- **manifest.json** — MV3拡張機能定義。権限は `declarativeNetRequest` + `storage`。ポップアップ付き。
- **scripts/background.js** — サービスワーカー。`declarativeNetRequest`の動的ルールを管理。設定変更時にルールを更新。
  - ルール1（allow, 優先度高）: 既にqdr:パラメータがある場合はスルー（手動設定を尊重）
  - ルール2（redirect, 優先度低）: Google検索URLに`tbs=qdr:VALUE`を付与
- **scripts/content.js** — Google検索ページにインライン設定パネルを注入（Shadow DOM使用）。右上のフローティングボタンで開閉。
- **popup/popup.html** — 拡張機能アイコンクリック時の設定ポップアップ。
- **popup/popup.js** — プリセット選択・カスタム入力のロジック。`chrome.storage.sync`で設定保存。
- **popup/popup.css** — ポップアップのスタイル。
- **icons/icon.svg** — マスターアイコン（時計+虫眼鏡）。`generate-icons.js`で全サイズ生成。
- **webstore/*.html** — ストア掲載画像のHTMLテンプレート。

## 期間指定の仕組み

Googleの`tbs`クエリパラメータで期間を制御:
- `qdr:h` = 1時間以内, `qdr:d` = 24時間以内, `qdr:w` = 1週間以内
- `qdr:m` = 1ヶ月以内, `qdr:m3` = 3ヶ月以内, `qdr:m6` = 半年以内
- `qdr:y` = 1年以内, `qdr:y2` = 2年以内, `qdr:y5` = 5年以内
- カスタム: `qdr:UNIT+NUMBER`（例: `qdr:h12` = 12時間以内）

## 制約事項

- `declarativeNetRequest`のリダイレクトには`host_permissions`が必要
- 対応ドメイン: google.com, google.co.jp, google.co.uk, google.ca, google.com.au, google.de, google.fr, google.es, google.it, google.co.kr, google.com.br
- 既にqdr:パラメータがあるURLは書き換えない（ユーザーの手動指定を優先）
