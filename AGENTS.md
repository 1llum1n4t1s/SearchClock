# AGENTS.md

このファイルは、このリポジトリで作業するエージェント向けの規約を示します。

## プロジェクト概要

SearchClock — Google検索の期間指定を固定化するChrome拡張機能（Manifest V3）。

検索結果ページのパネルで一回限りの期間指定（既定）と維持モードを選べる。利用者向けの機能・使い方は [README.md](README.md)、動作の詳細は [DESIGN.md](DESIGN.md) を参照する。

## ビルドコマンド

```bash
bun install                 # 依存関係インストール（sharp, puppeteer）
bun --bun run test                    # 共有関数、SW競合、コンテンツ再注入の回帰テスト
bun --bun run check-domains       # manifest.json と background.js のドメインリスト同期検証（ズレで exit 1）
bun --bun run generate-icons      # icons/icon.svg → icons/icon-{16,48,128}.png（1つでも失敗で exit 1）
bun --bun run generate-screenshots # webstore/*.html → webstore/images/*.png（Puppeteer。失敗時 throw → exit 1）
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
  - 同期は `bun --bun run check-domains`（または `bun --bun run build`）で自動検証される。3 箇所のいずれかにズレがあると exit 1 で失敗するので、CI でも検知できる。
- フォントは system font fallback のみ使用し、外部フォントの読み込みや `web_accessible_resources` でのフォント公開を追加しない。

### CWS 公開のHTTP境界

`publish.yml` はビルド済みZIPを `scripts/Publish-Cws.ps1`（PowerShell 7）へ渡す。既存のOAuth secrets・publisher/item IDを維持し、ZIPをストリーム送信し、upload成功を確認してからpublishする。重複・通信断・不明な応答を公開成功として扱わず、ストア状態を確認してから再開する。公開専用npm CLIは使用しない。変更時はHTTP fixtureで成功・版/ID不一致・upload失敗・publish拒否を確認する。

CWS公開workflowはrepository固定のconcurrency groupで直列化する。同期uploadの成功・ID・版を確認した場合だけpublishし、非同期uploadはAPI v2でdraft版を要求と結び付けられないため停止する。APIにはuploadとpublishの原子的なCASが無いため、提出中はDashboardや他の手動公開操作を並行しない。

## Bun依存の脆弱性検出

依存の固定復元は `bun run deps` を使う。lock欠落・破損を拒否し、`[run] bun=true` 経由で依存のpostinstallまでBunで実行する。Node.jsがあるPCでも通常の `bun install` を直接使う経路へ戻さない。

日次と手動実行では `bun audit` でlock全体を監査する。ローカルでも同じコマンドで確認できる。BunはDependabotの通常の更新PRには対応するが、脆弱性起点の自動修正PRは `dependency-security.yml` が補完する。日次・手動で全件監査し、隔離領域で `bun audit fix` による候補を作成し、同じrunから既存の Dependency validation を呼ぶ。未対策アドバイザリが減少し、依存以外のmanifest・パッチ・24時間待機を保ち、全検証が成功した場合だけ、検証したマージコミットを競合検知付きの通常pushで取り込む。保護されたブランチには自動pushせず、修正版未公開・互換性・検証失敗は単一のIssueに通知して次回再試行する。生の監査は警告を除外せず、対策済みパッチの認定も監査成功とは区別してsummaryへ残す。既知のdeepmerge対策はアドバイザリ・版・パッチSHAが完全一致した場合だけ修正対象から外し、生監査には残す。通常のDependabot更新と他ecosystemの設定は維持する。
