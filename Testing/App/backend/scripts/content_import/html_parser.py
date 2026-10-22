"""Inert provider HTML -> ordered typed content; unknown/lossy content fails closed."""
from __future__ import annotations
from html.parser import HTMLParser
import math
import re
import urllib.parse
from transport import validate_provider_url

MAX_HTML_BYTES = 256 * 1024
MAX_PARAGRAPHS = 128
MAX_RUNS = 1024


class SourceHtmlParser(HTMLParser):
    def __init__(self, session_id, asset_resolver, purpose):
        super().__init__(convert_charrefs=True)
        if type(session_id) is not int or session_id <= 0 or purpose not in {'statement', 'reference'}:
            raise ValueError('Invalid source session boundary')
        self.session_id = session_id
        self.asset_resolver = asset_resolver
        self.purpose = purpose
        self.stack = []
        self.blocks = []
        self.runs = []
        self.asset_ids = []
        self.formula_count = self.figure_count = self.run_count = 0

    def flush(self):
        if any(run['type'] != 'text' or run['value'].strip() for run in self.runs):
            self.blocks.append({'type': 'paragraph', 'runs': self.runs})
        self.runs = []
        if len(self.blocks) > MAX_PARAGRAPHS:
            raise ValueError('Source block budget')

    def add_run(self, run):
        self.run_count += 1
        if self.run_count > MAX_RUNS:
            raise ValueError('Source run budget')
        if run['type'] == 'text' and self.runs and self.runs[-1]['type'] == 'text':
            self.runs[-1]['value'] += run['value']
        else:
            self.runs.append(run)

    def handle_starttag(self, tag, attrs):
        if len(dict(attrs)) != len(attrs):
            raise ValueError('Duplicate source HTML attributes')
        attrs = dict(attrs)
        allowed = {'p': {'class'}, 'div': {'class'}, 'img': {'class', 'src', 'alt'},
                   'br': set(), 'strong': set(), 'b': set(), 'em': set(), 'i': set()}
        if tag not in allowed or set(attrs) - allowed[tag]:
            raise ValueError('Unsupported source HTML element/attribute')
        classes = set((attrs.get('class') or '').split())
        if classes - {'noindent', 'indent', 'math', 'math-display', 'center'}:
            raise ValueError('Unsupported source HTML class')
        if tag == 'div':
            self.flush()
        if tag == 'p':
            if 'p' in self.stack:
                raise ValueError('Nested source paragraph')
            self.flush()
        elif tag == 'br':
            self.add_run({'type': 'text', 'value': '\n'})
            return
        elif tag == 'img':
            source = attrs.get('src', '')
            if not source or len(source) > 2048:
                raise ValueError('Missing source image')
            base = f'https://3.shkolkovo.online/api/latex-service/v1/GetSession/{self.session_id}/'
            url = urllib.parse.urljoin(base, source)
            validate_provider_url(url)
            if not url.startswith(base) or not re.search(r'/index-[a-f0-9]{32}\.svg$', url):
                raise ValueError('Image outside its observed source session')
            asset = self.asset_resolver(url, self.purpose)
            self.asset_ids.append(asset['id'])
            if classes & {'math', 'math-display'}:
                self.formula_count += 1
                if self.formula_count > 256:
                    raise ValueError('Source formula budget')
                # The observed provider style uses 24px body and vertical-align:middle.
                # This is an explicit typography normalization, never a TeX reconstruction.
                height_em = asset['heightCssPx'] / 24
                if not math.isfinite(height_em) or not 0 < height_em <= 50:
                    raise ValueError('Formula intrinsic dimension budget')
                self.add_run({'type': 'formula', 'assetId': asset['id'], 'heightEm': height_em})
            else:
                self.figure_count += 1
                if self.figure_count > 16:
                    raise ValueError('Source figure budget')
                self.flush()
                self.blocks.append({'type': 'image', 'assetId': asset['id'],
                                    'alt': 'Рисунок к условию' if self.purpose == 'statement' else 'Рисунок к решению',
                                    'aspectRatio': asset['widthCssPx'] / asset['heightCssPx']})
            return
        self.stack.append(tag)
        if len(self.stack) > 16:
            raise ValueError('Source HTML depth budget')

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in {'img', 'br'}:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag in {'img', 'br'}:
            return
        if not self.stack or self.stack[-1] != tag:
            raise ValueError('Unbalanced source HTML')
        self.stack.pop()
        if tag in {'p', 'div'}:
            self.flush()

    def handle_data(self, data):
        if not data:
            return
        if not self.stack:
            if data.strip():
                raise ValueError('Unstructured source text')
            return
        self.add_run({'type': 'text', 'value': data})

    def handle_decl(self, decl):
        raise ValueError('Source HTML declarations not supported')

    def handle_pi(self, data):
        raise ValueError('Source processing instructions not supported')


def parse_html(html, session_id, asset_resolver, purpose):
    if not isinstance(html, str) or len(html.encode()) > MAX_HTML_BYTES:
        raise ValueError('Source HTML byte budget')
    parser = SourceHtmlParser(session_id, asset_resolver, purpose)
    parser.feed(html)
    parser.close()
    if parser.stack:
        raise ValueError('Incomplete source HTML')
    parser.flush()
    if not parser.blocks:
        raise ValueError('Empty source content')
    return parser


def plain_projection(blocks):
    """Text with explicit object placeholders; never suitable for image-blind AI grading."""
    paragraphs = []
    for block in blocks:
        if block['type'] == 'image':
            paragraphs.append('\ufffc')
        else:
            paragraphs.append(''.join(run['value'] if run['type'] == 'text' else '\ufffc'
                                      for run in block['runs']))
    return '\n'.join(paragraphs)
