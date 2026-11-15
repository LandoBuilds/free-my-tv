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
import socket
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOME = os.path.expanduser('~')
BULBS = os.path.join(HOME, '.wiz', 'bulbs.txt')
TOKEN_FILE = os.path.join(HOME, '.wiz', 'token')
PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'remote', 'index.html')
PORT = int(os.environ.get('WIZ_PORT', '8787'))
TV = os.environ.get('WIZ_TV', '')
WISH = {'at': 0}

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
        self._json(404, {})


def install_login(tv):
    plist = os.path.join(HOME, 'Library', 'LaunchAgents', 'io.freemytv.wizbridge.plist')
    os.makedirs(os.path.dirname(plist), exist_ok=True)
    script = os.path.abspath(__file__)
    env = ''
    if tv:
        env += '    <key>WIZ_TV</key><string>%s</string>\n' % tv
    # The token stays in ~/.wiz/token. It is not copied into this file.
    body = '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>io.freemytv.wizbridge</string>
  <key>ProgramArguments</key>
  <array><string>/usr/bin/python3</string><string>%s</string></array>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
%s  </dict>
</dict></plist>
''' % (script, env)
    with open(plist, 'w', encoding='utf-8') as f:
        f.write(body)
    print('Wrote %s' % plist)
    print('Then: launchctl load -w ~/Library/LaunchAgents/io.freemytv.wizbridge.plist')


def main():
    global TV, PORT
    args = sys.argv[1:]
    if '--tv' in args:
        TV = args[args.index('--tv') + 1]
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
