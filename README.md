# SearchClock

Google検索の期間指定を固定化するChrome拡張機能です。

<img width="1280" height="800" alt="01-feature-overview-1280x800" src="https://github.com/user-attachments/assets/91d61064-b575-466a-ad3d-2c2af5024805" />


## 機能

一度期間を設定すれば、毎回「ツール」から期間を選び直す手間なく、常に新しい情報だけを表示できます。

- **期間指定の固定化** — ポップアップから期間を選ぶだけで、以降のGoogle検索に自動適用
- **検索前にインターセプト** — `declarativeNetRequest`でURLを書き換えるため二重ローディングなし
- **手動設定を尊重** — Google上で手動で期間を変更した場合はその設定が優先
- **インラインパネル** — Google検索結果の右サイドバーにも設定パネルを表示

## プリセット

オフ / 3時間 / 12時間 / 1日 / 3日 / 1週間 / 1ヶ月 / 3ヶ月 / 半年 / 1年 / 3年 / 5年 / 10年

## 使い方

1. Chrome Web Storeから拡張機能をインストール
2. ツールバーのSearchClockアイコンをクリック
3. お好みの期間を選択
4. 以降のGoogle検索が自動的にその期間で絞り込まれます

## 権限

- **declarativeNetRequest** — Google検索URLに期間指定パラメータを自動付与
- **storage** — ユーザーが選択した期間設定を保存
- **host_permissions** — Google検索URLのリダイレクトに必要（Google検索ページのみ）

## 開発

```bash
npm install                    # 依存関係インストール
npm run generate-icons         # icons/icon.svg → images/icon-{16,48,128}.png
npm run generate-screenshots   # webstore/*.html → webstore/images/*.png
npm run build                  # 上記2つを順次実行
```

### パッケージング

```powershell
powershell -ExecutionPolicy Bypass -File zip.ps1
```

## ライセンス

MIT License
