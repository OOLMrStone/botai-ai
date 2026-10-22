import unittest
from bankzadach_normalize import parse_mixed,projection,classify,registry,normalize,tokenize_math,expand_notes

class AcceptMath:
    def validate_all(self, formulas): pass

def no_asset(url,purpose): raise ValueError('unexpected_asset')

class BankZadachAdapterTest(unittest.TestCase):
    def test_mixed_formula_inequality_and_literal_text(self):
        b=parse_mixed('Найдите $x<3$ и \\[\\frac{1}{2}\\].',[],no_asset,'statement')
        self.assertEqual([x['type'] for x in b[0]['runs']],['text','latex','text'])
        self.assertEqual(b[1],{'type':'latex','value':r'\frac{1}{2}'})
        self.assertEqual(projection(b),'Найдите x<3 и \n\\frac{1}{2}\n.')
    def test_unsafe_unknown_and_unclosed(self):
        for s in ['<script>alert(1)</script>','<span onclick="go()">x</span>','$x','<table><tr><td>x</td></tr></table>','$\\href{https://a}{x}$']:
            with self.subTest(s=s),self.assertRaises(ValueError):parse_mixed(s,[],no_asset,'statement')
    def test_notes_preserve_label_body_and_formulas(self):
        b=parse_mixed('По \\note{теореме}{$a^{2}+b^{2}=c^{2}$}.',[],no_asset,'reference')
        self.assertEqual(projection(b),'По теореме (a^{2}+b^{2}=c^{2}).')
    def test_link_is_text_only(self):
        b=parse_mixed('<a href="https://example.org" target="_blank">Теорема</a> $a=1$',[],no_asset,'reference')
        self.assertNotIn('example',str(b));self.assertEqual(projection(b),'Теорема a=1')
    def test_images_scoped_and_ordered(self):
        calls=[]
        def asset(url,purpose):calls.append(purpose);return {'id':purpose+'-a','width':400,'height':100}
        images=[{'image_url':'https://example.org/a.svg?secret=1','order':1}]
        b=parse_mixed('До \\img{1} после',images,asset,'reference')
        self.assertEqual([x['type'] for x in b],['paragraph','image','paragraph']);self.assertEqual(calls,['reference'])
    def test_number_not_upstream_answer_type(self):
        row={'id':'31eb45d5-1a66-4b45-8cd8-8469a371ad87','subtopic_name':'Показательные неравенства','content_latex':'Решите $2^x>1$.','solution_latex':'Получаем $x>0$.','answer':'$(0;+\\infty)$','answer_type':'integer','difficulty':2}
        record,q=normalize(row,[{'topicNumber':16,'subtopicName':'Показательные неравенства'}],no_asset,AcceptMath(),'2026-10-06T00:00:00Z','0'*64)
        self.assertEqual(record['acceptedAnswers'],[]);self.assertEqual(record['examNumber'],16)
    def test_unknown_topic_quarantined(self):
        with self.assertRaises(ValueError): classify({'subtopic_name':'Неизвестный метод'},[{'topicNumber':19,'subtopicName':'Неизвестный метод'}],registry())
    def test_short_non_numeric_quarantined(self):
        row={'id':'31eb45d5-1a66-4b45-8cd8-8469a371ad87','subtopic_name':'Показательные уравнения','content_latex':'Найдите $x$.','solution_latex':'Ответ $x=1$.','answer':'$(0;1)$'}
        with self.assertRaisesRegex(ValueError,'non_numeric_short_answer'):normalize(row,[{'topicNumber':7,'subtopicName':'Показательные уравнения'}],no_asset,AcceptMath(),'2026-10-06T00:00:00Z','0'*64)

