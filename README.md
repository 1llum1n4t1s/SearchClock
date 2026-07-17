# SearchClock

Google検索の期間指定（`tbs=qdr:VALUE`）を固定化するChrome拡張機能（Manifest V3）。

<img width="1280" height="800" alt="01-feature-overview-1280x800" src="https://github.com/user-attachments/assets/91d61064-b575-466a-ad3d-2c2af5024805" />


## 機能

検索結果ページ直接にパネルが現れて、その場でワンクリック期間絞り込み。「期間を維持」モードでは次の検索にも自動適用、「一回限り」モード（デフォルト）では検索ごとに自動でオフへ戻り、設定の戻し忘れによる意図しない絞り込みを防ぎます。

- **インライン設定パネル** — Google検索結果ページに editorial 風パネルを Shadow DOM で注入。ワンクリックで即再検索
- **2 つの動作モード**:
  - `keep`: 設定 qdr が常に適用される
  - `once` (デフォルト): 検索を実行するたびに自動でオフへ戻る — 戻し忘れ防止
- **拡張機能アイコン** — クリックで Google を新タブで開く + バッジで現在の qdr 表示
- **検索前インターセプト** — `declarativeNetRequest`でURLを書き換えるため二重ローディングなし
- **後勝ち連携** — Google検索ツールで期間を変更すると拡張機能は自動オフ。拡張機能で変更するとGoogle側をクリア
- **テーマ対応** — Googleのライト/ダークテーマを自動検出してデザインを切り替え
- **軽量** — 必要権限は `declarativeNetRequest` + `storage` のみ、外部通信なし

## プリセット

オフ / 3時間 / 12時間 / 1日 / 3日 / 1週間 / 1ヶ月 / 3ヶ月 / 半年 / 1年 / 3年

## 使い方

1. Chrome Web Storeから拡張機能をインストール
2. Google検索すると、検索結果の上にSearchClockパネルが表示されます
3. プリセットチップから期間を選択（例: 1年）→ その期間で絞り込まれます
4. ヘッダ右端の「期間を維持」スイッチで挙動を切替:
   - **ON**: 次の検索にも設定が自動適用（拡張機能アイコンに qdr バッジ表示）
   - **OFF**: 新しい検索を打つたびに自動でオフへ戻ります（デフォルト）
5. Google検索のツールで期間を変更すると、拡張機能は自動でオフになります

## 権限

- **declarativeNetRequest** — Google検索URLに期間指定パラメータを自動付与
- **storage** — 期間設定値（qdr）と動作モード（keepSetting）を保存
- **host_permissions** — Google検索URLのリダイレクトに必要（Google検索ページのみ）

## 開発

```bash
pnpm install                   # 依存関係インストール
pnpm test                      # presets.js の純粋関数ユニットテスト (node:test、依存ゼロ)
pnpm run check-domains         # manifest.json と background.js のドメインリスト同期検証
pnpm run generate-icons        # icons/icon.svg → icons/icon-{16,48,128}.png
pnpm run generate-screenshots  # webstore/*.html → webstore/images/*.png
pnpm run build                 # check-domains → generate-icons → generate-screenshots
```

### パッケージング

```powershell
powershell -ExecutionPolicy Bypass -File zip.ps1   # Windows
./zip.sh                                            # macOS/Linux
```

`manifest.json`, `src/`, `icons/` を `search-clock.zip` に含めます。

## 技術メモ

- **declarativeNetRequest** で検索リクエスト時に URL 書き換え（リダイレクト方式）
- **content.js は URL の `tbs` を真実として表示**（storage.qdr ではなく URL ベース）
- **`keepSetting=false`** のときは background が DNR ルールを作らず、content.js のチップ選択は **手動 URL 付与による 1 回限り** の絞り込み
- **後勝ち連携** は tbs 内の `qdr:` セグメントだけを比較。画像サイズ等の期間外 tbs 変更で誤発動しない
- **bfcache 復元** 時は `pageshow` で URL 再評価して clickHandler の cachedCurrentUrl を更新

## ライセンス

MIT License
