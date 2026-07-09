$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$buildRoot = Join-Path $root "build"
$stage = Join-Path $buildRoot "chrome-store-package"
$zipPath = Join-Path $buildRoot "gofood-vietqr-helper-1.0.15.zip"

$resolvedBuildRoot = [System.IO.Path]::GetFullPath($buildRoot)
$resolvedStage = [System.IO.Path]::GetFullPath($stage)
if (-not $resolvedStage.StartsWith($resolvedBuildRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Invalid build staging path."
}

if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Force -Path $stage | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage "assets\icons") | Out-Null

Copy-Item -LiteralPath (Join-Path $root "manifest.json") -Destination $stage
Copy-Item -LiteralPath (Join-Path $root "src") -Destination $stage -Recurse

foreach ($size in 16, 32, 48, 128) {
    $icon = "icon-$size.png"
    Copy-Item `
        -LiteralPath (Join-Path $root "assets\icons\$icon") `
        -Destination (Join-Path $stage "assets\icons\$icon")
}

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -CompressionLevel Optimal
Write-Host "Created $zipPath"