class SourceMetadataBoundaryTest(unittest.TestCase):
    def test_seo_canonical_mismatch_is_private_warning(self):
        row={'id':'31eb45d5-1a66-4b45-8cd8-8469a371ad87','subtopic_name':'Показательные уравнения','content_latex':'Найдите $x$.','solution_latex':'Получаем $x=1$.','answer':'1','seo':{'canonical_url':'https://bank-zadach.ru/task/00000000-0000-0000-0000-000000000000/'},'source_references':[{'bank_name':'ФИПИ'}]}
        r,q=normalize(row,[{'topicNumber':7,'subtopicName':'Показательные уравнения'}],no_asset,AcceptMath(),'2026-10-06T00:00:00Z','0'*64)
        self.assertTrue(q['seoCanonicalMismatchWarning'])
        self.assertIn(row['id'],r['provenance']['sourceUrl'])
        self.assertEqual(r['provenance']['originalReferences'][0]['publisher'],None)
        self.assertIsNone(r['difficulty'])
        self.assertEqual(q['difficultyBasis'],'source-unknown-null')
    def test_registry_is_current_141(self):
        self.assertEqual(len(registry()),141)
    def test_relative_image_url_is_inert(self):
        seen=[]
        def resolve(url,purpose):seen.append(url);return {'id':'s-a','width':100,'height':100}
        b=parse_mixed('<p>Условие</p><img src="/api/v1/task-images/a/original.svg?v=1"/>',[],resolve,'statement')
        self.assertEqual(len(b),2);self.assertEqual(seen,['/api/v1/task-images/a/original.svg?v=1'])

class MathTypographyTest(unittest.TestCase):
    def test_cyrillic_subscript_preserves_labels_as_text(self):
        audit=[];b=parse_mixed(r'$S_{пов}=S_{осн}+S_{бок}$',[],no_asset,'reference',audit=audit)
        self.assertEqual(b[0]['runs'][0]['value'],r'S_{\text{пов}}=S_{\text{осн}}+S_{\text{бок}}')
        self.assertEqual(audit,['cyrillic-math-text-label'])
    def test_event_quotes_remain_exact_native_glyphs(self):
        audit=[];b=parse_mixed(r'\[A=\text{«выбрано число $4$»}.\]',[],no_asset,'reference',audit=audit)
        self.assertEqual(projection(b),'A= «выбрано число 4».')
        self.assertEqual([r['type'] for r in b[0]['runs']],['latex','text','latex','text'])
        self.assertEqual(audit,['event-label-native-text'])

class EmptyMathTest(unittest.TestCase):
    def test_only_whitespace_display_is_removed(self):
        audit=[];b=parse_mixed('Ответ $9$.\\[\n\\]',[],no_asset,'reference',audit=audit)
        self.assertEqual(projection(b),'Ответ 9.');self.assertEqual(audit,['empty-display-whitespace-removed'])
        with self.assertRaises(ValueError):parse_mixed('Ответ $9$.\\[',[],no_asset,'reference')


class HashBoundReviewTest(unittest.TestCase):
    def test_review_cannot_change_position_or_capture(self):
        row={'id':'31eb45d5-1a66-4b45-8cd8-8469a371ad87','subtopic_name':'Неизвестный метод','content_latex':'Найдите $x$.','solution_latex':'Получаем $x=1$.','answer':'1'}
        args=(row,[{'topicNumber':7,'subtopicName':'Неизвестный метод'}],no_asset,AcceptMath(),'2026-10-06T00:00:00Z','0'*64)
        review={'rawSha256':'0'*64,'topicIds':['sdamgia-11'],'reason':'Reviewed equation is exponential.'}
        r,_=normalize(*args,review);self.assertEqual(r['topicIds'],['sdamgia-11'])
        with self.assertRaisesRegex(ValueError,'review_hash_mismatch'):normalize(*args,dict(review,rawSha256='1'*64))
        with self.assertRaisesRegex(ValueError,'review_topic_scope'):normalize(*args,dict(review,topicIds=['sdamgia-237']))

class TextMathLabelTest(unittest.TestCase):
    def test_quoted_event_symbol_and_cyrillic_sentence(self):
        b=parse_mixed(r'\[«A» = \text{событие произошло.}\]',[],no_asset,'reference')
        self.assertEqual(projection(b),'«A» = событие произошло.')
    def test_cyrillic_word_runs_and_index_digits(self):
        from bankzadach_normalize import safe_typographic_math
        self.assertEqual(safe_typographic_math(r'S_{пов.1}=2\ тарелок.'),r'S_{\text{пов.1}}=2\ \text{тарелок}.')
        self.assertEqual(safe_typographic_math(r'\text{число S_{пов}}'),r'\text{число S_{пов}}')
        self.assertEqual(safe_typographic_math('А+и'),'А+и')


