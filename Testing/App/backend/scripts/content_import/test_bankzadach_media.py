import unittest,tempfile,hashlib,json,base64
from pathlib import Path
from svg import validate_svg
from bankzadach_media import safe_file,prepare,verify_output,unwrap_png,quality_holds,reviewed_rasters

BASE='<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="80" viewBox="0 0 100 80">{}</svg>'
class BankMediaTest(unittest.TestCase):
    def test_inert_clip_preserved_and_legacy_unchanged(self):
        raw=BASE.format('<defs><clipPath id="clip"><path d="M0 0 L10 0 L10 10 Z"/></clipPath><path id="glyph" d="M1 2 L3 4"/></defs><g clip-path="url(#clip)"><use xlink:href="#glyph" transform="translate(1 1)" data-text="A"/><path d="M0 0 L10 0" stroke="#000" stroke-width="1" stroke-linecap="round"/></g>').encode()
        out=validate_svg(raw,bankzadach=True)
        self.assertIn(b'clip-path="url(#clip)"',out.data)
        with self.assertRaises(ValueError):validate_svg(raw)
    def test_external_and_cyclic_clips(self):
        for body in ['<g clip-path="url(https://bad/x)"></g>', '<defs><clipPath id="a"><g clip-path="url(#a)"/></clipPath></defs>', '<g clip-path="url(#missing)"/>']:
            with self.assertRaises(ValueError):validate_svg(BASE.format(body).encode(),bankzadach=True)
    def test_active_svg_rejected(self):
        for body in ['<script>alert(1)</script>','<image href="file:///etc/passwd"/>','<path d="M0 0" style="fill:url(http://bad)"/>','<foreignObject/>','<text>A</text>','<use xlink:href="https://bad/x"/>']:
            with self.assertRaises(ValueError):prepare(BASE.format(body).encode())
    def test_path_and_symlink(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);(root/'a').write_bytes(b'x');(root/'link').symlink_to(root/'a')
            self.assertEqual(safe_file(root,'a',2),b'x')
            for name in ['../a','/tmp/a','link']:
                with self.assertRaises(ValueError):safe_file(root,name,2)
    def test_forged_renderer_dimensions(self):
        with tempfile.TemporaryDirectory() as t:
            out=Path(t);key='0'*64;(out/(key+'.png')).write_bytes(b'not PNG')
            with self.assertRaises(ValueError):verify_output(out,dict(key=key,status='ok',width=10,height=10,bytes=7))

class BankMaskTest(unittest.TestCase):
    png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAACklEQVR4nGP4DwABAQEAsTj2FAAAAABJRU5ErkJggg=='
    def mask(self, href=None):
        return '<defs><mask id="mask"><image id="pixel" width="1" height="1" xlink:href="'+(href or 'data:image/png;base64,'+self.png)+'"/></mask></defs><rect x="0" y="0" width="1" height="1" mask="url(#mask)"/>'
    def test_exact_mask_survives_and_legacy_rejects(self):
        raw=BASE.format(self.mask()).encode()
        out=validate_svg(raw,bankzadach=True)
        self.assertIn(b'mask="url(#mask)"',out.data)
        self.assertIn(self.png.encode(),out.data)
        with self.assertRaises(ValueError):validate_svg(raw)
    def test_arbitrary_data_and_effect_targets_rejected(self):
        for uri in ['https://bad/image.png','file:///tmp/image.png','data:image/svg+xml;base64,'+self.png,'data:image/png;base64,'+self.png[:-3]+'AAA']:
            with self.assertRaises(ValueError):validate_svg(BASE.format(self.mask(uri)).encode(),bankzadach=True)
        for body in [self.mask().replace('url(#mask)','url(#pixel)'),self.mask().replace('url(#mask)','url(https://bad/mask)'),self.mask().replace('width="1" height="1" xlink','width="2" height="1" xlink'),'<defs><mask id="mask"><g mask="url(#mask)"/></mask></defs>']:
            with self.assertRaises(ValueError):validate_svg(BASE.format(body).encode(),bankzadach=True)

class BankLiteralLabelsTest(unittest.TestCase):
    def test_safe_label_and_primitives_preserved(self):
        body='<line x1="0" y1="0" x2="1" y2="1" stroke="black"/><polygon points="0,0 1,0 1,1" fill="white"/><text x="1" y="2" font-family="DejaVu Serif" font-size="14" font-style="italic" text-anchor="end">x</text>'
        self.assertIn(b'>x</text>',validate_svg(BASE.format(body).encode(),bankzadach=True).data)
        for bad in [body.replace('>x<','>url(http://bad)<'),body.replace('DejaVu Serif','remote-font'),body.replace('font-size="14"','font-size="1000"'),body.replace('0,0 1,0 1,1','0,0 1'),body.replace('>x<','><tspan>x</tspan><')]:
            with self.assertRaises(ValueError):validate_svg(BASE.format(bad).encode(),bankzadach=True)

