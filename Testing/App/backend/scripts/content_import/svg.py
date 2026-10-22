"""Validate a small inert dvisvgm vector subset before offline rasterization."""
from __future__ import annotations

import math
import base64
import hashlib
import struct
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass

SVG = 'http://www.w3.org/2000/svg'
XLINK = 'http://www.w3.org/1999/xlink'
MAX_SOURCE_BYTES = 2 * 1024 * 1024
MAX_ELEMENTS = 20000
MAX_EXPANDED_COST = 200000
NUMBER = r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?'
NUMBER_RE = re.compile(NUMBER)
ATTRS = {
    'svg': {'version', 'width', 'height', 'viewBox'}, 'defs': set(),
    'g': {'id', 'transform', 'fill'},
    'path': {'id', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-miterlimit'},
    'rect': {'x', 'y', 'width', 'height', 'fill'},
    'use': {'x', 'y', '{' + XLINK + '}href'},
}


@dataclass(frozen=True)
class ValidatedSvg:
    data: bytes
    width_css_px: float
    height_css_px: float
    expanded_cost: int


def numbers(value):
    tokens = NUMBER_RE.findall(value)
    if not tokens or NUMBER_RE.sub('', value).strip(' ,\t\r\n'):
        raise ValueError('Invalid SVG numeric grammar')
    result = [float(token) for token in tokens]
    if any(not math.isfinite(n) or abs(n) > 1000000 for n in result):
        raise ValueError('SVG coordinate budget')
    return result


def dimension(value):
    match = re.fullmatch('(' + NUMBER + r')(pt|px)?', value)
    if not match:
        raise ValueError('Only intrinsic pt/px SVG dimensions are supported')
    n = numbers(match.group(1))[0] * (4 / 3 if match.group(2) == 'pt' else 1)
    if not 0 < n <= 8192:
        raise ValueError('SVG dimension budget')
    return n


def path_cost(value, *, bankzadach=False):
    if bankzadach and not value.strip():
        return 1
    if len(value) > 512000:
        raise ValueError('SVG path byte budget')
    token_pattern = re.compile(NUMBER + r'|[MmLlHhVvCcSsQqTtAaZz]')
    tokens = token_pattern.findall(value)
    if not tokens or token_pattern.sub('', value).strip(' ,\t\r\n'):
        raise ValueError('Unsupported SVG path grammar')
    if tokens[0] not in {'M', 'm'}:
        raise ValueError('SVG path must start with move')
    arity = {'M': 2, 'L': 2, 'H': 1, 'V': 1, 'C': 6, 'S': 4, 'Q': 4, 'T': 2, 'A': 7, 'Z': 0}
    index, cost = 0, 1
    while index < len(tokens):
        command = tokens[index]
        if command.upper() not in arity:
            raise ValueError('Missing SVG path command')
        index += 1
        start = index
        while index < len(tokens) and tokens[index].upper() not in arity:
            index += 1
        numeric_tokens = tokens[start:index]
        values = [float(token) for token in numeric_tokens]
        count = arity[command.upper()]
        if (count == 0 and values) or (count and (not values or len(values) % count)):
            raise ValueError('Incomplete SVG path command')
        if any(not math.isfinite(n) or abs(n) > (10000000 if bankzadach else 1000000) for n in values):
            raise ValueError('SVG path coordinate budget')
        if command.upper() == 'A':
            for n in range(0, len(values), 7):
                if min(values[n:n+2]) < 0 or numeric_tokens[n+3] not in {'0', '1'} or numeric_tokens[n+4] not in {'0', '1'}:
                    raise ValueError('Invalid SVG arc')
        cost += len(values)
    return cost


def validate_svg(data: bytes, *, bankzadach=False) -> ValidatedSvg:
    if len(data) > MAX_SOURCE_BYTES:
        raise ValueError('SVG source byte budget')
    text = data.decode('utf-8', errors='strict')
    if any(ord(c) < 32 and c not in '\t\n\r' for c in text):
        raise ValueError('XML control character or encoded-source ambiguity')
    lowered = text.lower()
    if '<!doctype' in lowered or '<!entity' in lowered:
        raise ValueError('SVG entity declaration')
    without_declaration = re.sub(r'^\s*<\?xml\s+version=[\"\']1\.0[\"\'](?:\s+encoding=[\"\']UTF-8[\"\'])?(?:\s+standalone=[\"\'](?:yes|no)[\"\'])?\s*\?>', '', text, count=1, flags=re.IGNORECASE)
    if '<?' in without_declaration:
        raise ValueError('SVG processing instruction')
    root = ET.fromstring(text)
    if root.tag != '{' + SVG + '}svg':
        raise ValueError('SVG root namespace required')
    if bankzadach:
        # Drop only known editor metadata; rendered SVG geometry is untouched.
        editor = 'http://www.inkscape.org/namespaces/inkscape'
        sodipodi = 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd'
        for attribute in ['{' + editor + '}version', '{' + sodipodi + '}docname']:
            root.attrib.pop(attribute, None)
        for node in root.iter():
            if node.tag == '{' + SVG + '}path':
                node.attrib.pop('{' + sodipodi + '}nodetypes', None)
            style = node.attrib.pop('style', None)
            if style is not None:
                if len(style) > 512:
                    raise ValueError('SVG literal style budget')
                seen = set()
                for declaration in style.split(';'):
                    if not declaration.strip():continue
                    if declaration.count(':') != 1:
                        raise ValueError('Unsupported SVG literal style')
                    property_name, value = [part.strip() for part in declaration.split(':')]
                    if property_name not in {'fill', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray'} or property_name in seen:
                        raise ValueError('Unsupported SVG literal style')
                    seen.add(property_name)
                    # Inline style takes precedence over presentation attributes in SVG.
                    node.set(property_name, value)
        for child in list(root):
            if child.tag == '{' + sodipodi + '}namedview':
                if len(child) or (child.text or '').strip() or (child.tail or '').strip():
                    raise ValueError('Nonempty SVG editor metadata')
                root.remove(child)
    elements = list(root.iter())
    if len(elements) > MAX_ELEMENTS:
        raise ValueError('SVG element budget')
    allowed_attrs = {tag: set(attrs) for tag, attrs in ATTRS.items()}
    if bankzadach:
        # Inert vector exports: preserve clipping and stroke geometry. No CSS,
        # arbitrary embedded images, text/font loading, external references or execution.
        allowed_attrs['clipPath'] = {'id'}
        allowed_attrs['svg'].update({'baseProfile', 'id'})
        allowed_attrs['defs'].add('id')
        allowed_attrs['use'].add('id')
        allowed_attrs['circle'] = {'cx', 'cy', 'r'}
        allowed_attrs['line'] = {'x1', 'y1', 'x2', 'y2'}
        allowed_attrs['polygon'] = {'points'}
        allowed_attrs['text'] = {'id', 'x', 'y', 'fill', 'font-family', 'font-size', 'font-style', 'text-anchor', 'transform', 'stroke-width'}
        allowed_attrs['mask'] = {'id'}
        allowed_attrs['image'] = {'id', 'width', 'height', '{' + XLINK + '}href'}
        for tag in ('g', 'path', 'rect', 'use', 'line', 'polygon', 'circle'):
            allowed_attrs[tag].update({'id', 'transform', 'clip-path', 'mask', 'fill', 'stroke',
                'stroke-width', 'stroke-miterlimit', 'stroke-linecap',
                'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
                'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'stroke-opacity'})
        allowed_attrs['use'].add('data-text')
    ids, own_cost = {}, {}
    for node in elements:
        if not isinstance(node.tag, str) or not node.tag.startswith('{' + SVG + '}'):
            raise ValueError('Foreign SVG namespace')
        tag = node.tag[len(SVG) + 2:]
        if tag not in allowed_attrs or set(node.attrib) - allowed_attrs[tag]:
            raise ValueError('Unsupported SVG element or attribute')
        if bankzadach and tag == 'text':
            if len(node) or not re.fullmatch(r"[A-Za-zА-Яа-яЁё0-9 .,()'<>+=−-]{1,128}", node.text or '') or node.get('font-family', '').strip("'") not in {'DejaVu Serif', 'Times New Roman'}:
                raise ValueError('Unapproved SVG literal label')
        elif (node.text or '').strip():
            raise ValueError('SVG text is outside the approved vector subset')
        if (node.tail or '').strip():
            raise ValueError('SVG text is outside the approved vector subset')
        if tag == 'svg' and node is not root:
            raise ValueError('Nested SVG not supported')
        if bankzadach and tag == 'image':
            # Exact observed inert PNGs only; image dimensions and byte hashes are bound.
            href = node.get('{' + XLINK + '}href', '')
            if not href.startswith('data:image/png;base64,') or len(href) > 32768:
                raise ValueError('Unapproved SVG embedded image')
            try:
                embedded = base64.b64decode(re.sub(r'\s', '', href.split(',', 1)[1]), validate=True)
            except ValueError:
                raise ValueError('Invalid SVG embedded image') from None
            approved = {
                '293f3c65c3882582d1745d1e7d7582e430a36e5beae89b98bab0b08725c79181': (1, 1),
                '4d9bb2a77d6747d7462aead8f026409a65da78e125e90bb5cba3c4474587992f': (1742, 236),
                'f33a6888b3fb748020043bb3a60502099297f0f253abd26d80be8dfda4046a19': (1742, 236),
            }
            size = approved.get(hashlib.sha256(embedded).hexdigest())
            if size is None or len(embedded)<24 or embedded[:8] != b'\x89PNG\r\n\x1a\n' or embedded[12:16] != b'IHDR' or struct.unpack('>II', embedded[16:24]) != size or (node.get('width'), node.get('height')) != tuple(map(str, size)):
                raise ValueError('Unapproved SVG embedded image')
        if bankzadach and tag == 'mask':
            valid = len(node) == 1 and node[0].tag == '{' + SVG + '}image'
            if len(node) == 1 and node[0].tag == '{' + SVG + '}g':
                valid = set(node[0].attrib) <= {'transform'} and len(node[0]) == 1 and node[0][0].tag == '{' + SVG + '}image'
            if not valid:
                raise ValueError('Unapproved SVG mask shape')
        identity = node.get('id')
        if identity:
            if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,63}', identity) or identity in ids:
                raise ValueError('Invalid or duplicate SVG identity')
            ids[identity] = node
        cost = 1
        for key, value in node.attrib.items():
            if key != 'd' and not (bankzadach and tag == 'image' and key == '{' + XLINK + '}href') and len(value) > 4096:
                raise ValueError('SVG attribute byte budget')
            if key in {'width', 'height'} and tag != 'svg':
                if len(numbers(value)) != 1 or numbers(value)[0] < 0:
                    raise ValueError('Invalid SVG vector dimension')
                continue
            if key in {'id', 'version', 'width', 'height', 'viewBox', '{' + XLINK + '}href'}:
                continue
            if bankzadach and key in {'baseProfile', 'font-family', 'font-style', 'text-anchor'}:
                choices = {'baseProfile': {'full'}, 'font-family': {'DejaVu Serif', 'Times New Roman', "'Times New Roman'"},
                    'font-style': {'normal', 'italic'}, 'text-anchor': {'start', 'middle', 'end'}}
                if value not in choices[key]:
                    raise ValueError('Unapproved SVG label attribute')
                continue
            if bankzadach and key == 'font-size':
                vals = numbers(value[:-2] if value.endswith('px') else value)
                if len(vals) != 1 or not 1 <= vals[0] <= 32:
                    raise ValueError('SVG label size budget')
                continue
            if bankzadach and key == 'points':
                vals = numbers(value)
                if len(vals) < 6 or len(vals) > 2048 or len(vals) % 2:
                    raise ValueError('SVG polygon budget')
                cost += len(vals)
                continue
            if bankzadach and key == 'data-text':
                if len(value) > 64:
                    raise ValueError('SVG glyph label budget')
                continue
            if bankzadach and key in {'clip-path', 'mask'}:
                if not re.fullmatch(r'url\(#[A-Za-z][A-Za-z0-9_-]{0,63}\)', value):
                    raise ValueError('SVG clip must be local')
                continue
            if bankzadach and key in {'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule'}:
                choices = {'stroke-linecap': {'butt', 'round', 'square'},
                    'stroke-linejoin': {'miter', 'round', 'bevel'},
                    'fill-rule': {'nonzero', 'evenodd'}, 'clip-rule': {'nonzero', 'evenodd'}}
                if value not in choices[key]:
                    raise ValueError('Unsupported SVG stroke/fill rule')
                continue
            if bankzadach and key in {'opacity', 'fill-opacity', 'stroke-opacity'}:
                vals = numbers(value)
                if len(vals) != 1 or not 0 <= vals[0] <= 1:
                    raise ValueError('SVG opacity range')
                continue
            if bankzadach and key == 'stroke-dasharray':
                if value == 'none':continue
                vals = numbers(value)
                if len(vals) > 64 or min(vals) < 0 or not any(vals):
                    raise ValueError('SVG dash budget')
                continue
            if key in {'fill', 'stroke'}:
                if bankzadach and re.fullmatch(r'rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)', value):
                    if any(c > 255 for c in numbers(value[4:-1])):
                        raise ValueError('SVG color range')
                    continue
                if bankzadach and value in {'black', 'white'}:
                    continue
                if bankzadach and re.fullmatch(r'rgb\(\s*(?:'+NUMBER+r'%\s*,\s*){2}'+NUMBER+r'%\s*\)', value):
                    channels = numbers(value[4:-1].replace('%', ''))
                    if any(not 0 <= c <= 100 for c in channels):
                        raise ValueError('SVG color range')
                    continue
                if not re.fullmatch(r'none|#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?', value):
                    raise ValueError('SVG paint must be a literal color')
            elif key == 'd':
                cost += path_cost(value, bankzadach=bankzadach)
            elif key == 'transform':
                rest = value
                for match in re.finditer(r'(matrix|translate|scale|rotate)\(([^()]*)\)', value):
                    vals = numbers(match.group(2))
                    allowed = {'matrix': {6}, 'translate': {1, 2}, 'scale': {1, 2}, 'rotate': {1, 3}}
                    if len(vals) not in allowed[match.group(1)]:
                        raise ValueError('Invalid SVG transform')
                    rest = rest.replace(match.group(0), '', 1)
                if rest.strip():
                    raise ValueError('Unsupported SVG transform')
            else:
                if len(numbers(value)) != 1:
                    raise ValueError('Invalid SVG scalar')
        own_cost[id(node)] = cost
    width, height = dimension(root.get('width', '')), dimension(root.get('height', ''))
    viewbox = numbers(root.get('viewBox', ''))
    if len(viewbox) != 4 or viewbox[2] <= 0 or viewbox[3] <= 0 or width * height > 20000000:
        raise ValueError('Invalid SVG viewBox or pixel budget')
    memo = {}

    def expanded(node, active):
        key = id(node)
        if key in active or len(active) >= 32:
            raise ValueError('Cyclic or deep SVG local reference')
        if key in memo:
            cost, depth = memo[key]
            if len(active) + depth > 32:
                raise ValueError('Deep SVG local reference')
            return cost, depth
        cost, depth = own_cost[key], 1
        for child in node:
            child_cost, child_depth = expanded(child, active | {key})
            cost += child_cost
            depth = max(depth, 1 + child_depth)
        if node.tag == '{' + SVG + '}use':
            href = node.get('{' + XLINK + '}href', '')
            target = ids.get(href[1:]) if href.startswith('#') else None
            if target is None or target.tag not in ({'{' + SVG + '}path', '{' + SVG + '}g'} | ({'{' + SVG + '}use'} if bankzadach else set())):
                raise ValueError('SVG use must reference a local path/group')
            child_cost, child_depth = expanded(target, active | {key})
            cost += child_cost
            depth = max(depth, 1 + child_depth)
        for reference, target_tag in [('clip-path', 'clipPath'), ('mask', 'mask')]:
            if bankzadach and node.get(reference):
                target = ids.get(node.get(reference)[5:-1])
                if target is None or target.tag != '{' + SVG + '}' + target_tag:
                    raise ValueError('SVG effect must reference its local definition')
                child_cost, child_depth = expanded(target, active | {key})
                cost += child_cost
                depth = max(depth, 1 + child_depth)
        if cost > (500000 if bankzadach else MAX_EXPANDED_COST):
            raise ValueError('SVG expanded path budget')
        if len(active) + depth > 32:
            raise ValueError('Deep SVG local reference')
        memo[key] = (cost, depth)
        return cost, depth

    cost, _ = expanded(root, set())
    ET.register_namespace('', SVG)
    ET.register_namespace('xlink', XLINK)
    return ValidatedSvg(ET.tostring(root, encoding='utf-8', xml_declaration=True), width, height, cost)
