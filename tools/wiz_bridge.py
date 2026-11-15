#!/usr/bin/env python3
"""A small bridge on the Mac for Free My TV.

The TV cannot send UDP, so this speaks WiZ (UDP 38899, setPilot) and, if samsungtvws is
installed, the TV's own remote port (8002). The phone page and the TV talk to it over HTTP.

    python3 tools/wiz_bridge.py
    python3 tools/wiz_bridge.py --install-login --tv 192.168.86.69

Bulbs live in ~/.wiz/bulbs.txt, one "IP MAC" pair per line. A line "group Living" names the
bulbs that follow, until the next group. A token in ~/.wiz/token (or WIZ_TOKEN) is required
from anywhere except this computer. The token is never printed.
"""
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOME = os.path.expanduser('~')
BULBS = os.path.join(HOME, '.wiz', 'bulbs.txt')
TOKEN_FILE = os.path.join(HOME, '.wiz', 'token')
PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'remote', 'index.html')
PORT = int(os.environ.get('WIZ_PORT', '8787'))
TV = os.environ.get('WIZ_TV', '')
TV_MAC = os.environ.get('WIZ_TV_MAC', '')
MAC_FILE = os.path.join(HOME, '.freemytv-bridge', 'tv_mac')
WISH = {'at': 0}
STATUS = {}
STATE_CACHE = {'at': 0.0, 'power': 'off'}

SCENES = {
    'movie': {'state': True, 'dimming': 18, 'temp': 2200},
    'dim': {'state': True, 'dimming': 28, 'temp': 2700},
    'warm': {'state': True, 'dimming': 55, 'temp': 2700},
    'bright': {'state': True, 'dimming': 100, 'temp': 4200},
    'off': {'state': False},
}


def token():
    env = os.environ.get('WIZ_TOKEN', '').strip()
    if env:
        return env
    try:
        with open(TOKEN_FILE, encoding='utf-8') as f:
            return f.read().strip()
    except OSError:
        return ''


def load_bulbs(path):
    groups = {'All': []}
    current = 'All'
    try:
        lines = open(path, encoding='utf-8')
    except OSError:
        return groups
    with lines as f:
        for raw in f:
            line = raw.split('#', 1)[0].strip()
            if not line:
                continue
            if line.lower().startswith('group '):
                current = line.split(None, 1)[1].strip() or 'All'
                groups.setdefault(current, [])
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            bulb = (parts[0], parts[1].replace(':', '').lower())
            if bulb not in groups['All']:
                groups['All'].append(bulb)
            if current != 'All':
                groups.setdefault(current, [])
                if bulb not in groups[current]:
                    groups[current].append(bulb)
    return groups


def pilot(ip, mac, params):
    body = {'method': 'setPilot', 'params': dict(params)}
    if mac:
        body['params']['mac'] = mac
    data = json.dumps(body).encode('utf-8')
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(0.6)
    try:
        sock.sendto(data, (ip, 38899))
        try:
            sock.recvfrom(4096)
        except socket.timeout:
            pass
    finally:
        sock.close()


def send_key(name):
    if not TV:
        return False
    try:
        from samsungtvws import SamsungTVWS
    except ImportError:
        return False
    try:
        SamsungTVWS(TV, port=8002).send_key(name)
        return True
    except Exception:
        return False


def normalize_mac(text):
    compact = re.sub(r'[^0-9a-fA-F]', '', text or '')
    if len(compact) < 12:
        return ''
    pairs = [compact[i:i + 2] for i in range(0, 12, 2)]
    return ':'.join(p.lower() for p in pairs)


def read_mac_file():
    try:
        with open(MAC_FILE, encoding='utf-8') as f:
            return normalize_mac(f.read())
    except OSError:
        return ''


def write_mac(mac):
    mac = normalize_mac(mac)
    if not mac:
        return
    os.makedirs(os.path.dirname(MAC_FILE), exist_ok=True)
    with open(MAC_FILE, 'w', encoding='utf-8') as f:
        f.write(mac + '\n')


