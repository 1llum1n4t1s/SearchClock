# SearchClock 拡張機能パッケージ生成スクリプト
# 使い方: pwsh -NoProfile -File zip.ps1 [-OutputPath <ZIPの保存先>]
param([string]$OutputPath = (Join-Path $PSScriptRoot 'search-clock.zip'))

$ErrorActionPreference = 'Stop'

# 入出力の実体がリンク経由にならないことを、既存の親階層まで確認する。
function Assert-LocalPath {
    param([string]$LiteralPath)
    $ancestor = $LiteralPath
    while ($ancestor) {
        if (Test-Path -LiteralPath $ancestor) {
            $item = Get-Item -LiteralPath $ancestor -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "パスに reparse point が含まれています: $ancestor"
            }
        }
        $ancestor = Split-Path -Path $ancestor -Parent
    }
}

try {
    $scriptDir = [IO.Path]::GetFullPath($PSScriptRoot)
    $zipPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
    Assert-LocalPath $scriptDir
    Assert-LocalPath $zipPath
    $outputDirectory = Get-Item -LiteralPath (Split-Path -Path $zipPath -Parent) -Force
    if (-not $outputDirectory.PSIsContainer) { throw 'ZIPの保存先フォルダーが存在しません。' }

    $manifestPath = Join-Path $scriptDir 'manifest.json'
    $sourceRoots = @((Join-Path $scriptDir 'icons'), (Join-Path $scriptDir 'src'))
    if ($zipPath -eq $manifestPath) { throw 'manifest.json はZIPの保存先に指定できません。' }
    foreach ($root in $sourceRoots) {
        Assert-LocalPath $root
        $boundary = $root + [IO.Path]::DirectorySeparatorChar
        if ($zipPath -eq $root -or $zipPath.StartsWith($boundary, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'icons / src 内はZIPの保存先に指定できません。'
        }
    }
    Assert-LocalPath $manifestPath

    Write-Host '拡張機能パッケージを生成中...' -ForegroundColor Cyan
    Push-Location -LiteralPath $scriptDir
    try {
        pnpm install --frozen-lockfile --silent
        if ($LASTEXITCODE -ne 0) { throw '依存関係のインストールに失敗しました。' }
        node scripts/generate-icons.js
        if ($LASTEXITCODE -ne 0) { throw 'アイコンの生成に失敗しました。' }
    } finally {
        Pop-Location
    }

    $files = @(Get-Item -LiteralPath $manifestPath -Force)
    foreach ($root in $sourceRoots) {
        $items = @(Get-ChildItem -LiteralPath $root -Recurse -Force)
        foreach ($item in $items) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "梱包対象に reparse point が含まれています: $($item.FullName)"
            }
            if ($item.PSIsContainer -or $item.Name -like '*.DS_Store' -or
                $item.Name -like '*.swp' -or $item.Name -like '*~' -or
                $item.Name -like '*.test.js' -or $item.Name -like '*.test.mjs' -or
                ($root -eq $sourceRoots[1] -and $item.Name -like '*.test.*')) { continue }
            $files += $item
        }
    }

    # FileMode.Create は保存先の書込み可否を確認し、既存ZIPを上書きする。
    $stream = [IO.File]::Open($zipPath, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
        try {
            foreach ($file in $files) {
                $entryName = [IO.Path]::GetRelativePath($scriptDir, $file.FullName).Replace('\', '/')
                [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                    $archive, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
            }
        } finally {
            if ($archive) { $archive.Dispose() }
        }
    } finally {
        $stream.Dispose()
    }
    $fileSizeKB = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1KB, 2)
    Write-Host "ZIPファイルを作成しました: $zipPath ($fileSizeKB KB)" -ForegroundColor Green
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
}
