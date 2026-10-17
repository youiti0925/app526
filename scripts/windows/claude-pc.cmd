@echo off
rem Start a Claude Code session on this PC that you can use from the Claude app on your phone.
rem Keep this window open while you use it. Close it to stop.
cd /d "%~dp0..\.."
git pull --ff-only
claude remote-control --name "app526 PC" --permission-mode default
pause