def arp_mac(ip):
    if not ip:
        return ''
    try:
        out = subprocess.check_output(['arp', '-n', ip], stderr=subprocess.DEVNULL, text=True, timeout=3)
    except Exception:
        return ''
    match = re.search(r'([0-9a-fA-F]{1,2}[:-]){5}[0-9a-fA-F]{1,2}', out)
    return normalize_mac(match.group(0) if match else '')


def tv_mac(refresh=False):
    if TV_MAC:
        return normalize_mac(TV_MAC)
    cached = read_mac_file()
    if cached and not refresh:
        return cached
    found = arp_mac(TV)
    if found:
        write_mac(found)
        return found
    return cached


def broadcasts(ip):
    found = ['255.255.255.255']
    parts = (ip or '').split('.')
    if len(parts) == 4 and all(p.isdigit() for p in parts):
        found.append('.'.join(parts[:3] + ['255']))
    return found


def wake_on_lan(mac, ip):
    raw = bytes(int(part, 16) for part in mac.split(':'))
    packet = b'\xff' * 6 + raw * 16
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    try:
        for _ in range(5):
            for dest in broadcasts(ip):
                for port in (9, 7):
                    try:
                        sock.sendto(packet, (dest, port))
                    except Exception:
                        pass
            time.sleep(0.15)
    finally:
        sock.close()


def port_open(ip, port, timeout=0.4):
    if not ip:
        return False
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect((ip, port))
        return True
    except Exception:
        return False
    finally:
        sock.close()


def power_state(force=False):
    now = time.time()
    if not force and now - STATE_CACHE['at'] < 2:
        return STATE_CACHE['power']
    on = port_open(TV, 8001)
    power = 'on' if on else 'off'
    STATE_CACHE['at'] = now
    STATE_CACHE['power'] = power
    if on:
        tv_mac(refresh=True)
    return power


def api_answers():
    if not TV:
        return False
    try:
        urllib.request.urlopen('http://%s:8001/api/v2/' % TV, timeout=1.5).close()
        return True
    except urllib.error.HTTPError:
        return True
    except Exception:
        return False


