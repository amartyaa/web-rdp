<#
.SYNOPSIS
    Builds vcollab-web-rdp and bundles all FreeRDP runtime DLLs.

.PARAMETER OutputDir
    Output directory for the bundled build. Default: dist/windows

.EXAMPLE
    .\scripts\build-windows.ps1
#>

param(
    [string]$OutputDir = "dist\windows"
)

$MSYS2_ROOT = "C:\msys64"
$UCRT64_BIN = "$MSYS2_ROOT\ucrt64\bin"

if (-not (Test-Path "$UCRT64_BIN\gcc.exe")) {
    Write-Host "ERROR: MSYS2 UCRT64 GCC not found at $UCRT64_BIN\gcc.exe" -ForegroundColor Red
    exit 1
}

# ── Set CGO environment ─────────────────────────────────────────────────────
$env:CGO_ENABLED = "1"
$env:CC = "$UCRT64_BIN\gcc.exe"
$env:PKG_CONFIG = "$UCRT64_BIN\pkg-config.exe"
$env:PATH = "$UCRT64_BIN;$env:PATH"

Write-Host "==> Environment" -ForegroundColor Cyan
Write-Host "    CC:  $env:CC"
Write-Host "    GCC: $(& $env:CC --version | Select-Object -First 1)"
Write-Host ""

# ── Build ────────────────────────────────────────────────────────────────────
Write-Host "==> Building vcollab-web-rdp.exe ..." -ForegroundColor Cyan

$tempErr = [System.IO.Path]::GetTempFileName()
$proc = Start-Process -FilePath "go" -ArgumentList "build","-o","vcollab-web-rdp.exe","." `
    -NoNewWindow -Wait -PassThru -RedirectStandardError $tempErr
$stderrContent = Get-Content $tempErr -Raw -ErrorAction SilentlyContinue
Remove-Item $tempErr -Force -ErrorAction SilentlyContinue

if (-not (Test-Path "vcollab-web-rdp.exe")) {
    Write-Host "ERROR: Build failed!" -ForegroundColor Red
    if ($stderrContent) { Write-Host $stderrContent -ForegroundColor Yellow }
    exit 1
}

Write-Host "    Build successful." -ForegroundColor Green
Write-Host ""

# ── Prepare output directory ─────────────────────────────────────────────────
if (Test-Path $OutputDir) { Remove-Item -Recurse -Force $OutputDir }
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

Copy-Item "vcollab-web-rdp.exe" "$OutputDir\"
Write-Host "==> Copied binary to $OutputDir\" -ForegroundColor Cyan

# ── Discover runtime DLLs via ldd ────────────────────────────────────────────
Write-Host "==> Discovering runtime DLLs via ldd ..." -ForegroundColor Cyan

$binaryWinPath = (Resolve-Path "vcollab-web-rdp.exe").Path
$binaryMsysPath = "/" + ($binaryWinPath -replace "\\", "/" -replace "^([A-Za-z]):", { $_.Groups[1].Value.ToLower() })

$lddRaw = & "$MSYS2_ROOT\msys2_shell.cmd" -ucrt64 -defterm -no-start -here -c `
    "ldd '$binaryMsysPath' 2>/dev/null" 2>$null

# Parse ldd output to extract DLL names from ucrt64
$dllNames = [System.Collections.Generic.List[string]]::new()

if ($lddRaw) {
    foreach ($line in $lddRaw) {
        $text = $line.ToString().Trim()
        if ($text -match "=>\s*/ucrt64/bin/(\S+)") {
            $name = $Matches[1]
            if (-not $dllNames.Contains($name)) {
                $dllNames.Add($name)
            }
        }
    }
}

