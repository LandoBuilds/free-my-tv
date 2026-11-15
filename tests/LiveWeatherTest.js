/*
 * Which sky the live weather draws for a forecast code, and how hard the rain falls. Run by tools/test-web.sh.
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var sandbox = {window: {}, Math: Math, Date: Date, Array: Array};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'liveweather.js'), 'utf8'), sandbox, {filename: 'web/liveweather.js'});
var W = sandbox.LiveWeather;

var failures = 0;
function expect(actual, want, label) {
  if (actual === want) return;
  failures++;
  console.error('FAIL ' + label + ': got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(want));
}

expect(W.kind(0, 'auto'), 'clear', 'clear code');
expect(W.kind(1, 'auto'), 'clear', 'mostly clear');
expect(W.kind(3, 'auto'), 'cloudy', 'overcast');
expect(W.kind(45, 'auto'), 'fog', 'fog');
expect(W.kind(48, 'auto'), 'fog', 'rime fog');
expect(W.kind(51, 'auto'), 'rain', 'drizzle');
expect(W.kind(63, 'auto'), 'rain', 'rain');
expect(W.kind(65, 'auto'), 'rain', 'heavy rain');
expect(W.kind(71, 'auto'), 'snow', 'snow');
expect(W.kind(85, 'auto'), 'snow', 'snow showers');
expect(W.kind(95, 'auto'), 'storm', 'thunderstorm');
expect(W.kind(99, 'auto'), 'storm', 'thunderstorm with hail');
expect(W.kind(0, 'rain'), 'rain', 'preview rain');
expect(W.kind(95, 'clear'), 'clear', 'preview wins over the code');
expect(W.kind(2, 'night'), 'clear', 'clear night preview');
expect(W.kind(null, 'auto'), 'clear', 'no code yet');

expect(W.night(true, 'auto'), false, 'day');
expect(W.night(false, 'auto'), true, 'night');
expect(W.night(true, 'night'), true, 'forced night');
expect(W.night(false, 'clear'), false, 'forced day');

expect(W.rate(0, true) > 0, true, 'a rainy code with no amount still falls');
expect(W.rate(0, false), 0, 'nothing to draw');
expect(W.rate(0.2, true) < W.rate(2, true), true, 'heavier rain is stronger');
expect(W.rate(8, true), 1, 'a downpour is full');
expect(W.rate(null, false), 0, 'no measurement and no code');
expect(W.moonPhase(Date.UTC(2000, 0, 6, 18, 14)) < 0.01, true, 'the known new moon');
var full = W.moonPhase(Date.UTC(2000, 0, 6, 18, 14) + 29.53058867 * 86400000 * 0.5);
expect(full > 0.49 && full < 0.51, true, 'half a month later is full');

if (failures) {
  console.error(failures + ' failed');
  process.exit(1);
}
console.log('LiveWeatherTest: all checks passed.');
