# Build the WhiteoutFlakes model viewer (github.com/FernandoS27/WhiteoutFlakes), which the Windows
# Host Adapter renders Asset Catalog thumbnails and exports models with (model.render,
# model.export), on its D3D11 backend. It carries one patch, d3d11-warp.patch: WF_D3D11_WARP=1
# creates the D3D11 device on WARP, Windows' software rasterizer, for a GPU whose driver can't run
# the viewer (a Parallels VM's can't; see docs/reference/related-repos.md).
#
#   powershell -ExecutionPolicy Bypass -File packages\plugin-host-windows\scripts\build-whiteoutflakes.ps1 [-Dir <dir>] [-Arch x64|ARM64]
#
# The default folder is %LOCALAPPDATA%\sc2-adjutant\whiteoutflakes, and the default architecture
# the machine's. Needs Git, Visual Studio 2022 (or its Build Tools) with the C++ workload and the
# ARM64 tools for an ARM64 build, CMake, and the LunarG Vulkan SDK 1.4.341.0 with VMA (for slangc;
# the ARM64 build also takes its Vulkan headers). Re-running skips the steps that are already done
# (the full build takes 20 minutes or more). The viewer lands in <dir>\stage-<arch>; point the
# machine config's `modelViewerPath` at <dir>\stage-<arch>\WhiteoutFlakes.exe.
[CmdletBinding()]
param(
  [string]$Dir = (Join-Path $env:LOCALAPPDATA "sc2-adjutant\whiteoutflakes"),
  [ValidateSet("x64", "ARM64")]
  [string]$Arch = $(if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq "Arm64") { "ARM64" } else { "x64" })
)
$ErrorActionPreference = "Stop"

# The pins proven on macOS (scripts in plugin-host-macos) and on Windows 11 ARM64 (2026-11-14).
$WfCommit = "d2756ce"
$VulkanSdkVersion = "1.4.341.0"
$Patch = Join-Path $PSScriptRoot "d3d11-warp.patch"

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program $($Arguments -join ' ') exited $LASTEXITCODE" }
}

# Windows PowerShell turns a native program's redirected stderr into errors, which "Stop" makes fatal.
function Invoke-Quiet([string]$Program, [string[]]$Arguments) {
  $ErrorActionPreference = "Continue"
  & $Program @Arguments 2>&1 | ForEach-Object { "$_" }
}

function Find-Program([string]$Name, [string[]]$Candidates) {
  $onPath = Get-Command $Name -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $found = $Candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $found) { throw "$Name not found on PATH or at $($Candidates -join ', ')" }
  return $found
}

$git = Find-Program "git" @("$env:ProgramFiles\Git\cmd\git.exe")
$cmake = Find-Program "cmake" @("$env:ProgramFiles\CMake\bin\cmake.exe")
if (-not $env:VULKAN_SDK) { $env:VULKAN_SDK = "C:\VulkanSDK\$VulkanSdkVersion" }
if (-not (Test-Path "$env:VULKAN_SDK\Bin\slangc.exe")) { throw "No slangc at $env:VULKAN_SDK\Bin: install the LunarG Vulkan SDK $VulkanSdkVersion (or set VULKAN_SDK)" }
if (-not (Test-Path "$env:VULKAN_SDK\Include\vma\vk_mem_alloc.h")) { throw "No VMA in $env:VULKAN_SDK\Include\vma: install the SDK's VMA component" }
$env:PATH = "$env:VULKAN_SDK\Bin;$env:PATH"

New-Item -ItemType Directory -Force $Dir | Out-Null
$src = Join-Path $Dir "src"
$build = Join-Path $Dir "build-$($Arch.ToLower())"
$stage = Join-Path $Dir "stage-$($Arch.ToLower())"

# Checked out with LF line endings, as upstream commits them, so the patch applies as it is, and
# with long paths, which a submodule's test files need.
$gitConfig = @("-c", "core.autocrlf=false", "-c", "core.longpaths=true")
if (-not (Test-Path $src)) {
  Invoke-Checked $git ($gitConfig + @("clone", "--filter=blob:none", "https://github.com/FernandoS27/WhiteoutFlakes", $src))
  Invoke-Checked $git ($gitConfig + @("-C", $src, "checkout", "-q", $WfCommit))
}
Invoke-Checked $git ($gitConfig + @("-C", $src, "submodule", "update", "--init", "--recursive", "--depth", "1"))
$head = (& $git -C $src rev-parse HEAD).Trim()
$pinned = (& $git -C $src rev-parse "$WfCommit^{commit}").Trim()
if ($head -ne $pinned) { throw "$src is at $head, not ${WfCommit}: remove it and run again" }

