@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-ct2-server.ps1" %*
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (
  echo.
  echo Installation failed with exit code %RESULT%. Review the messages above.
)
echo.
pause
exit /b %RESULT%
