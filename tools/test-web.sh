#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node tests/WebPrefsTest.js
node tests/ICloudTest.js
node tests/LiveWeatherTest.js
node tests/GlanceTest.js
