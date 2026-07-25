@echo off
setlocal
cd /d "%~dp0"
call "%~dp0start_job_seeker_auto.bat"
exit /b %ERRORLEVEL%
