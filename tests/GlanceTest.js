/*
 * Ambient windows and iCalendar events. Run by tools/test-web.sh.
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var sandbox = {window: {}, Math: Math, Date: Date, Array: Array, localStorage: {getItem: function () { return null; }, setItem: function () {}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'glance.js'), 'utf8'), sandbox, {filename: 'web/glance.js'});
var G = sandbox.Glance;

var failures = 0;
function expect(actual, want, label) {
  if (actual === want) return;
  failures++;
  console.error('FAIL ' + label + ': got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(want));
}

var windows = {morning: 6, day: 11, evening: 17, night: 22};
expect(G.phase(8, windows), 'morning', 'morning');
expect(G.phase(14, windows), 'day', 'afternoon');
expect(G.phase(18, windows), 'evening', 'evening');
expect(G.phase(23, windows), 'night', 'late');
expect(G.phase(2, windows), 'night', 'after midnight');

var ics = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Dinner\\, home\nDTSTART:20261115T190000\nDTEND:20261115T203000\nEND:VEVENT\nEND:VCALENDAR\n';
var events = G.parseIcs(ics);
expect(events.length, 1, 'one event');
expect(events[0].title, 'Dinner, home', 'summary');
var at = new Date(2026, 10, 15, 18, 0).getTime();
var next = G.nextEvent(events, at);
expect(!!next && next.title, 'Dinner, home', 'the dinner is still ahead');
expect(G.nextEvent(events, new Date(2026, 10, 15, 21, 0).getTime()), null, 'after it ended');

if (failures) {
  console.error(failures + ' failed');
  process.exit(1);
}
console.log('GlanceTest: all checks passed.');
