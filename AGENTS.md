# AGENTS.md

このファイルは、このリポジトリで作業するエージェント向けの規約を示します。

## プロジェクト概要

SearchClock — Google検索の期間指定を固定化するChrome拡張機能（Manifest V3）。

検索結果ページのパネルで一回限りの期間指定（既定）と維持モードを選べる。利用者向けの機能・使い方は [README.md](README.md)、動作の詳細は [DESIGN.md](DESIGN.md) を参照する。

## ビルドコマンド

```bash
bun run deps                # lock固定の依存復元（sharp, puppeteer。bun install 直接実行は使わない）
bun --bun run test                    # 共有関数、SW競合、コンテンツ再注入の回帰テスト
bun --bun run check-domains       # manifest.json と background.js のドメインリスト同期検証（ズレで exit 1）
bun --bun run generate-icons      # icons/icon.svg → icons/icon-{16,48,128}.png（1つでも失敗で exit 1）
bun --bun run generate-screenshots # webstore/store-assets.json → webstore/images/<locale>/screenshot-NN.png + tile-*.png（vitrina。Windows は release=実拡張で 9 言語、それ以外は smoke。失敗時 exit 1）
bun --bun run build               # check-domains → generate-icons → generate-screenshots を順次実行
```

単一テスト実行: `bun test --test-name-pattern '<pattern>' src/shared/presets.test.js`

Chrome がない Windows 環境では `PUPPETEER_EXECUTABLE_PATH` に Edge の `msedge.exe` の絶対パスを設定して `bun --bun run test` と `bun --bun run build` を実行する。

Linter は未導入。Chrome で `chrome://extensions` → 「パッケージ化されていない拡張機能を読み込む」で動作確認する。

## 必須検証

コード、依存、生成設定を変更した後は、次をすべて実行する。

```bash
bun run deps
bun --bun run test
bun --bun run build
git diff --check
```

- **Chrome を起動するスクリプトを足すときはシード必須**: puppeteer.launch・chrome-launcher・Chrome の直接起動は、起動前に user-data-dir の `Local State` へ `{"password_manager":{"os_password_blank":false,"os_password_last_changed":"9223372036854775000"}}` を書く。Windows の Chromium は新規プロファイルごとに空パスワードで LogonUser を呼び（`password_manager_util_win.cc` の `CheckBlankPasswordWithPrefs`）、ログオン失敗（Security 4625）として数えられるため、並列・連続起動で Windows アカウントがロックされる（2026-11-15 実害）。`scripts/chrome-profile-seed.mjs` の `createSeededProfile()` / `seedChromeProfile()` を使い、userDataDir 未指定の起動は作らない（`webstore/vitrina/` は逐語コピーで対策済み）。

## パッケージング

```powershell
pwsh -NoProfile -File zip.ps1                      # Windows
./zip.sh                                            # macOS/Linux
```
`manifest.json`, `_locales/`, `src/`, `icons/` を `search-clock.zip` に含める。`src/**/*.test.*`, `node_modules`, `webstore/`, `docs/`, `scripts/` は含まない。
両スクリプトは依存関係の固定インストールとアイコン生成を行い、失敗時は終了する。テスト・ドメイン同期検査・ストア画像生成は行わないため、配布前に上記の必須検証を済ませる。

## 設計の正本

コンポーネントの責務、データフロー、不変条件、採用済み設計判断は [DESIGN.md](DESIGN.md) を参照する。実装の責務や境界を変更したときは、同じ変更で `DESIGN.md` も更新する。

## リリースフロー

`/vava` スキルで自動化済み。流れは:
1. `package.json` / `manifest.json` の `version` を `x.y.z` に +0.0.1
2. README 更新 → `main` にコミット & push
3. `release/x.y.z` ブランチを作成して push → publish.yml が Chrome Web Store へ下書きアップロードする。審査への申請は Dashboard で掲載画像を整えた後の `gh workflow run cws-submit.yml -f version=x.y.z --ref release/x.y.z`
4. 古い `release/*` ブランチは削除

## 共有定義の変更

