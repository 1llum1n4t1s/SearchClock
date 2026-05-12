# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

SearchClock — Google検索の期間指定を固定化するChrome拡張機能（Manifest V3）。

設定した期間（例: 1年以内）で常にGoogle検索結果を絞り込む。`declarativeNetRequest`を使って検索前にURLパラメータ（`tbs=qdr:VALUE`）を付与するため、二重ローディングなし。

## ビルドコマンド

```bash
npm install                  # 依存関係インストール（sharp, puppeteer, http-server, chrome-webstore-upload-cli）
npm test                     # presets.js の純粋関数ユニットテスト（node:test 内蔵、依存ゼロ）
npm run check-domains        # manifest.json と background.js のドメインリスト同期検証（ズレで exit 1）
npm run generate-icons       # icons/icon.svg → icons/icon-{16,48,128}.png（1つでも失敗で exit 1）
npm run generate-screenshots # webstore/*.html → webstore/images/*.png（Puppeteer。失敗時 throw → exit 1）
npm run build                # check-domains → generate-icons → generate-screenshots を順次実行
```

単一テスト実行: `node --test src/shared/presets.test.js --test-name-pattern '<pattern>'`

Linter は未導入。Chrome で `chrome://extensions` → 「パッケージ化されていない拡張機能を読み込む」で動作確認する。

## パッケージング

```powershell
powershell -ExecutionPolicy Bypass -File zip.ps1   # Windows
./zip.sh                                            # macOS/Linux
```
`manifest.json`, `src/`, `icons/` を `search-clock.zip` に含める。`node_modules`, `webstore/`, `docs/`, `scripts/` は含まない。

## アーキテクチャ

