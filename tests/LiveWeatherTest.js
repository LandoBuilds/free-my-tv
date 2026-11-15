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
expect(W.kind(null, 'auto'), 'cloudy', 'no code yet stays gray');
expect(W.kind(undefined, 'auto'), 'cloudy', 'a failed fetch is not sun');

expect(W.night(true, 'auto'), false, 'day');
expect(W.night(false, 'auto'), true, 'night');
expect(W.night(true, 'night'), true, 'forced night');
expect(W.night(false, 'clear'), false, 'forced day');

expect(W.rate(0, true) > 0, true, 'a rainy code with no amount still falls');
expect(W.beadCount(0), 0, 'dry glass has no drops');
expect(W.beadCount(0.35) > 0 && W.beadCount(0.35) < W.beadCount(1), true, 'heavier rain means more beads');
expect(W.rate(0, false), 0, 'nothing to draw');
expect(W.rate(0.2, true) < W.rate(2, true), true, 'heavier rain is stronger');
expect(W.rate(8, true), 1, 'a downpour is full');
expect(W.rate(null, false), 0, 'no measurement and no code');
expect(W.dbzFromPixel(93, 0, 0, 255), 54, 'universal blue 54 dBZ');
expect(W.dbzFromPixel(0, 0, 0, 0), 0, 'a clear pixel is no rain');
function sky(extra) {
  var o = {modelCode: 45, minuteMm: 0, obs: null, alert: ''};
  for (var k in extra) if (extra.hasOwnProperty(k)) o[k] = extra[k];
  return W.chooseSky(o);
}
expect(sky({radarDbz: 54}).code, 65, 'radar rain replaces fog');
expect(sky({radarDbz: 54}).source, 'radar', 'radar is the source');
expect(sky({radarDbz: 30}).code, 61, 'lighter radar is light rain');
expect(sky({radarDbz: 40}).code, 63, 'moderate radar');
expect(sky({modelCode: 95, radarDbz: 50}).code, 95, 'high dBZ with a storm forecast is thunder');
expect(sky({modelCode: 71, radarDbz: 40}).code, 73, 'radar over a snow code stays snow');
expect(sky({radarDbz: null, minuteMm: 1.5}).source, 'minutely', '15-minute rain when radar is missing');
expect(sky({radarDbz: null, minuteMm: 1.5}).code, 63, 'that amount is moderate');
expect(sky({radarDbz: 0, minuteMm: 0, obs: {ageMin: 10, text: 'Cloudy', weather: '', visibilityM: 16000}}).code, 3, 'a fresh cloudy observation');
expect(sky({radarDbz: 0, minuteMm: 0, obs: {ageMin: 10, text: 'Cloudy', weather: '', visibilityM: 16000}}).source, 'obs', 'the station wins over the model');
expect(sky({radarDbz: 0, minuteMm: 0, obs: {ageMin: 70, text: 'Cloudy', weather: '', visibilityM: 16000}}).code, 3, 'a stale observation is not fog');
expect(sky({radarDbz: 0, minuteMm: 0, obs: {ageMin: 10, text: 'Fog', weather: 'fog', visibilityM: 400}}).code, 45, 'fog when visibility is low');
expect(sky({radarDbz: 54, obs: {ageMin: 10, text: 'Fog', weather: 'fog', visibilityM: 200}}).code, 65, 'radar rain is never fog');
expect(sky({alert: 'Severe Thunderstorm Warning', radarDbz: 10}).code, 95, 'a severe storm warning wins');
expect(sky({alert: 'Severe Thunderstorm Warning'}).source, 'alert', 'the warning is the source');
expect(sky({radarDbz: 0, minuteMm: 0, obs: null}).code, 3, 'model fog without low visibility is cloudy');
expect(sky({modelCode: 51, radarDbz: 0, minuteMm: 0, obs: {ageMin: 10, text: 'Fair', weather: '', visibilityM: 16000}}).code, 51, 'a fair station does not erase drizzle');
expect(sky({modelCode: 3, radarDbz: 0, minuteMm: 0, obs: {ageMin: 10, text: 'Sunny', weather: '', visibilityM: 16000}}).code, 3, 'sun from a station does not erase overcast');
expect(sky({modelCode: 0, radarDbz: 0, minuteMm: 0, obs: null}).code, 0, 'a real clear forecast stays clear');
expect(sky({radarDbz: null, minuteMm: 0, obs: null, modelCode: null}).code, 3, 'no forecast is cloudy, not sun');
expect(sky({radarDbz: null, minuteMm: 0, obs: null, modelCode: null}).source, 'none', 'a missing forecast is marked none');
expect(W.moonPhase(Date.UTC(2000, 0, 6, 18, 14)) < 0.01, true, 'the known new moon');
var full = W.moonPhase(Date.UTC(2000, 0, 6, 18, 14) + 29.53058867 * 86400000 * 0.5);
expect(full > 0.49 && full < 0.51, true, 'half a month later is full');

if (failures) {
  console.error(failures + ' failed');
  process.exit(1);
}
console.log('LiveWeatherTest: all checks passed.');