# If ldd didn't produce results, use the known dependency list
if ($dllNames.Count -eq 0) {
    Write-Host "    ldd returned no results, using known dependency list ..." -ForegroundColor Yellow
    $knownDlls = @(
        "libfreerdp3.dll", "libfreerdp-client3.dll", "libwinpr3.dll",
        "libssl-3-x64.dll", "libcrypto-3-x64.dll",
        "zlib1.dll", "libcjson-1.dll", "liburiparser-1.dll",
        "libusb-1.0.dll", "libwinpthread-1.dll", "libgcc_s_seh-1.dll",
        "libstdc++-6.dll", "libiconv-2.dll", "libintl-8.dll",
        "avcodec-62.dll", "avutil-60.dll", "swresample-6.dll", "swscale-9.dll",
        "libcairo-2.dll", "libpixman-1-0.dll", "libfontconfig-1.dll",
        "libfreetype-6.dll", "libpng16-16.dll", "libharfbuzz-0.dll",
        "libbz2-1.dll", "libbrotlidec.dll", "libbrotlicommon.dll", "libbrotlienc.dll",
        "libexpat-1.dll", "libpcre2-8-0.dll", "libglib-2.0-0.dll",
        "libgobject-2.0-0.dll", "libffi-8.dll", "libfribidi-0.dll",
        "liblzma-5.dll", "libgraphite2.dll", "libzstd.dll",
        "libopus-0.dll", "libogg-0.dll", "libvorbis-0.dll",
        "libspeex-1.dll", "libmp3lame-0.dll",
        "libdav1d-7.dll", "libaom.dll", "libx264-165.dll", "libx265-215.dll",
        "libvpx-1.dll", "xvidcore.dll", "librav1e.dll", "libSvtAv1Enc-4.dll",
        "libwebp-7.dll", "libsharpyuv-0.dll",
        "libva.dll", "libva_win32.dll", "libvpl-2.dll",
        "libjpeg-8.dll", "libtiff-6.dll", "libdeflate.dll", "libjbig-0.dll", "libLerc.dll",
        "libjxl.dll", "libjxl_threads.dll", "libjxl_cms.dll", "libhwy.dll",
        "liblcms2-2.dll", "libopenjp2-7.dll",
        "libxml2-16.dll", "libpango-1.0-0.dll", "libpangocairo-1.0-0.dll",
        "libpangoft2-1.0-0.dll", "libpangowin32-1.0-0.dll",
        "libcairo-gobject-2.dll", "libgdk_pixbuf-2.0-0.dll",
        "libgio-2.0-0.dll", "libgmodule-2.0-0.dll",
        "librsvg-2-2.dll", "libthai-0.dll", "libdatrie-1.dll",
        "libsoxr.dll", "libgsm.dll", "liblc3-1.dll",
        "libopencore-amrnb-0.dll", "libopencore-amrwb-0.dll",
        "libtheoraenc-2.dll", "libtheoradec-2.dll",
        "libvorbisenc-2.dll", "libwebpmux-3.dll",
        "libzvbi-0.dll", "libshaderc_shared.dll",
        "libgomp-1.dll", "libssh.dll"
    )
    foreach ($d in $knownDlls) {
        $dllNames.Add($d)
    }
}

Write-Host "    Identified $($dllNames.Count) DLL dependencies" -ForegroundColor Yellow

# ── Copy each DLL ────────────────────────────────────────────────────────────
$totalSize = 0
$copiedCount = 0

foreach ($dllName in $dllNames) {
    $srcPath = Join-Path $UCRT64_BIN $dllName
    if (Test-Path $srcPath) {
        Copy-Item $srcPath (Join-Path $OutputDir $dllName)
        $sz = (Get-Item $srcPath).Length
        $totalSize += $sz
        $copiedCount++
        $mbSize = [math]::Round($sz / 1MB, 1)
        Write-Host "    + $dllName ($mbSize MB)"
    } else {
        Write-Host "    - $dllName (not found, skipping)" -ForegroundColor DarkGray
    }
}

$binarySize = (Get-Item (Join-Path $OutputDir "vcollab-web-rdp.exe")).Length
$totalSize += $binarySize

Write-Host ""
Write-Host "==> Bundle complete!" -ForegroundColor Green
Write-Host "    Location:   $OutputDir\" -ForegroundColor White
Write-Host "    Binary:     $([math]::Round($binarySize / 1MB, 1)) MB" -ForegroundColor White
Write-Host "    DLLs:       $copiedCount files" -ForegroundColor White
Write-Host "    Total size: $([math]::Round($totalSize / 1MB, 1)) MB" -ForegroundColor White
Write-Host ""
Write-Host "    To run:" -ForegroundColor Gray
Write-Host "    cd $OutputDir" -ForegroundColor Gray
Write-Host "    .\vcollab-web-rdp.exe --listen :8080" -ForegroundColor Gray
