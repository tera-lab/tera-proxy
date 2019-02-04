@echo off
title valkyr1e's TERA Proxy powered by Caali
cd /d "%~dp0"

.\node_modules\electron\dist\electron --high-dpi-support=1 --force-device-scale-factor=1 --js-flags="--use-strict" ./bin/index-gui.js

ECHO(
PAUSE
