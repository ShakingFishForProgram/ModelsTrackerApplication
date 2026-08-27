$ErrorActionPreference = "Stop"

$projectDir = "C:\Users\BS-ASUA\model-tracker"
$gradle = "C:\Users\BS-ASUA\AppData\Local\Temp\opencode\gradle-dist\gradle-8.2.1\bin\gradle.bat"

$env:JAVA_HOME = "C:\Program Files\Java\jdk-21"
$env:GRADLE_USER_HOME = Join-Path $projectDir ".gradle-home"
$env:ANDROID_HOME = "C:\Users\BS-ASUA\AppData\Local\Android\Sdk"

Write-Host "==> Gradle: $gradle"
Write-Host "==> JAVA_HOME: $($env:JAVA_HOME)"
Write-Host "==> ANDROID_HOME: $($env:ANDROID_HOME)"

Push-Location (Join-Path $projectDir "android")
try {
    & $gradle --stacktrace --no-daemon assembleDebug
    $code = $LASTEXITCODE
    Write-Host ""
    if ($code -eq 0) {
        Write-Host "BUILD SUCCESS"
        $apk = Join-Path $projectDir "android\app\build\outputs\apk\debug\app-debug.apk"
        if (Test-Path $apk) {
            Write-Host "APK 位置: $apk"
            Write-Host "大小: $((Get-Item $apk).Length) bytes"
        }
    } else {
        Write-Host "BUILD FAILED (exit $code)"
    }
    exit $code
} finally {
    Pop-Location
}