class EditorialBoundaryTest(unittest.TestCase):
    def row(self):
        return {'id':'31eb45d5-1a66-4b45-8cd8-8469a371ad87','subtopic_name':'Показательные уравнения','content_latex':'Найдите $x$.','solution_latex':'$A~и~B$. Получаем $x=1$.','answer':'1'}
    def test_single_letter_requires_current_hash_review(self):
        row=self.row();args=(row,[{'topicNumber':7,'subtopicName':'Показательные уравнения'}],no_asset,AcceptMath(),'2026-10-06T00:00:00Z','0'*64)
        review={'rawSha256':'0'*64,'mathTextLetters':['и'],'reason':'Conjunction between named events, preserve Cyrillic.'}
        r,q=normalize(*args,typesetting_review=review)
        self.assertIn(r'\text{и}',r['referenceSolution'])
        self.assertEqual(q['typographicTransformations'],{'hash-bound-cyrillic-math-literal':1})
        with self.assertRaisesRegex(ValueError,'typesetting_hash_mismatch'):normalize(*args,typesetting_review=dict(review,rawSha256='1'*64))
        with self.assertRaisesRegex(ValueError,'typesetting_review_scope'):normalize(*args,typesetting_review=dict(review,mathTextLetters=['x']))
    def test_scene_is_never_silently_ignored(self):
        row=self.row();row['solution_latex']+=r'\img{1}';row.update(scene3d={'figures':[]},solution_images=[{'image_url':'https://example.org/a.png','order':1}])
        args=(row,[{'topicNumber':7,'subtopicName':'Показательные уравнения'}],lambda u,p:{'id':'reference-a','width':100,'height':100},AcceptMath(),'2026-10-06T00:00:00Z','0'*64)
        with self.assertRaisesRegex(ValueError,'supplemental_scene_review_required'):normalize(*args)
        review={'rawSha256':'0'*64,'allowSupplementalScene3d':True,'statementSelfContained':True,'staticSolutionFiguresPreserved':True,'reason':'Complete givens; required static solution figure retained.'}
        _,q=normalize(*args,content_review=review);self.assertTrue(q['supplementalSceneOmitted'])
        row['content_latex']='На рисунке показано условие.'
        with self.assertRaisesRegex(ValueError,'supplemental_scene_condition_dependency'):normalize(*args,content_review=review)
    def test_known_source_quality_issue_is_excluded(self):
        import tempfile,json,hashlib
        from pathlib import Path
        from bankzadach_normalize import build
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'details').mkdir();row=self.row();raw=json.dumps(row).encode();(root/'details'/(row['id']+'.json')).write_bytes(raw)
            (root/'census.json').write_text(json.dumps({'tasks':[{'id':row['id'],'memberships':[{'topicNumber':7,'subtopicName':'Показательные уравнения'}]}]}))
            (root/'media-manifest.json').write_text(json.dumps({'tasks':{row['id']:{'complete':True,'urls':{}}}}))
            issue={'taskId':row['id'],'rawSha256':hashlib.sha256(raw).hexdigest(),'status':'quarantine-until-editorial-correction'}
            result=build(root,root/'output','node','unused',quality_issues=[issue])
            self.assertEqual(result['accepted'],0);self.assertEqual(result['quarantineReasons'],{'source_quality_issue':1})


class ProviderImageSemanticsTest(unittest.TestCase):
    def test_orphan_solution_image_is_audited_not_appended(self):
        audit=[];b=parse_mixed('Решение $x=1$.',[{'id':'old','order':1,'image_url':'https://example.org/old.svg'}],no_asset,'reference',False,audit)
        self.assertFalse(any(x['type']=='image' for x in b));self.assertEqual(audit,['orphan-provider-image-not-rendered'])
    def test_image_uuid_resolves_provider_current_url(self):
        seen=[]
        def asset(url,purpose):seen.append(url);return {'id':'r-a','width':10,'height':10}
        b=parse_mixed('<img src="https://example.org/stale.svg" data-image-id="current"/>',[{'id':'current','order':1,'image_url':'https://example.org/current.svg'}],asset,'reference',False)
        self.assertEqual(seen,['https://example.org/current.svg']);self.assertEqual(len(b),1)

