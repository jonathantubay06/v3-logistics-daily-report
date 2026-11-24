@echo off
echo Starting local report worker (V3 BOL daily report)...
echo Keep this window open while you use the local fallback.
echo Once it says "v3-bol worker listening on :3002", go back to the
echo report site and paste http://localhost:3002 into the "Worker URL" field.
echo.
node server.js
pause
