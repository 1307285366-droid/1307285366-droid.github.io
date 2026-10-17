@echo off
rem Start the auto-sync watcher in the background.
rem Double-click this file (or run it) to keep D:\kaohe in sync with this project.
rem Log: %USERPROFILE%\quiz-sync.log
start "quiz-sync" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0watch-sync.ps1"
echo watcher started in background - see %%USERPROFILE%%\quiz-sync.log
