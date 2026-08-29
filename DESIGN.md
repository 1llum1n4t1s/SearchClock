# SearchClock 設計

## 目的と範囲

SearchClock は、Google Web 検索の `tbs` クエリパラメータへ期間条件 `qdr:VALUE` を設定する Manifest V3 Chrome 拡張機能である。検索結果ページ上の設定パネルから一回限りの絞り込み、または後続検索にも適用する維持モードを選べる。

拡張機能は対応する Google ドメインの `/search` と `chrome.storage.sync` の設定だけを扱う。外部サービスへデータを送信せず、ポップアップや独自バックエンドも持たない。

## 主要コンポーネント

| コンポーネント | 責務と境界 |
| --- | --- |
| `manifest.json` | サービスワーカーとコンテンツスクリプトの登録、対応 Google ドメイン、`declarativeNetRequest`・`storage` 権限を定義する。共有プリセットをコンテンツ本体より先に読み込む。 |
| `src/shared/presets.js` | プリセット、既定設定、有効な qdr 値、表示ラベル、`tbs` 解析を一元管理する。ブラウザでは共有グローバル、Node.js テストでは条件付き `module.exports` として使う。 |
| `src/background/background.js` | `chrome.storage.sync` を正規化して読み、維持モード用 DNR 動的ルール、アイコンのバッジ・タイトル、コンテンツスクリプトからの更新メッセージを管理する。 |
| `src/content/content.js` | Google 検索結果へ closed Shadow DOM の設定パネルを注入する。URLから表示状態を導出し、プリセット選択、維持モード切替、Google検索ツールとの後勝ち連携を処理する。 |
| `src/shared/presets.test.js` | 共有プリセットと `tbs` 解析の純粋関数契約を Node.js 組み込みテストで検証する。 |
| `scripts/` | Google ドメイン定義の同期検査と、SVGから配布用アイコンを生成する。 |
| `webstore/` | Chrome Web Store 掲載文と画像テンプレートを保持し、Puppeteerで掲載画像を生成する。製品ランタイムには含めない。 |
| `zip.ps1` / `zip.sh` | `manifest.json`、`src/`、`icons/` だけを配布ZIPへ格納する。 |
| `.github/workflows/publish.yml` | `release/**` の push を契機に検証・パッケージングし、Chrome Web Storeへ公開する。Actionsはcommit SHAで固定する。 |

作業コマンドと検証手順は [AGENTS.md](AGENTS.md) を正本とする。

## データフロー

### 起動と維持モード

1. サービスワーカーがインストール時・起動時に `qdr` と `keepSetting` をストレージから読む。
2. `keepSetting=true` かつ有効な `qdr` がある場合だけ、既存qdrのスキップ、既存tbsへのマージ、tbs新規追加の3段階のDNRルールを登録する。
3. DNRはGoogle Web検索のmain frameへ検索前に適用され、設定パネルの二重ロードを避ける。

### パネルからの期間変更

1. コンテンツスクリプトは現在URLの `tbs` からqdrだけを抽出し、パネルの表示状態を決める。
2. プリセット選択時は既存tbsのqdr以外のセグメントを維持した遷移先を組み立てる。
3. `updateQdr` メッセージをサービスワーカーへ送り、ルールとストレージの更新後に遷移する。サービスワーカーが応答しない場合もタイムアウト後に一度だけ遷移する。
4. 一回限りモードではDNRルールを持たず、その遷移URLだけへqdrを直接付与する。次の通常検索には自動適用しない。

### Google検索ツールとの後勝ち連携

1. コンテンツスクリプトは検索ツールのリンク先と現在URLのqdrセグメントだけを比較する。
2. Google側で期間が変わる場合は `qdr=''` と `keepSetting=false` をサービスワーカーへ送り、拡張機能の維持状態を解除してからGoogle側のリンクへ遷移する。
3. 画像サイズや並び順など、qdr以外のtbs変更は期間変更として扱わない。

## 重要な不変条件

- パネルが示す実際の絞り込み状態は、ストレージではなく現在URLのqdrを正本とする。
- `keepSetting=false` の間はDNR動的ルールを登録しない。
- 空のqdrで維持モードを新たに有効化しない。UIと変更ハンドラの両方で防御する。
- qdrは `VALID_QDR_VALUES` の値だけを受理し、サービスワーカーは送信元拡張機能IDも検証する。
- DNRルールの削除と追加は1回の `updateDynamicRules` で行い、ルールが一時的に空になる期間を作らない。
- DNR更新はPromiseキューで直列化し、実行時点の最新ストレージ値を使う。前段の失敗は後続更新を停止させない。
- DNRは対応ドメイン、main frame、`/search?` に限定し、既存tbsのqdr以外のセグメントを保持する。未エンコードの `qdr:` と `qdr%3A` の両方を既存qdrとして扱う。
- 対応ドメインの正本は `background.js` の `GOOGLE_DOMAINS` とし、`manifest.json` の `content_scripts.matches`・`host_permissions` との一致を `pnpm run check-domains` で検証する。
- コンテンツUIはclosed Shadow DOMとsystem fontだけを使い、Google側CSSとの干渉と外部フォント通信を避ける。
- 配布ZIPに開発用依存、生成スクリプト、ストア素材を含めない。

## 採用済み設計判断

### DNRによる検索前のURL変更

維持モードではコンテンツスクリプトによるロード後の再遷移ではなくDNRを使う。検索結果の二重ロードを避けられる一方、対象Googleドメインの `host_permissions` が必要になるため、対象を明示した一覧へ限定している。

### 一回限りを既定モードにする

既定の `keepSetting=false` は、利用者が期間設定を戻し忘れて検索結果を意図せず狭め続けることを防ぐ。永続適用は明示的に維持スイッチを有効化した場合だけ行う。

### URLとストレージの役割を分ける

URLは現在ページへ実際に適用された条件、ストレージは次回検索へ適用する設定を表す。この分離により、一回限りモードやGoogle検索ツールで変更された状態を正しく表示できる。

### 共有プリセットをビルドなしで再利用する

プリセット定義を通常スクリプトとしてbackground・contentの双方で共有し、条件付きCommonJS exportで単体テストにも再利用する。バンドル工程を不要にできる一方、manifestと `importScripts` の読み込み順を契約として維持する必要がある。

### closed Shadow DOMによるUI分離

Google側のDOM・CSSからパネルを隔離する。外部からのスタイル調整やデバッグは難しくなるため、DOM APIで自己完結したUIを構築し、注入先候補を複数持ってDOM変更への耐性を確保する。

### 生成物と製品ランタイムの分離

SharpとPuppeteerはアイコン・ストア画像を再生成する開発依存に限定する。拡張機能の配布物を小さく保ち、ランタイムの権限・通信・依存を増やさない。