def wait_awake(timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if api_answers():
            STATE_CACHE['at'] = time.time()
            STATE_CACHE['power'] = 'on'
            tv_mac(refresh=True)
            return True
        time.sleep(1)
    STATE_CACHE['at'] = time.time()
    STATE_CACHE['power'] = 'off'
    return False


def power_action(action):
    state = power_state(force=True)
    if action == 'toggle':
        action = 'off' if state == 'on' else 'on'
    if action == 'on':
        mac = tv_mac(refresh=state == 'on')
        if not mac:
            return {'power': state, 'ok': False, 'error': 'no mac'}
        wake_on_lan(mac, TV)
        awake = wait_awake(20)
        return {'power': 'on' if awake else 'off', 'ok': awake}
    if action == 'off':
        ok = send_key('KEY_POWER')
        STATE_CACHE['at'] = time.time()
        STATE_CACHE['power'] = 'off'
        return {'power': 'off', 'ok': ok}
    return {'power': state, 'ok': False, 'error': 'action'}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Status only. The path can carry the token, so it is not written.
        code = args[1] if len(args) > 1 else ''
        sys.stderr.write('wiz-bridge %s\n' % code)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Bridge-Token')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    def _authorized(self):
        expected = token()
        host = self.client_address[0]
        if host in ('127.0.0.1', '::1') and not expected:
            return True
        if not expected:
            return False
        got = self.headers.get('X-Bridge-Token', '')
        if not got:
            got = (parse_qs(urlparse(self.path).query).get('k') or [''])[0]
        return got == expected

    def _json(self, code, obj):
        raw = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self._cors()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _read(self):
        n = int(self.headers.get('Content-Length', '0') or 0)
        if n <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode('utf-8'))
        except Exception:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ('/', '/remote'):
            try:
                with open(PAGE, 'rb') as f:
                    raw = f.read()
            except OSError:
                raw = b'phone page missing'
            self.send_response(200)
            self._cors()
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if not self._authorized():
            self._json(401, {'error': 'token'})
            return
        if path == '/lights':
            groups = load_bulbs(BULBS)
            self._json(200, {'groups': sorted(groups), 'bulbs': len(groups.get('All', []))})
            return
        if path == '/tv/wish':
            self._json(200, WISH)
            return
        if path == '/tv/state':
            self._json(200, {'power': power_state()})
            return
        if path == '/tv/status':
            self._json(200, STATUS or {'at': 0})
            return
        if path == '/health':
            self._json(200, {'ok': True})
            return
        self._json(404, {})

    def do_POST(self):
        path = urlparse(self.path).path
        if not self._authorized():
            self._json(401, {'error': 'token'})
            return
        body = self._read()
        if path == '/lights/scene':
            scene = SCENES.get(body.get('scene') or '')
            if not scene:
                self._json(400, {'error': 'scene'})
                return
            groups = load_bulbs(BULBS)
            name = body.get('group') or 'All'
            bulbs = groups.get(name) or groups.get('All') or []
            for ip, mac in bulbs:
                try:
                    pilot(ip, mac, scene)
                except Exception:
                    pass
            self._json(200, {'ok': True, 'count': len(bulbs)})
            return
        if path == '/tv/wish':
            for key in ('homeShow', 'saver', 'ambient'):
                if key in body:
                    WISH[key] = body[key]
            WISH['at'] = int(time.time() * 1000)
            self._json(200, WISH)
            return
        if path == '/tv/key':
            ok = send_key(str(body.get('key') or ''))
            self._json(200 if ok else 503, {'ok': ok})
            return
        if path == '/tv/power':
            action = body.get('action') or 'toggle'
            if action not in ('on', 'off', 'toggle'):
                self._json(400, {'error': 'action'})
                return
            self._json(200, power_action(action))
            return
        if path == '/tv/status':
            kept = {}
            for key in ('at', 'view', 'ambient', 'saver', 'photo', 'weather', 'app'):
                if key in body:
                    kept[key] = body[key]
            kept['received'] = int(time.time() * 1000)
            STATUS.clear()
            STATUS.update(kept)
            self._json(200, {'ok': True})
            return
        self._json(404, {})


def install_login(tv):
    plist = os.path.join(HOME, 'Library', 'LaunchAgents', 'io.freemytv.wizbridge.plist')
    os.makedirs(os.path.dirname(plist), exist_ok=True)
    script = os.path.abspath(__file__)
    env = ''
    if tv:
        env += '    <key>WIZ_TV</key><string>%s</string>\n' % tv
    extra = ''
    if TV_MAC:
        extra = '<string>--tv-mac</string><string>%s</string>' % TV_MAC
    body = '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>io.freemytv.wizbridge</string>
  <key>ProgramArguments</key>
  <array><string>/usr/bin/python3</string><string>%s</string>%s</array>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
%s  </dict>
</dict></plist>
''' % (script, extra, env)
    with open(plist, 'w', encoding='utf-8') as f:
        f.write(body)
    print('Wrote %s' % plist)
    print('Then: launchctl load -w ~/Library/LaunchAgents/io.freemytv.wizbridge.plist')


def main():
    global TV, PORT, TV_MAC
    args = sys.argv[1:]
    if '--tv' in args:
        TV = args[args.index('--tv') + 1]
    if '--tv-mac' in args:
        TV_MAC = normalize_mac(args[args.index('--tv-mac') + 1])
        if TV_MAC:
            write_mac(TV_MAC)
    if '--port' in args:
        PORT = int(args[args.index('--port') + 1])
    if '--install-login' in args:
        install_login(TV)
        return
    os.makedirs(os.path.dirname(BULBS), exist_ok=True)
    if not os.path.exists(BULBS):
        with open(BULBS, 'w', encoding='utf-8') as f:
            f.write('# group Living\n# 192.168.86.21 aabbccddeeff\n')
    httpd = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print('Free My TV bridge on port %s' % PORT)
    print('Phone: http://<this Mac>:8787/')
    httpd.serve_forever()


if __name__ == '__main__':
    main()