プリセット、qdr値、既定設定、アクセントカラー、ラベルの `_locales` キーは `src/shared/presets.js` を変更する。background と content に個別定義を増やさず、共有スクリプトを先に読み込む順序（`ui-localizer.js` → `presets.js` → 本体）を保つ。期間変更・維持モード・後勝ち連携の不変条件は [DESIGN.md](DESIGN.md#重要な不変条件) を参照する。

## 多言語（UI文言）

- 表示文言は `_locales/<locale>/messages.json` に置き、9言語（`en` `ja` `zh_CN` `zh_TW` `ko` `es` `fr` `de` `pt_BR`）すべてへ同じキーを追加する。`default_locale` は `en`。コードの `Localizer.t` には英語の既定文言を渡す。
- `src/shared/ui-localizer.js` は Kagayoi.Support が正本の逐語コピーで、この拡張では編集しない。配置・対象は `l10n.config.json` が定める。更新が必要なら正本側で直して配り直す。
- ストア掲載文・画像の言語は `webstore/store-assets.json` の `locales` と同じ9言語に揃える。

## 制約事項

- `declarativeNetRequest`のリダイレクトには`host_permissions`が必要
- 対応ドメイン: google.com, google.co.jp, google.co.uk, google.ca, google.com.au, google.de, google.fr, google.es, google.it, google.co.kr, google.com.br
  - **追加・削除時は `manifest.json` の 2 箇所（`content_scripts.matches` / `host_permissions`）と `src/background/background.js` の `GOOGLE_DOMAINS` 配列を必ず同時に更新すること**
  - 同期は `bun --bun run check-domains`（または `bun --bun run build`）で自動検証される。3 箇所のいずれかにズレがあると exit 1 で失敗するので、CI でも検知できる。
- フォントは system font fallback のみ使用し、外部フォントの読み込みや `web_accessible_resources` でのフォント公開を追加しない。

### CWS 公開のHTTP境界

`publish.yml` はビルド済みZIPを `scripts/Publish-Cws.ps1`（PowerShell 7）へ渡す。既存のOAuth secrets・publisher/item IDを維持し、ZIPをストリーム送信し、upload成功を確認する（既定の `-Stage All` はその後publishまで行うが、CIは `-Stage Upload` でアップロードだけを行い、申請は `cws-submit.yml` が `-Stage Publish` で行う）。重複・通信断・不明な応答を公開成功として扱わず、ストア状態を確認してから再開する。公開専用npm CLIは使用しない。変更時はHTTP fixtureで成功・版/ID不一致・upload失敗・publish拒否を確認する。

CWS公開workflowはrepository固定のconcurrency groupで直列化する。同期uploadの成功・ID・版を確認した場合だけpublishし、非同期uploadはAPI v2でdraft版を要求と結び付けられないため停止する。APIにはuploadとpublishの原子的なCASが無いため、提出中はDashboardや他の手動公開操作を並行しない。

### CWS のアップロードと申請の分離

`publish.yml` は検証済みZIPを `-Stage Upload` で下書きとしてアップロードするだけで、審査へは申請しない。新ロケールの掲載画像欄はアップロード後でないと Dashboard に出ないため、申請は別workflow `.github/workflows/cws-submit.yml`（手動実行、`-Stage Publish`）で行う。

1. `release/x.y.z` を push する（publish.yml がアップロードする）
2. Dashboard（Edictora）でロケール別の掲載画像などを整えて下書き保存する
3. `gh workflow run cws-submit.yml -f version=x.y.z --ref release/x.y.z` で申請する

- API v2 は未申請の下書き版を返さないため、下書きの版そのものは確認できない。`cws-submit.yml` は次を満たす場合だけ `:publish` する: 実行 ref が `release/<version>` で manifest の版が入力と一致する。`publish.yml` の直近のアップロード成功 run（固定ステップ名 `Chrome Web Store にアップロード（下書き）`。`actions: read` で履歴を参照）が同じ commit である。fetchStatus で item identity・直近アップロード状態・公開/審査中の版を確認できる。
- 同版が申請済み・公開済み（PENDING_REVIEW / STAGED / PUBLISHED / PUBLISHED_TO_TESTERS）なら再送せず成功終了する。別版の審査中、より新しい版の存在、直近アップロードの進行中・失敗、状態不明は申請せず停止する。
- Dashboard で手動アップロードした下書きなど、同じ commit のアップロード成功 run が無い場合は申請されない。その場合は Dashboard から手動で申請する。
- 両workflowは同じ concurrency group で直列化する。申請中は Dashboard の操作を並行しない。

## Bun依存の脆弱性検出

依存の固定復元は `bun run deps` を使う。lock欠落・破損を拒否し、`[run] bun=true` 経由で依存のpostinstallまでBunで実行する。Node.jsがあるPCでも通常の `bun install` を直接使う経路へ戻さない。

依存更新は通常のDependabot PRで受け、Dependency validationで検証する。ローカルの `bun audit` でlock全体を監査できる。依存の自動修正・自動マージは行わない。
