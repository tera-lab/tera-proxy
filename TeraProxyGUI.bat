@echo off
title TERA Proxy
cd /d "%~dp0"

START .\node_modules\electron\dist\electron --high-dpi-support=1 --force-device-scale-factor=1 --js-flags="--use-strict" ./bin/index.js
EXIT
