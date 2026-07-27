@echo off
setlocal
title Atlas - Stop
echo Stopping Atlas servers...

rem Close the two server console windows started by start.bat (by their titles).
taskkill /FI "WINDOWTITLE eq Atlas Backend*" /T /F >nul 2>nul
taskkill /FI "WINDOWTITLE eq Atlas Frontend*" /T /F >nul 2>nul

rem Free the ports in case any node process is still holding them.
for %%P in (5173 5174) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr ":%%P" ^| findstr LISTENING') do (
    taskkill /PID %%I /F >nul 2>nul
  )
)

echo Done. Atlas servers have been stopped.
timeout /t 2 /nobreak >nul
exit /b 0
