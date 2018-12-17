@echo off
title valkyr1e's TERA Proxy powered by Caali
cd /d "%~dp0"

.\node_modules\electron\dist\electron --use-strict ./bin/index.js

ECHO(
PAUSE