class BankEditorFigureTest(unittest.TestCase):
    def test_bounded_circle_rgb_and_times_label(self):
        body='<circle cx="1" cy="2" r="3" stroke="rgb(210,30,30)" fill="none"/><text x="1" y="2" font-family="Times New Roman" font-size="11px">Считаем точки, где f&apos;(x)&gt;0</text>'
        self.assertIn('Считаем'.encode(),validate_svg(BASE.format(body).encode(),bankzadach=True).data)
        with self.assertRaises(ValueError):validate_svg(BASE.format(body.replace('210,30,30','999,30,30')).encode(),bankzadach=True)
    def test_editor_metadata_only_leaf_is_removed(self):
        raw=BASE.format('<s:namedview xmlns:s="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" arbitrary="editor setting"/><path d="M0 0 L1 1"/>').encode()
        self.assertNotIn(b'namedview',validate_svg(raw,bankzadach=True).data)
        bad=raw.replace(b'arbitrary="editor setting"/>',b'arbitrary="editor setting"><script/></s:namedview>')
        with self.assertRaises(ValueError):validate_svg(bad,bankzadach=True)

class BankLiteralStyleTest(unittest.TestCase):
    def test_literal_style_preserves_precedence_and_use_chain(self):
        body='<path id="p" d="M0 0 L1 1" fill="#fff" style="fill:none;stroke:#dc4214;stroke-width:0.9;stroke-dasharray:none"/><use id="a" xlink:href="#p"/><use xlink:href="#a"/>'
        out=validate_svg(BASE.format(body).encode(),bankzadach=True).data
        self.assertIn(b'fill="none"',out)
        self.assertNotIn(b'style=',out)
        with self.assertRaises(ValueError):validate_svg(BASE.format(body.replace('href="#p"','href="#a"')).encode(),bankzadach=True)
    def test_style_rejects_active_or_ambiguous_values(self):
        for style in ['fill:url(https://bad)','filter:none','fill:#fff!important','stroke-width:1;stroke-width:2','fill:var(--x)','stroke:expression(1)']:
            with self.assertRaises(ValueError):validate_svg(BASE.format('<path d="M0 0" style="'+style+'"/>').encode(),bankzadach=True)
    def test_exact_png_wrapper_only(self):
        body='<g><image id="image" width="1" height="1" xlink:href="data:image/png;base64,'+BankMaskTest.png+'"/></g>'
        raw=BASE.format(body).replace('width="100" height="80" viewBox="0 0 100 80"','version="1.1" width="1" height="1" viewBox="0 0 1 1"').encode()
        self.assertTrue(unwrap_png(raw).startswith(b'\x89PNG'))
        for bad in [raw.replace(b'<g>',b'<g transform="scale(2)">'),raw.replace(b'</g>',b'<path d="M0 0"/></g>'),raw.replace(b'viewBox="0 0 1 1"',b'viewBox="0 0 2 2"')]:
            self.assertIsNone(unwrap_png(bad))

class BankPathBudgetTest(unittest.TestCase):
    def test_empty_path_is_only_bank_noop(self):
        raw=BASE.format('<path id="empty" d=" \n "/><use xlink:href="#empty"/>').encode()
        validate_svg(raw,bankzadach=True)
        with self.assertRaises(ValueError):validate_svg(raw)
    def test_coordinate_ceiling_remains_bounded(self):
        raw=BASE.format('<path d="M0 0 L8387608 1"/>').encode()
        validate_svg(raw,bankzadach=True)
        with self.assertRaises(ValueError):validate_svg(raw)
        with self.assertRaises(ValueError):validate_svg(raw.replace(b'8387608',b'10000001'),bankzadach=True)
    def test_mask_group_still_rejects_active_content(self):
        raw=BASE.format('<mask id="m"><g transform="scale(1)"><image id="i" width="1" height="1" xlink:href="data:image/png;base64,'+BankMaskTest.png+'"/></g></mask>').encode()
        validate_svg(raw,bankzadach=True)
        for bad in [raw.replace(b'<g ',b'<g filter="url(#x)" '),raw.replace(b'</g>',b'<script/></g>'),raw.replace(b'width="1" height="1" xlink',b'width="2" height="1" xlink')]:
            with self.assertRaises(ValueError):validate_svg(bad,bankzadach=True)

class MediaQualityHoldTest(unittest.TestCase):
    def test_hash_bound_hold_is_explicit_and_fail_closed(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);p=root/'media-quality-issues.json';sha='a'*64
            self.assertEqual(quality_holds(root),set())
            p.write_text(json.dumps({sha:{'status':'hold'}}));self.assertEqual(quality_holds(root),{sha})
            p.write_text(json.dumps({sha:{'status':'resolved'}}));self.assertEqual(quality_holds(root),set())
            p.write_text(json.dumps({sha:{'status':'unknown'}}))
            with self.assertRaises(ValueError):quality_holds(root)

class ReviewedRasterTest(unittest.TestCase):
    def test_reviewed_png_requires_matching_hash_dimensions_and_path(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);(root/'normalized-media').mkdir();png=base64.b64decode(BankMaskTest.png);sha=hashlib.sha256(png).hexdigest();relative='normalized-media/'+sha+'.png';(root/relative).write_bytes(png)
            entry={'path':relative,'sha256':sha,'width':1,'height':1,'renderer':'browser-reviewed-v1','reviewed':True};p=root/'media-render-reviews.json'
            p.write_text(json.dumps({'a'*64:entry}));self.assertIn('a'*64,reviewed_rasters(root))
            for key,value in [('width',2),('reviewed',False),('path','../image.png'),('sha256','b'*64)]:
                p.write_text(json.dumps({'a'*64:{**entry,key:value}}))
                with self.assertRaises(ValueError):reviewed_rasters(root)

if __name__=='__main__':unittest.main()
