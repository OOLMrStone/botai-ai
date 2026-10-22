#!/usr/bin/env python3
"""Ephemeral loopback review of escaped typed blocks; never render source HTML."""
from __future__ import annotations
import argparse
import html
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
import struct
import urllib.parse


def build_preview(package):
    records = [json.loads(line) for line in (package / 'tasks.jsonl').read_text().splitlines()]
    routes, cards = {}, []
    for record in records:
        assets = {a['id']: a for a in record['assets']}
        for asset in assets.values():
            relative = asset['path']
            path = package / relative
            if path.is_symlink() or not path.resolve().is_relative_to(package.resolve()) or path.stat().st_size > 8 * 1024 * 1024:
                raise ValueError('Invalid private preview asset')
            routes['/' + relative] = ('image/png', path.read_bytes())

        def image(identity, height_em=None):
            asset = assets[identity]
            data = routes['/' + asset['path']][1]
            width, height = struct.unpack('>II', data[16:24])
            style = 'max-width:100%;height:auto;vertical-align:middle;'
            if height_em is not None:
                style += f'width:{height_em * width / height:.6f}em;'
            return '<img alt="' + ('Формула' if height_em is not None else 'Рисунок') + '" src="/' + html.escape(asset['path'], quote=True) + '" style="' + style + '">'

        def blocks(content):
            parts = []
            for block in content or []:
                if block['type'] == 'image':
                    parts.append('<div class="figure">' + image(block['assetId']) + '</div>')
                elif block['type'] == 'paragraph':
                    runs = []
                    for run in block['runs']:
                        if run['type'] == 'text':
                            runs.append(html.escape(run['value']))
                        elif run['type'] == 'formula':
                            runs.append(image(run['assetId'], run['heightEm']))
                        else:
                            raise ValueError('Unsupported preview run')
                    parts.append('<p>' + ''.join(runs) + '</p>')
                else:
                    raise ValueError('Unsupported preview block')
            return ''.join(parts)

        cards.append('<article><h1>№' + str(record['examNumber']) + ' · source ID ' + html.escape(record['externalId']) + '</h1>'
                     '<p class="metadata">Кандидат для ручной сверки · ' + html.escape(record['topicIds'][0]) +
                     ' · сложность: редакционная ' + html.escape(record['difficulty']) + '</p><h2>Условие</h2>' + blocks(record['content']) +
                     '<h2>Ответ</h2>' + (blocks(record.get('referenceAnswerContent')) or '<p>' + html.escape(record['referenceAnswer']) + '</p>') +
                     '<h2>Решение</h2>' + blocks(record.get('referenceContent')) + '</article>')
    page = ('<!doctype html><html lang="ru"><meta charset="utf-8"><title>BotAI private pilot review</title>'
            '<style>body{background:white;color:#111;font:24px/1.55 system-ui;margin:24px}article{max-width:960px;margin:0 auto 80px}p{white-space:pre-wrap;margin:1em 0}.metadata{font-size:16px;color:#555}h1{font-size:30px}h2{font-size:26px}.figure{text-align:center}.figure img{max-width:min(100%,540px)}</style>' + ''.join(cards) + '</html>').encode()
    routes['/'] = ('text/html; charset=utf-8', page)
    return routes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--port', type=int, default=18094)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('Invalid loopback port')
    routes = build_preview(args.package)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            target = urllib.parse.urlsplit(self.path)
            result = routes.get(target.path) if not target.query else None
            if result is None:
                self.send_error(404)
                return
            content_type, data = result
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_):
            pass

    print(f'Private typed-block review: http://127.0.0.1:{args.port}', flush=True)
    HTTPServer(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
