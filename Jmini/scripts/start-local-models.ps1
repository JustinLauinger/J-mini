$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$llama = Join-Path $projectRoot "llama.cpp\build\bin\Release\llama-server.exe"
$textModel = Join-Path $projectRoot "models\gemma-3-4b-it-Q4_K_M.gguf"
$visionModel = Join-Path $projectRoot "models\gemma-3-4b-it-Q4_K_M.gguf"
$mmproj = Join-Path $projectRoot "models\mmproj-model-f16.gguf"
$logDirectory = Join-Path $projectRoot ".logs"

foreach ($path in @($llama, $textModel, $visionModel, $mmproj)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required file was not found: $path"
    }
}

New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

function Start-ModelServer {
    param(
        [string]$Name,
        [string]$Model,
        [int]$Port,
        [switch]$Vision
    )

    $arguments = @(
        "-m", $Model,
        "--host", "127.0.0.1",
        "--port", $Port,
        "--log-file", (Join-Path $logDirectory "$Name.log")
    )
    if ($Vision) {
        $arguments += @("--mmproj", $mmproj)
    }

    Start-Process -FilePath $llama -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
}

$textServer = $null
$visionServer = $null
try {
    $textServer = Start-ModelServer -Name "text" -Model $textModel -Port 8080
    $visionServer = Start-ModelServer -Name "vision" -Model $visionModel -Port 8082 -Vision

    Write-Host "Jmini local model servers are running." -ForegroundColor Green
    Write-Host "Text:   http://127.0.0.1:8080"
    Write-Host "Vision: http://127.0.0.1:8082"
    Write-Host "Logs:   $logDirectory"
    Write-Host "Press Ctrl+C to stop both servers."

    while ($true) {
        if ($textServer.HasExited -or $visionServer.HasExited) {
            throw "A model server stopped. Check the logs in $logDirectory."
        }
        Start-Sleep -Seconds 2
    }
}
finally {
    foreach ($server in @($textServer, $visionServer)) {
        if ($null -ne $server -and -not $server.HasExited) {
            Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
        }
    }
}