- **manifest.json** — MV3拡張機能定義。権限は `declarativeNetRequest` + `storage`。**ポップアップなし**（`default_popup` 未指定）。アイコンクリックは `chrome.action.onClicked` で background が処理（Google を新タブで開く）。
- **src/shared/presets.js** — プリセット定義の単一ソース。`PRESETS`（`label` / `shortLabel` / `en` / `value`）/ `QDR_LABELS` / `QDR_EN_LABELS` / `VALID_QDR_VALUES` / `DEFAULT_SETTINGS` / `QDR_INDEX_LABELS` / `refPresetIndex()` / `extractQdrFromTbs()` / `TBS_PARAM_KEY` / `QDR_PREFIX` / `ACCENT_COLOR` を公開。background / content / テスト すべてから共有される。**末尾に `module.exports` ブロックあり**（Node テストからの require 用、ブラウザでは `module` 未定義のため無視される）。
- **src/shared/presets.test.js** — `node:test` 組み込みランナーによる純粋関数ユニットテスト（依存ゼロ）。`extractQdrFromTbs` / `refPresetIndex` / `VALID_QDR_VALUES` / `DEFAULT_SETTINGS` / `ACCENT_COLOR` / `PRESETS` の 13 件をカバー。zip 対象外。
- **src/background/background.js** — サービスワーカー。`declarativeNetRequest`の動的ルールを管理。remove+add を単一 `updateDynamicRules` で実行（ルール空白期間なし）。**`keepSetting === false` のときは常にルール無し**（OFFモードでは検索フォーム経由のリクエストに tbs を付与しない）。`onMessage` で sender.id 検証 + qdr ホワイトリスト検証。`onChanged` ハンドラは try/catch で包んで SW クラッシュ防止。**冪等チェックは `updateRules` 冒頭** (`qdr === appliedQdr && keepSetting === appliedKeepSetting` ならスキップ) で onMessage / onChanged / initRules すべてを吸収する。SW 再起動時は `appliedQdr=null` で必ず通る安全側。**`enqueueUpdateRules(qdrOverride?)`** は内部で `readSettings()` を呼び、enqueue 時点ではなくキュー実行時点の最新 storage 値を使う（race 回避）。戻り値 `next` は「この呼び出しの完了」を正しく返し、`rulesQueue` は常に resolved を保つ（チェーン参照の蓄積防止）。**SKIP_RULE / MERGE_RULE の regexFilter には `^https?://[^/]+/search\?` パス制約あり**（Google Maps / Shopping / Images / News などへの誤発火を防止）。SKIP_RULE は qdr 以外の tbs（画像サイズ等）で誤動作しないよう `tbs=...qdr:...` に絞り、percent-encoded な `qdr%3A` も受理する。`chrome.action.onClicked` で Google を新タブで開く + `setBadgeText` で qdr バッジ表示 + `setTitle` でツールチップ。`BADGE_BG = ACCENT_COLOR`（presets.js から参照、ライトテーマ `--accent` と一致）。
- **src/content/content.js** — Google検索ページの設定パネル注入（Shadow DOM closed mode、DOM API で組み立て、**フォントは system font + Hiragino/Noto/Segoe UI fallback のみ**）。**注入先は `findInjectionTarget()`** で `#center_col → #rcnt main → main[role="main"] → #rcnt` の順にフォールバック（Google の DOM 変更で全停止しない耐性）。見つからない場合は `console.warn` を残して退出。**状態表示・ラジオ選択は URL の tbs パラメータを真実として算出**（storage.qdr ではなく）。プリセット選択 → **`sendQdrAndNavigate(qdr, dest)` ヘルパー**で SW にメッセージ送信 + 3 秒タイムアウト救済 + `navigated` フラグで二重ナビ防止。Google検索ツールの期間変更を検出して拡張機能をオフにする（後勝ち連携、tbs 内 qdr セグメントだけを比較、`linkUrl.href` を使う防御的代入）。**期間未設定時は keepInput を `disabled` にし、change ハンドラに二重防御 guard あり**（紫バッジだけ点く偽維持状態を防止）。**keepInput の change は 500ms debounce** で storage.sync の MAX_WRITE_OPERATIONS_PER_MINUTE=120 クォータ枯渇を防ぐ。ライト/ダークテーマを自動検出。MutationObserver は `centerCol` + `parentNode` の childList 限定で監視、`cleaned` フラグで二重実行ガード、クリーンアップ時に click / pageshow リスナーも解除。**bfcache 復元時は `pageshow` で URL 再評価して cachedCurrentUrl を更新**。CSS の grid 列数は `${PRESETS.length}` / `${Math.ceil(PRESETS.length / 2)}` でプリセット件数に連動。
- **icons/icon.svg** — マスターアイコン（時計+虫眼鏡）。`scripts/generate-icons.js`で全サイズ生成。
- **scripts/generate-icons.js** — sharp で SVG → PNG 変換。1つでも失敗すれば exit 1。
- **scripts/check-domains.js** — `manifest.json` の `content_scripts.matches` + `host_permissions` と `background.js` の `GOOGLE_DOMAINS` が一致しているか検証。**background.js の `GOOGLE_DOMAINS` を真実の源として、不足/余剰があれば exit 1**。`npm run build` と CI の publish workflow に組み込み済み。
- **webstore/*.html** — ストア掲載画像のHTMLテンプレート。`webstore/generate-screenshots.js`（Puppeteer）でPNGに変換。失敗時は catch で `throw` するため `Promise.all` が reject → `process.exit(1)`（壊れた画像で偽の成功を返さない）。
- **webstore/store-listing.txt** — Chrome Web Store申請用のコピペ用テキスト。
- **docs/privacy-policy.md** — Chrome Web Store 申請に必要なプライバシーポリシー。
- **.github/workflows/publish.yml** — `release/**` ブランチ push で Chrome Web Store に自動公開。**Actions は SHA pin、`chrome-webstore-upload-cli` は `package.json` で固定 + `npm exec` で起動**（サプライチェーン攻撃防止）。`PUPPETEER_SKIP_DOWNLOAD=true` で CI 不要な Chromium バイナリのダウンロードをスキップ。**`node scripts/check-domains.js` ステップでドメイン同期検証**。Secrets: `CWS_CLIENT_ID` / `CWS_CLIENT_SECRET` / `CWS_REFRESH_TOKEN` / `CWS_EXTENSION_ID` 必須。
- **.github/dependabot.yml** — npm と github-actions の月次自動更新 PR。SHA pin の追従と依存脆弱性検知を担う。

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
  - 同期は `npm run check-domains`（または `npm run build`）で自動検証される。3 箇所のいずれかにズレがあると exit 1 で失敗するので、CI でも検知できる。
- テーマ検出はbodyの背景色RGB値で判定（brightness < 128でダーク）
- フォントは system font fallback のみ使用（IBM Plex Sans JP など web_accessible_resources でのフォント公開は廃止済み・フィンガープリント窓口を閉じるため）
