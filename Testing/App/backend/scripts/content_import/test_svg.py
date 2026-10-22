import unittest
from svg import validate_svg


def document(body, defs=''):
    return ('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            'width="18pt" height="12pt" viewBox="0 0 18 12"><defs>' + defs + '</defs>' + body + '</svg>').encode()


class SvgTests(unittest.TestCase):
    def test_vector_glyph_order_and_intrinsic_dimensions_survive(self):
        result = validate_svg(document('<use x="1" y="2" xlink:href="#glyph"/><rect width="3" height="1"/>',
                                       '<path id="glyph" d="M0 0L1 1Z"/>'))
        self.assertEqual(result.width_css_px, 24)
        self.assertEqual(result.height_css_px, 16)
        self.assertLess(result.data.index(b'<use'), result.data.index(b'<rect'))
        self.assertIn(b'M0 0L1 1Z', result.data)

    def test_external_features_and_ambiguous_namespaces_fail_closed(self):
        for body in ['<script/>', '<foreignObject/>', '<path onload="run()" d="M0 0"/>',
                     '<use xlink:href="https://evil.example/x"/>', '<g fill="url(#x)"/>',
                     '<path xmlns="https://evil.example" d="M0 0"/>', '<text>text</text>']:
            with self.subTest(body=body), self.assertRaises(ValueError):
                validate_svg(document(body))
        with self.assertRaises(ValueError):
            validate_svg(b'<!DOCTYPE svg [<!ENTITY x "boom">]>' + document(''))

    def test_cyclic_and_exponential_local_references_are_bounded(self):
        with self.assertRaises(ValueError):
            validate_svg(document('<use xlink:href="#a"/>', '<g id="a"><use xlink:href="#a"/></g>'))
        defs = '<path id="p" d="M0 0L1 1Z"/>'
        previous = 'p'
        for n in range(20):
            name = f'g{n}'
            defs += f'<g id="{name}"><use xlink:href="#{previous}"/><use xlink:href="#{previous}"/></g>'
            previous = name
        with self.assertRaises(ValueError):
            validate_svg(document(f'<use xlink:href="#{previous}"/>', defs))

    def test_nonfinite_and_expensive_geometry_is_rejected(self):
        for body in ['<path d="M1e999 0"/>', '<g transform="matrix(1,2,3)"/>', '<use xlink:href="#missing"/>']:
            with self.subTest(body=body), self.assertRaises(ValueError):
                validate_svg(document(body))

    def test_encoded_xml_entities_processing_instructions_and_incomplete_paths_rejected(self):
        with self.assertRaises((ValueError, UnicodeDecodeError)):
            validate_svg(('<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE svg [<!ENTITY x "boom">]>' + document('').decode()).encode('utf-16'))
        with self.assertRaises(ValueError):
            validate_svg(b'<?xml-stylesheet href="https://evil.example/x"?>' + document(''))
        for d in ['M0 0 L1', 'M0 0 A1 1 0 3 0 1 2', 'M0 0 A-1 1 0 0 0 1 2']:
            with self.subTest(d=d), self.assertRaises(ValueError):
                validate_svg(document(f'<path d="{d}"/>'))

    def test_memoized_reference_chain_cannot_hide_depth(self):
        defs = '<path id="p" d="M0 0L1 1Z"/>'
        previous = 'p'
        for n in range(35):
            name = f'g{n}'
            defs += f'<g id="{name}"><use xlink:href="#{previous}"/></g>'
            previous = name
        with self.assertRaises(ValueError):
            validate_svg(document(f'<use xlink:href="#{previous}"/>', defs))

    def test_bomless_utf16_and_nonliteral_arc_flags_are_rejected(self):
        source = '<!DOCTYPE svg [<!ENTITY x "boom">]>' + document('').decode()
        for encoding in ['utf-16le', 'utf-16be']:
            with self.subTest(encoding=encoding), self.assertRaises(ValueError):
                validate_svg(source.encode(encoding))
        for flag in ['0.0', '1e0', '+1']:
            with self.subTest(flag=flag), self.assertRaises(ValueError):
                validate_svg(document(f'<path d="M0 0A1 1 0 {flag} 0 1 2"/>'))


if __name__ == '__main__':
    unittest.main()
