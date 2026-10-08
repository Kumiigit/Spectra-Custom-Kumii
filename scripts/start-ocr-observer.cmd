@echo off
cd /d "%~dp0"
if exist "..\runtime\node.exe" (
  "..\runtime\node.exe" ocr-observer.cjs
) else (
  node ocr-observer.cjs
)
pause
