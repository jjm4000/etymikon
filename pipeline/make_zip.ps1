# Build the publishable Chrome Web Store package.
#
#   powershell -File pipeline\make_zip.ps1
#
# Entry names are written with forward slashes explicitly. Do NOT substitute
# Compress-Archive: on Windows PowerShell it writes backslash separators, which
# violates the ZIP spec (APPNOTE 4.4.17.1) and can make the store mis-extract
# the folder structure.
#
# extension/package.json is excluded: it exists only so Node resolves lookup.js
# as ESM when running test/lookup.test.mjs. Chrome ignores it.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $root 'extension'

$version = (Get-Content (Join-Path $src 'manifest.json') -Raw | ConvertFrom-Json).version
$zip = Join-Path $root "okpyeon-$version.zip"

if (Test-Path $zip) { Remove-Item $zip -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$fs = [System.IO.File]::Open($zip, 'Create')
$archive = New-Object System.IO.Compression.ZipArchive($fs, 'Create')
try {
    Get-ChildItem $src -Recurse -File |
        Where-Object { $_.Name -ne 'package.json' } |
        ForEach-Object {
            $rel = $_.FullName.Substring($src.Length + 1).Replace('\', '/')
            $entry = $archive.CreateEntry($rel, 'Optimal')
            $stream = $entry.Open()
            $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Close()
            "  $rel"
        }
} finally {
    $archive.Dispose()
    $fs.Close()
}

"built $zip ({0:N2} MB)" -f ((Get-Item $zip).Length / 1MB)
