$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskStage=Join-Path ([System.IO.Path]::GetTempPath()) ('spectra-ocr-'+[guid]::NewGuid())
New-Item -ItemType Directory -Path "$taskStage/scripts","$taskStage/public/hp-reader","$taskStage/runtime" | Out-Null
Copy-Item -LiteralPath "$PSScriptRoot/ocr-observer.cjs","$PSScriptRoot/start-ocr-observer.cmd" -Destination "$taskStage/scripts"
foreach($name in @('dual.html','dual.mjs','logic.mjs','style.css','dashboard.css','desktop.css','desktop.mjs','preview-roster.json','OBSERVER-SETUP.txt')){
  Copy-Item -LiteralPath "$taskRoot/public/hp-reader/$name" -Destination "$taskStage/public/hp-reader"
}
Copy-Item -LiteralPath (Get-Command node -CommandType Application).Source -Destination "$taskStage/runtime/node.exe"
$taskOutput=Join-Path $taskRoot 'public/hp-reader/downloads'
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
$taskZip=Join-Path $taskOutput ('Spectra-OCR-Observer-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.zip')
Compress-Archive -Path "$taskStage/*" -DestinationPath $taskZip
Write-Output "Observer download: $taskZip"
Write-Output "Packaging staging files retained at: $taskStage"
