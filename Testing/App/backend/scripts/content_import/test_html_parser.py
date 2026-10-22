import unittest
from html_parser import parse_html, plain_projection


def asset(url, purpose):
    return {'id': purpose + '-' + url.rsplit('/', 1)[1], 'widthCssPx': 48, 'heightCssPx': 24}


IMAGE = 'index-' + 'a' * 32 + '.svg'


class HtmlParserTests(unittest.TestCase):
    def test_text_formula_order_is_exact_and_lossy_alt_never_becomes_math(self):
        parser = parse_html(f'<p>До <img class="math" src="{IMAGE}" alt="WRONG FRACTION"/> после.</p>', 42, asset, 'statement')
        runs = parser.blocks[0]['runs']
        self.assertEqual([r['type'] for r in runs], ['text', 'formula', 'text'])
        self.assertEqual(runs[0]['value'], 'До ')
        self.assertEqual(runs[2]['value'], ' после.')
        self.assertNotIn('alt', runs[1])
        self.assertEqual(plain_projection(parser.blocks), 'До \ufffc после.')

    def test_display_math_and_figure_keep_their_separate_order(self):
        parser = parse_html(f'<p>Первый.</p><div class="math-display"><img class="math-display" src="{IMAGE}"/></div>'
                            f'<div class="center"><p><img src="{IMAGE}"/></p></div><p>Последний.</p>', 42, asset, 'reference')
        self.assertEqual([b['type'] for b in parser.blocks], ['paragraph', 'paragraph', 'image', 'paragraph'])
        self.assertEqual(parser.formula_count, 1)
        self.assertEqual(parser.figure_count, 1)
        self.assertTrue(all(identity.startswith('reference-') for identity in parser.asset_ids))

    def test_unknown_markup_script_cross_session_and_attribute_fail_closed(self):
        for html in ['<script>bad()</script>', '<p onclick="bad()">x</p>', '<table><tr><td>x</td></tr></table>',
                     f'<p><img src="/api/latex-service/v1/GetSession/99/{IMAGE}"/></p>',
                     '<p>unfinished', '<p class="unknown">x</p>']:
            with self.subTest(html=html), self.assertRaises(ValueError):
                parse_html(html, 42, asset, 'statement')

    def test_answer_text_decimal_comma_is_preserved(self):
        parser = parse_html('<p>Ответ: 0,3</p>', 42, asset, 'reference')
        self.assertEqual(plain_projection(parser.blocks), 'Ответ: 0,3')

    def test_nested_div_text_boundaries_are_preserved(self):
        parser = parse_html('<div>a<div>b</div>c</div>', 42, asset, 'statement')
        self.assertEqual(plain_projection(parser.blocks), 'a\nb\nc')


if __name__ == '__main__':
    unittest.main()