class TableReviewTest(unittest.TestCase):
    def test_only_exact_hash_bound_table_is_transformed(self):
        raw=r'\begin{tabular}{c} $x$ \\ \end{tabular}'
        row={'id':'31eb45d5-1a66-4b45-8cd8-8469a371ad87','content_latex':'Найдите $x$.','solution_latex':raw+' Получаем $x=1$.','answer':'1'}
        args=(row,[{'topicNumber':7,'subtopicName':'Показательные уравнения'}],no_asset,AcceptMath(),'2026-10-06T00:00:00Z','0'*64)
        review={'rawSha256':'0'*64,'reason':'Exact table cells reviewed.','replacements':[{'sourceField':'solution_latex','exactSource':raw,'replacementLatex':r'\[\begin{array}{c}x\end{array}\]','reason':'One cell, no mathematical edit.'}]}
        r,q=normalize(*args,table_review=review)
        self.assertEqual(r['referenceContent'][0]['type'],'latex');self.assertEqual(row['solution_latex'],raw+' Получаем $x=1$.')
        with self.assertRaisesRegex(ValueError,'table_review_hash_mismatch'):normalize(*args,table_review=dict(review,rawSha256='1'*64))

class ExactAnswerReviewTest(unittest.TestCase):
    def test_answer_requires_missing_answer_and_exact_source_substring(self):
        row={'id':'31eb45d5-1a66-4b45-8cd8-8469a371ad87','content_latex':'Решите уравнение $x=1$.','solution_latex':'Получаем $x=1$. Ответ: $1$.','answer':''}
        args=(row,[{'topicNumber':14,'subtopicName':'Тригонометрические уравнения'}],no_asset,AcceptMath(),'2026-10-06T00:00:00Z','0'*64)
        topic={'rawSha256':'0'*64,'topicIds':['sdamgia-237'],'reason':'same exam number reviewed'}
        review={'rawSha256':'0'*64,'answerExactSource':'$1$.','sourceField':'solution_latex','reason':'Complete exact final answer.'}
        # Test scope before numeric semantics by using an exact reviewed topic for this position.
        from bankzadach_normalize import registry
        topic['topicIds']=[next(k for k,v in registry().items() if v[0]==14)]
        r,_=normalize(*args,review=topic,answer_review=review);self.assertEqual(r['referenceAnswer'],'1.')
        with self.assertRaisesRegex(ValueError,'answer_review_scope'):normalize(*args,review=topic,answer_review=dict(review,answerExactSource='$2$.'))
        with self.assertRaisesRegex(ValueError,'answer_review_hash_mismatch'):normalize(*args,review=topic,answer_review=dict(review,rawSha256='1'*64))

class NativeTextMacroTest(unittest.TestCase):
    def test_text_wrappers_preserve_embedded_math(self):
        b=parse_mixed(r'\par\textbf{Ответ: $x=1$.}\medskip\mbox{$y=2$} \emph{пояснение}',[],no_asset,'reference')
        self.assertEqual(projection(b).strip(),'Ответ: x=1.\ny=2 пояснение')
    def test_unknown_native_macro_is_never_shown_as_literal(self):
        with self.assertRaisesRegex(ValueError,'unsupported_source_macro'):parse_mixed(r'Рисунок \ing{0}',[],no_asset,'reference')

class NativeLayoutTest(unittest.TestCase):
    def test_export_layout_preserves_text_and_list_numbering(self):
        b=parse_mixed(r'\begin{center}Дано $x$.\end{center}\begin{enumerate}\item Первый $x$.\item Второй $y$.\end{enumerate}\end{document}',[],no_asset,'reference')
        self.assertEqual(projection(b),'Дано x.\n1) Первый x.\n2) Второй y.')
    def test_incomplete_center_is_not_silently_removed(self):
        with self.assertRaisesRegex(ValueError,'unbalanced_center'):parse_mixed(r'\begin{center}Текст.',[],no_asset,'reference')

class MathModeAndDelimiterTest(unittest.TestCase):
    def test_even_backslashes_do_not_escape_math_delimiter(self):
        from bankzadach_normalize import formulas_in
        b=parse_mixed(r'Тогда \\$x=1$ и $y=2 \\$ конец.',[],no_asset,'reference')
        self.assertEqual(formulas_in(b),['x=1',r'y=2 \\'])
    def test_actual_block_and_inline_modes_are_distinct(self):
        from bankzadach_normalize import formula_modes_in
        b=parse_mixed(r'$x$ и \[y\tag{1}\]',[],no_asset,'reference')
        self.assertEqual(formula_modes_in(b),[(r'y\tag{1}',True),('x',False)])

if __name__=='__main__':unittest.main()
