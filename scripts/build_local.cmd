@echo off
setlocal
cd /d "%~dp0\.."
if not exist ".venv\Scripts\python.exe" (
  echo Python environment missing. Run: py -3.14 -m venv .venv
  exit /b 1
)
".venv\Scripts\python.exe" scripts\build_local.py %*
exit /b %errorlevel%