# The patch, with its line endings made LF whatever this checkout made them.
$lfPatch = Join-Path $Dir "d3d11-warp.patch"
[System.IO.File]::WriteAllText($lfPatch, ([System.IO.File]::ReadAllText($Patch) -replace "`r`n", "`n"))
Invoke-Quiet $git @("-C", $src, "apply", "--check", "--reverse", $lfPatch) | Out-Null
if ($LASTEXITCODE -ne 0) {
  # A submodule's own contents can read as changed after a shallow recursive checkout
  # (externals/dr_libs, through its nested miniaudio), so only the submodules' commits count.
  $changed = & $git -C $src status --porcelain --ignore-submodules=dirty
  if ($changed) { throw "$src has changes of its own ($($changed -join '; ')): remove it and run again" }
  Invoke-Checked $git @("-C", $src, "apply", $lfPatch)
}

# Flags follow upstream's .github/workflows/windows.yml. The LunarG SDK's Vulkan loader is x64
# only, so an ARM64 build turns the Vulkan backend off, but tools/basic_viewer/app/platform_window.cpp
# includes vulkan/vulkan.h whatever the backends, so the SDK's headers go on the include path.
# Configured again until a configure finishes, which is when it writes the solution.
if (-not (Test-Path (Join-Path $build "WhiteoutFlakes.sln"))) {
  $configure = @(
    "-S", $src, "-B", $build, "-G", "Visual Studio 17 2022", "-A", $Arch,
    "-DWDX_BUILD_WC3_SHADERS=OFF",
    "-DWDX_USE_PREBUILT_SHADERS=ON",
    "-DWDX_BUILD_WC3_DEBUG_SHADERS=OFF",
    "-DWDX_ENABLE_TRACY=OFF",
    "-DWDX_BUILD_MAX_PLUGIN=OFF",
    "-DWDX_ENABLE_WEBGPU=OFF"
  )
  if ($Arch -eq "ARM64") {
    $configure += @("-DCMAKE_DISABLE_FIND_PACKAGE_Vulkan=ON", "-DCMAKE_CXX_FLAGS_INIT=/I`"$env:VULKAN_SDK\Include`"")
  }
  Invoke-Checked $cmake $configure
}
Invoke-Checked $cmake @("--build", $build, "--config", "Release", "--target", "WhiteoutFlakesStandalone", "--parallel")

# Staged as upstream's Package step does: the exe with its shaders, translations, fonts and the
# PSO-trace seed. The viewer writes its pipeline cache and PSO trace beside the exe, so the Host
# Adapter runs copies of this folder, never the folder itself.
$out = Join-Path $build "standalone"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item (Join-Path $out "WhiteoutFlakes.exe") $stage
foreach ($folder in @("shaders", "lang", "fonts")) { Copy-Item (Join-Path $out $folder) (Join-Path $stage $folder) -Recurse }
$seed = Join-Path $src "prebuilt\pso_trace.bin"
if (Test-Path $seed) { Copy-Item $seed $stage }

# The smoke test, on the GPU and then on WARP, in a copy so the stage keeps no caches.
$exe = Join-Path $stage "WhiteoutFlakes.exe"
$check = Join-Path $Dir "check-$($Arch.ToLower())"
if (Test-Path $check) { Remove-Item -Recurse -Force $check }
Copy-Item $stage $check -Recurse
# On this VM's GPU it fails after about a minute; a test that runs on for 5 minutes is stopped.
foreach ($warp in @("", "1")) {
  $env:WF_D3D11_WARP = $warp
  $name = if ($warp) { "WARP" } else { "GPU" }
  $log = Join-Path $Dir "headless-$($name.ToLower()).log"
  $test = Start-Process -FilePath (Join-Path $check "WhiteoutFlakes.exe") -ArgumentList "--backend", "d3d11", "--headless-test" -WorkingDirectory $check -NoNewWindow -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
  if (-not $test.WaitForExit(300000)) { $test.Kill(); $test.WaitForExit() }
  $result = Get-Content $log, "$log.err" | Where-Object { $_ -match '^\[headless\] (PASS|FAIL)' }
  Write-Host "$name ($Arch): $(if ($result) { $result -join ' ' } else { 'no result in 5 minutes' })"
}
Remove-Item Env:WF_D3D11_WARP
Remove-Item -Recurse -Force $check
Write-Host "Built $exe"
