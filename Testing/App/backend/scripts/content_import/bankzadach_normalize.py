#!/usr/bin/env python3
"""Offline Bank Zadach adapter. Public acquisition is separate; unknown content is quarantined."""
from __future__ import annotations
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
import struct
from urllib.parse import urlsplit, urlunsplit, urljoin
import uuid
from acquire import private_directory, private_write

VERSION = 'bankzadach-mixed-content.v3'
PERMISSION = 'user-grant-2026-10-06-bankzadach'
REVISION = 'bankzadach-current2027-title-review-v2-native-difficulty-1-5-null'
MAX_TEXT = 256 * 1024
FORBIDDEN_MATH = re.compile(r'\\(?:href|url|html\w*|includegraphics|def|gdef|edef|xdef|let|futurelet|newcommand|renewcommand|providecommand|global|csname|input|include|write|openout|read|catcode)\b')


def identity_url(url):
    p = urlsplit(urljoin('https://bank-zadach.ru/', html.unescape(url)))
    if p.scheme != 'https' or p.username or p.password or p.fragment or p.port not in (None, 443):
        raise ValueError('asset_url')
    return urlunsplit((p.scheme, p.netloc, p.path, '', ''))


def load_json(path):
    if path.is_symlink() or path.stat().st_size > 64 * 1024 * 1024:
        raise ValueError('unsafe_input')
    def pairs(items):
        result={}
        for key,value in items:
            if key in result:raise ValueError('duplicate_json_key')
            result[key]=value
        return result
    return json.loads(path.read_text(),object_pairs_hook=pairs,parse_constant=lambda x:(_ for _ in ()).throw(ValueError('nonfinite_json_number')))


def read_brace(text, start):
    if start >= len(text) or text[start] != '{':
        raise ValueError('note_braces')
    depth, i = 1, start + 1
    while i < len(text):
        if text[i] == '\\':
            i += 2
            continue
        if text[i] == '{': depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0: return text[start + 1:i], i + 1
        i += 1
    raise ValueError('note_braces')


def expand_notes(text, depth=0):
    if depth > 8: raise ValueError('note_depth')
    out, pos = [], 0
    while True:
        m = re.search(r'\\note\s*\{', text[pos:])
        if not m: return ''.join(out) + text[pos:]
        start = pos + m.start(); brace = pos + m.end() - 1
        label, end = read_brace(text, brace)
        while end < len(text) and text[end].isspace(): end += 1
        body, end = read_brace(text, end)
        out += [text[pos:start], expand_notes(label, depth + 1), ' (', expand_notes(body, depth + 1), ')']
        pos = end


def safe_typographic_math(value, math_text_letters=()):
    # Explicit braced Cyrillic subscripts are text labels, not new mathematical expressions.
    def labels(part):
        if math_text_letters:
            part=re.sub(r'(?<![А-Яа-яЁё])(['+''.join(math_text_letters)+r'])(?![А-Яа-яЁё])',lambda m:r'\text{'+m[1]+'}',part)
        pattern=r'(_\{([А-Яа-яЁё]{2,}(?:\.\d+|\.)?)\}|[А-Яа-яЁё]{2,}(?:[ \t]+[А-Яа-яЁё]{2,})*)'
        def replacement(match):
            if match[2] is not None:return '_{'+r'\text{'+match[2]+'}}'
            return r'\text{'+match[1]+'}'
        return re.sub(pattern,replacement,part)
    result=[];pos=0
    for match in re.finditer(r'\\text(?:rm|sf|tt|bf|it|normal)?\s*\{',value):
        if match.start()<pos:continue
        _,end=read_brace(value,match.end()-1)
        result.extend([labels(value[pos:match.start()]),value[match.start():end]])
        pos=end
    return ''.join(result)+labels(value[pos:])


def event_text_formula(value):
    # Preserve unsupported guillemets as native text only for a complete top-level event label.
    match=re.match(r'^((?:[A-Za-z](?:_\{?\d+\}?)?|«[A-Za-z]»)\s*=\s*)\\text\{',value)
    if not match:return None
    body,end=read_brace(value,match.end()-1)
    if (any(c in body for c in '«»') or '«' in match[1]) and not any(c in body for c in '\\{}') and value[end:] in ('','.',';',','):
        return match[1].strip(),body,value[end:]
    return None


def tokenize_math(text, math_text_letters=()):
    """Protect delimiters before HTML parsing: inequalities inside TeX are never HTML."""
    tokens, out, pos = [], [], 0
    pattern = re.compile(r'(\$\$|\$)|\\([\[(])')
    while (m := pattern.search(text, pos)):
        if (m.start()-len(text[:m.start()].rstrip('\\'))) % 2:
            out.append(text[pos:m.end()]);pos=m.end();continue
        out.append(text[pos:m.start()]); opening = m.group()
        closing = {'$':'$', '$$':'$$', '\\(':'\\)', '\\[':'\\]'}[opening]
        end = m.end()
        while True:
            end = text.find(closing, end)
            if end < 0: raise ValueError('unclosed_math')
            if (end-len(text[:end].rstrip('\\'))) % 2 == 0: break
            end += len(closing)
        value = html.unescape(text[m.end():end]).strip()
        if (not value and opening not in ('$$','\\[')) or len(value) > 4000 or FORBIDDEN_MATH.search(value): raise ValueError('unsafe_math')
        original=value;value=safe_typographic_math(value)
        ordinary=value;value=safe_typographic_math(value,math_text_letters) if math_text_letters else value
        token={'type':'latex','value':value,'_display':opening in ('$$','\\[')}
        if not value:token['_empty']=True;token['_transform']='empty-display-whitespace-removed'
        if original!=value:token['_transform']='cyrillic-math-text-label'
        if ordinary!=value:token['_transform']='hash-bound-cyrillic-math-literal'
        event=event_text_formula(value)
        if event:token['_event']=event;token['_transform']='event-label-native-text'
        idx = len(tokens); tokens.append(token)
        out.append(f'\ue000{idx}\ue001'); pos = end + len(closing)
    out.append(text[pos:])
    return ''.join(out), tokens


class MixedParser(HTMLParser):
    CONTAINERS = {'p','div','span','a','b','strong','i','em','u','small','center','section'}
    def __init__(self, formulas, images, resolver, purpose, audit, math_text_letters=()):
        super().__init__(convert_charrefs=True)
        self.formulas, self.images, self.resolver, self.purpose = formulas, images, resolver, purpose
        self.audit=audit
        self.math_text_letters=math_text_letters
        self.blocks, self.runs, self.used_images, self.stack = [], [], set(), []
    def flush(self):
        if any(r['type'] != 'text' or r['value'].strip() for r in self.runs):
            self.blocks.append({'type':'paragraph','runs':self.runs})
        self.runs=[]
    def run(self, item):
        if item['type']=='text' and self.runs and self.runs[-1]['type']=='text': self.runs[-1]['value'] += item['value']
        else: self.runs.append(item)
    def image(self, url, alt=''):
        identity = identity_url(url)
        asset = self.resolver(url, self.purpose)
        self.used_images.add(identity); self.flush()
        self.blocks.append({'type':'image','assetId':asset['id'],'alt':alt or ('Рисунок к условию' if self.purpose=='statement' else 'Рисунок к решению'),'aspectRatio':asset['width']/asset['height']})
    def handle_starttag(self, tag, attrs):
        if len(attrs)!=len(dict(attrs)): raise ValueError('duplicate_html_attribute')
        attrs=dict(attrs)
        if any(k.lower().startswith('on') for k in attrs): raise ValueError('active_html')
        if tag=='br': self.run({'type':'text','value':'\n'}); return
        if tag=='img':
            url=attrs.get('src','')
            if attrs.get('data-image-id'):
                matches=[im for im in self.images if im.get('id')==attrs['data-image-id']]
                if len(matches)>1:raise ValueError('ambiguous_image_identity')
                if matches:url=matches[0]['image_url']
            self.image(url, attrs.get('alt','')[:1000]); return
        if tag not in self.CONTAINERS: raise ValueError('unsupported_html_'+tag)
        # Formatting and hyperlink targets are intentionally not emitted into typed data.
        if set(attrs)-{'class','style','href','target','rel','data-task-content-generated','data-inline-note','data-note-label','data-note-body','data-note-width-px','data-image-id','align'}: raise ValueError('unsupported_html_attribute')
        if tag in {'p','div','section','center'}: self.flush()
        self.stack.append(tag)
        if len(self.stack)>32: raise ValueError('html_depth')
    def handle_endtag(self, tag):
        if tag in {'br','img'}: return
        if not self.stack or self.stack[-1]!=tag: raise ValueError('unbalanced_html')
        self.stack.pop()
        if tag in {'p','div','section','center'}: self.flush()
    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag,attrs)
        if tag not in {'br','img'}: self.handle_endtag(tag)
    def handle_data(self, data):
        for part in re.split(r'(\ue000\d+\ue001|\\img\{\d+\})',data):
            if not part: continue
            if part.startswith('\ue000'):
                formula=dict(self.formulas[int(part[1:-1])])
                display=formula.pop('_display')
                transformation=formula.pop('_transform',None)
                if transformation:self.audit.append(transformation)
                if formula.pop('_empty',False):continue
                event=formula.pop('_event',None)
                if event:
                    prefix,body,suffix=event
                    if display:self.flush()
                    quoted=re.fullmatch(r'«([A-Za-z])»\s*=',prefix)
                    if quoted:
                        self.run({'type':'text','value':'«'});self.run({'type':'latex','value':quoted[1]});self.run({'type':'text','value':'» '});self.run({'type':'latex','value':'='})
                    else:self.run({'type':'latex','value':prefix})
                    self.run({'type':'text','value':' '})
                    nested=parse_mixed(body,[],self.resolver,self.purpose,False,self.audit,self.math_text_letters)
                    if len(nested)!=1 or nested[0]['type']!='paragraph':raise ValueError('unsupported_event_label')
                    for run in nested[0]['runs']:self.run(run)
                    if suffix:self.run({'type':'text','value':suffix})
                    if display:self.flush()
                    continue
                if display:
                    self.flush();self.blocks.append(formula)
                else:self.run(formula)
            elif part.startswith('\\img{'):
                order=int(part[5:-1]); matches=[x for x in self.images if x.get('order')==order]
                if len(matches)!=1: raise ValueError('image_order_missing_or_duplicate')
                self.image(matches[0]['image_url'], matches[0].get('alt_text') or '')
            else:
                if re.search(r'\\[A-Za-z]+',part): raise ValueError('unsupported_source_macro')
                if r'\\' in part:
                    part=part.replace(r'\\','\n');self.audit.append('native-tex-linebreak')
                part,count=re.subn(r'\\([ ,;%&#_${}])',lambda m:' ' if m[1] in ' ,;' else m[1],part)
                if count:self.audit.extend(['native-tex-literal-or-spacing']*count)
                if '\\' in part:raise ValueError('unsupported_source_escape')
                self.run({'type':'text','value':part.replace('\r\n','\n').replace('\xad','')})
    def handle_decl(self, decl): raise ValueError('html_declaration')
    def handle_pi(self, data): raise ValueError('html_pi')


def parse_mixed(value, images, resolver, purpose, append_unreferenced=True, audit=None, math_text_letters=()):
    if not isinstance(value,str) or not value.strip() or len(value.encode())>MAX_TEXT or '\x00' in value or '\ue000' in value or '\ue001' in value:
        raise ValueError('missing_or_oversize_content')
    protected, formulas=tokenize_math(expand_notes(value),math_text_letters)
    # Center is a layout environment; preserving a block boundary loses no contents.
    depth=0
    for match in re.finditer(r'\\(begin|end)\{center\}',protected):
        depth+=1 if match[1]=='begin' else -1
        if depth<0 or depth>8:raise ValueError('unbalanced_center_environment')
    if depth:raise ValueError('unbalanced_center_environment')
    if r'\begin{center}' in protected:
        protected=protected.replace(r'\begin{center}','<center>').replace(r'\end{center}','</center>')
        if audit is not None:audit.append('native-center-layout')
    # Exported document/spacing closes carry layout only, not task text.
    protected,count=re.subn(r'\\end\{(?:document|spacing)\}', '',protected)
    if count and audit is not None:audit.extend(['native-export-layout-close']*count)
    def enumerate_native(match):
        body=match[1]
        if re.search(r'\\(?:begin|end)\{enumerate\}',body):raise ValueError('nested_enumerate')
        chunks=re.split(r'\\item\b\s*',body)
        if chunks[0].strip() or len(chunks)<2 or len(chunks)>33:raise ValueError('enumerate_structure')
        if audit is not None:audit.append('native-numbered-enumerate')
        return ''.join(f'<div>{i}) {chunk}</div>' for i,chunk in enumerate(chunks[1:],1))
    protected=re.sub(r'\\begin\{enumerate\}(.*?)\\end\{enumerate\}',enumerate_native,protected,flags=re.S)
    if r'\MakeUppercase{\romannumeral 3}' in protected:
        protected=protected.replace(r'\MakeUppercase{\romannumeral 3}','III')
        if audit is not None:audit.append('native-exact-roman-three-label')
    for _ in range(32):
        match=re.search(r'\\(?:textbf|text|emph|mbox)\s*\{',protected)
        if not match:break
        body,end=read_brace(protected,match.end()-1)
        protected=protected[:match.start()]+body+protected[end:]
        if audit is not None:audit.append('native-text-format-wrapper')
    protected,count=re.subn(r'\\(?:par|medskip|bigskip)(?![A-Za-z])', '\n',protected)
    if count and audit is not None:audit.extend(['native-paragraph-spacing']*count)
    protected,count=re.subn(r'\\(?:quad|qquad)(?![A-Za-z])',' ',protected)
    if count and audit is not None:audit.extend(['native-inline-spacing']*count)
    protected,count=re.subn(r'\\item\b', '• ',protected)
    if count and audit is not None:audit.extend(['native-source-list-item']*count)
    parser=MixedParser(formulas,images,resolver,purpose,audit if audit is not None else [],math_text_letters)
    parser.feed(protected); parser.close()
    if parser.stack: raise ValueError('unclosed_html')
    parser.flush()
    for im in sorted(images,key=lambda x:x.get('order') or 0):
        if identity_url(im['image_url']) not in parser.used_images:
            if append_unreferenced:
                parser.image(im['image_url'], im.get('alt_text') or '')
                parser.audit.append('unreferenced-provider-image-appended')
            else:parser.audit.append('orphan-provider-image-not-rendered')
    limit=128 if purpose=='statement' else 256
    if not parser.blocks or len(parser.blocks)>limit or sum(len(b.get('runs',[])) for b in parser.blocks)>1024: raise ValueError('content_budget')
    if any(len(r['value'])>16000 for b in parser.blocks for r in b.get('runs',[]) if r['type']=='text'): raise ValueError('text_run_budget')
    if sum(b['type']=='image' for b in parser.blocks)>16: raise ValueError('figure_budget')
    return parser.blocks


def projection(blocks):
    return '\n'.join('\ufffc' if b['type']=='image' else (b['value'] if b['type']=='latex' else ''.join(r['value'] for r in b['runs'])) for b in blocks)


def registry():
    migrations=Path(__file__).resolve().parents[2]/'src/main/resources/db/migration'
    text=(migrations/'V6__catalog_and_synthetic_samples.sql').read_text()
    rows=re.findall(r"VALUES \('(sdamgia-\d+)','ege-profile-20-v1',(\d+),'([^']+)'",text)
    result={identity:(int(number),title) for identity,number,title in rows}
    result={k:v for k,v in result.items() if v[0]!=20 and k!='sdamgia-265'}
    for slug,title in [('divisibility','Делимость, остатки и чётность'),('integer-equations','Целочисленные уравнения'),('digits','Цифры и запись числа'),('sequences','Последовательности и прогрессии'),('invariants','Операции и инварианты'),('extrema','Оценки и экстремальные значения')]: result['botai-20-'+slug]=(20,title)
    return result


def native_difficulty(value):
    if value is None:return None
    if type(value) is not int or not 1<=value<=5:raise ValueError('invalid_source_difficulty')
    return value


def normalized_title(s): return re.sub(r'\s+',' ',s.lower().replace('ё','е').replace('\xad','')).strip()


def classify(row, memberships, topic_registry):
    memberships=memberships or row.get('topic_memberships') or []
    numbers={m.get('topicNumber',m.get('topic_number')) for m in memberships}
    if len(numbers)!=1 or not numbers <= set(range(1,21)): raise ValueError('ambiguous_exam_number')
    number=next(iter(numbers)); titles={normalized_title(m.get('subtopicName',m.get('subtopic_name',''))) for m in memberships}
    titles.add(normalized_title(row.get('subtopic_name') or ''))
    exact={k for k,(n,t) in topic_registry.items() if n==number and normalized_title(t) in titles}
    actual=normalized_title(row.get('content_latex') or row.get('content_text') or '')
    if number==19:
        if 'систем' in actual or r'\begin{cases}' in actual:return number,['sdamgia-268'],'statement-system-over-source-broad-label'
        if 'неравенств' in actual:return number,['sdamgia-270'],'statement-inequality-over-source-broad-label'
    if exact: return number, sorted(exact),'exact-subtopic-title'
    # Positions with a single meaningful curriculum topic need no guessed sub-classification.
    unique={2:'sdamgia-182',4:'sdamgia-166',5:'sdamgia-185',6:'sdamgia-130',17:'sdamgia-333'}
    if number in unique: return number,[unique[number]],'single-curriculum-topic'
    aliases={
      (1,'Прямоугольный треугольник'):'sdamgia-79',(1,'Равнобедренный треугольник'):'sdamgia-90',
      (1,'Параллелограмм'):'sdamgia-102',(1,'Трапеции'):'sdamgia-94',
      (3,'Прямоугольные параллелепипеды'):'sdamgia-193',(3,'Пирамиды'):'sdamgia-177',(3,'Призмы'):'sdamgia-178',
      (7,'Линейные уравнения'):'sdamgia-14',(7,'Квадратные уравнения'):'sdamgia-14',(7,'Кубические уравнения'):'sdamgia-14',
      (11,'Задачи на движение'):'sdamgia-84',(11,'Задачи на работу'):'sdamgia-87',
      (13,'Задачи на вклады'):'sdamgia-334',(13,'Задачи на кредиты'):'sdamgia-332',
      (16,'Иррациональные неравенства'):'sdamgia-243',
      (20,'Делимость и остатки'):'botai-20-divisibility',(20,'Последовательности и прогрессии'):'botai-20-sequences',
      (20,'Цифры и числа'):'botai-20-digits',
      (1,'Вписанная окружность'):'sdamgia-113',(1,'Описанная окружность'):'sdamgia-114',
      (1,'Тригонометрические функции в прямоугольном треугольнике'):'sdamgia-79',
      (1,'Вписанный и центральный углы'):'sdamgia-111',
      (9,'Геометрический смысл производной'):'sdamgia-68',(9,'Возрастание/убывание'):'sdamgia-70',(9,'Экстремумы'):'sdamgia-70',
      (10,'Квадратичная, кубическая зависимость'):'sdamgia-72',(10,'Степенное уравнение'):'sdamgia-72',
      (10,'Рациональные уравнения'):'sdamgia-76',(10,'Иррациональное уравнение'):'sdamgia-77',
      (10,'Тригонометрическая функция'):'sdamgia-75',(10,'Показательное уравнение'):'sdamgia-73',(10,'Логарифм'):'sdamgia-74',
      (11,'Концентрация'):'sdamgia-88',(11,'Проценты'):'sdamgia-88',(11,'Движение по прямой'):'sdamgia-84',
      (11,'Движение по воде'):'sdamgia-86',(11,'Работа'):'sdamgia-87',(11,'Протяжённые тела'):'sdamgia-84',
      (11,'Арифметическая прогрессия'):'sdamgia-89',(11,'Движение по окружности'):'sdamgia-85',
      (12,'Иррациональные функции'):'sdamgia-122',(12,'Показательные функции'):'sdamgia-272',(12,'Логарифмические функции'):'sdamgia-272',
      (14,'Логарифмы'):'sdamgia-186',(14,'Тригонометрия, сводящаяся к квадратному уравнению'):'sdamgia-167',
      (14,'Тригонометрия, разложение на множители'):'sdamgia-291',(14,'Тригонометрия и формулы'):'sdamgia-306',
      (16,'Многочлены'):'sdamgia-242',(16,'Логарифмические неравенства с переменным основанием'):'sdamgia-239',
      (18,'Квадрат, Прямоугольник, Ромб'):'sdamgia-321',(18,'Параллелограмм'):'sdamgia-321',(18,'Трапеции'):'sdamgia-321',
      (19,'Системы уравнений с параметром'):'sdamgia-268',(19,'Система неравенств с параметром'):'sdamgia-268',
      (19,'Иррациональные уравнения с параметром'):'sdamgia-327',(19,'Рациональные уравнения с параметром'):'sdamgia-171',
      (19,'Показательное уравнение с параметром'):'sdamgia-171',(19,'Показательное неравенство с параметром'):'sdamgia-270',
      (19,'Параметр и график функции'):'sdamgia-235',
    }
    mapped={v for (n,t),v in aliases.items() if n==number and normalized_title(t) in titles}
    if mapped: return number,sorted(mapped),'reviewed-subtopic-alias'
    text=normalized_title(row.get('content_latex') or row.get('content_text') or '')
    solution=normalized_title(row.get('solution_latex') or '')
    topic=None
    if number==1:
        if re.search(r'(?:вписан\w* окружност|окружност\w*[^.]{0,60}вписан|описан\w*[^.]{0,40}около окружност)',text): topic='sdamgia-113'
        elif re.search(r'(?:описан\w* окружност|окружност\w*[^.]{0,60}описан|вписан\w*[^.]{0,40}в окружност)',text): topic='sdamgia-114'
        elif 'окружност' in text and any(w in text for w in ['касательн','секущ','хорд']): topic='sdamgia-112'
        elif any(x in text for x in ['параллелограмм','прямоугольник','квадрат','ромб']): topic='sdamgia-102'
        elif 'трапец' in text: topic='sdamgia-94'
        elif 'прямоугольн' in text and 'треугольник' in text: topic='sdamgia-79'
        elif 'равнобедренн' in text and 'треугольник' in text: topic='sdamgia-90'
        elif 'треугольник' in text: topic='sdamgia-96'
    elif number==3:
        if 'вписан' in text or 'комбинац' in text: topic='sdamgia-197'
        elif 'многогранник' in text and 'двугранные углы' in text and 'прямые' in text:
            if 'площадь поверхности' in text:topic='sdamgia-148'
            elif 'объем' in text:topic='sdamgia-140'
        else:
            for word,identity in [('цилиндр','194'),('конус','144'),('шар','151'),('сфер','151'),('пирамид','177'),('тетраэдр','177'),('призм','178'),('параллелепипед','193'),('куб','192')]:
                if word in text: topic='sdamgia-'+identity;break
    elif number==8:
        _, math_tokens=tokenize_math(row.get('content_latex') or '')
        tex=' '.join(x['value'] for x in math_tokens)
        bare=re.sub(r'\\[A-Za-z]+','',tex)
        literal=bool(re.search('[a-zA-Z]',bare))
        if 'логарифмы' in titles: topic='sdamgia-63' if literal else 'sdamgia-58'
        elif 'тригонометрия' in titles:
            topic='sdamgia-64' if literal and 'значение' not in text else ('sdamgia-65' if 'значение' in text else 'sdamgia-59')
        elif 'степени и корни' in titles:
            topic=('sdamgia-61' if literal else 'sdamgia-56') if '\\sqrt' in tex else ('sdamgia-62' if literal else 'sdamgia-57')
    elif number==9 and 'значение производной' in titles:
        if any(w in text for w in ['скорост','движени','координат материальн']): topic='sdamgia-69'
        elif any(w in text for w in ['касательн','график']):topic='sdamgia-68'
    elif number==15:
        # Classify the requested quantity, not incidental edges/planes in the givens.
        text=text.rsplit('найдите',1)[-1] if 'найдите' in text else ''
        if 'угол' in text:
            if 'плоскост' in text and ('прямой' in text or 'ребром' in text or 'отрезком' in text):topic='sdamgia-284'
            elif 'плоскост' in text:topic='sdamgia-283'
            elif 'скрещивающ' in text or 'прямыми' in text:topic='sdamgia-285'
        elif 'расстояни' in text:
            if 'от точки' in text and 'плоскост' in text:topic='sdamgia-307'
            elif 'от точки' in text and 'прям' in text:topic='sdamgia-281'
            elif 'прямыми' in text or 'плоскостями' in text:topic='sdamgia-280'
        elif 'сечени' in text:
            if 'пирамид' in text:topic='sdamgia-282'
            elif 'призм' in text:topic='sdamgia-308'
            elif 'параллелепипед' in text or 'куб' in text:topic='sdamgia-309'
            elif 'цилиндр' in text or 'конус' in text:topic='sdamgia-310'
        elif 'объем' in text and any(w in text for w in ['пирамид','призм','параллелепипед','куб']):topic='sdamgia-257'
    elif number==16 and 'логарифмические неравенства' in titles:
        if '\\sqrt' in text:topic='sdamgia-314'
        else:topic='sdamgia-319'
    elif number==18:
        if 'окружност' in text:
            quad=any(x in text for x in ['четырехугольник','трапец','параллелограмм','квадрат','ромб','прямоугольник'])
            triangle='треугольник' in text
            if quad and triangle:pass
            elif quad:topic='sdamgia-326'
            elif triangle:topic='sdamgia-323'
            else:topic='sdamgia-277'
        elif 'треугольник' in text:topic='sdamgia-276'
    elif number==19:
        if any('систем' in t for t in titles):topic='sdamgia-268'
        elif 'параметр с модулем' in titles and 'уравнен' in text and 'неравен' not in text:topic='sdamgia-328'
        elif any(x in titles for x in ['параметр с логарифмами','параметр с тригонометрией','многочлены и параметр']):
            if 'уравнен' in text and 'неравен' not in text:topic='sdamgia-171'
            elif 'неравен' in text:topic='sdamgia-270'
    elif number==20:
        if any(x in text for x in ['остаток','остатк','делится','делятся','кратно','четност']):topic='botai-20-divisibility'
        elif any(x in text for x in ['цифр','двузначн','трехзначн','четырехзначн']):topic='botai-20-digits'
        elif any(x in text for x in ['последовательност','прогресси']):topic='botai-20-sequences'
    if topic and topic in topic_registry and topic_registry[topic][0]==number:return number,[topic],'reviewed-subtopic-and-statement-rule'
    raise ValueError('unmapped_subtopic')


class MathValidator:
    def __init__(self, node, katex): self.node,self.katex,self.cache=node,katex,{}
    def validate_all(self, formulas):
        fresh=sorted(set(formulas)-self.cache.keys())
        script=Path(__file__).with_name('bankzadach_validate_math.cjs')
        for start in range(0,len(fresh),200):
            batch=fresh[start:start+200]
            proc=subprocess.run([self.node,str(script),str(self.katex)],input=json.dumps(batch),text=True,capture_output=True,timeout=30)
            if proc.returncode: raise ValueError('math_validator_runtime')
            outcomes=json.loads(proc.stdout)
            if len(outcomes)!=len(batch): raise ValueError('math_validator_protocol')
            self.cache.update(zip(batch,outcomes))
        if any(not self.cache[x] for x in formulas): raise ValueError('invalid_katex')


def formula_modes_in(blocks): return [(b['value'],True) for b in blocks if b['type']=='latex'] + [(r['value'],False) for b in blocks for r in b.get('runs',[]) if r['type']=='latex']


def formulas_in(blocks): return [b['value'] for b in blocks if b['type']=='latex'] + [r['value'] for b in blocks for r in b.get('runs',[]) if r['type']=='latex']


def normalize(row, memberships, resolver, validator, retrieved, raw_hash, review=None, typesetting_review=None, content_review=None, answer_review=None, table_review=None):
    identity=str(uuid.UUID(row['id']))
    if row['id']!=identity: raise ValueError('invalid_identity')
    canonical=(row.get('seo') or {}).get('canonical_url')
    canonical_warning=bool(canonical and canonical!=f'https://bank-zadach.ru/task/{identity}/')
    if row.get('subject_slug') not in (None,'math-ege'): raise ValueError('wrong_subject')
    if review is None:
        number,topics,basis=classify(row,memberships,registry())
    else:
        numbers={m.get('topicNumber',m.get('topic_number')) for m in memberships}
        if len(numbers)!=1 or not numbers<=set(range(1,21)):raise ValueError('ambiguous_exam_number')
        number=next(iter(numbers));topics=review.get('topicIds');current=registry()
        if review.get('rawSha256')!=raw_hash:raise ValueError('review_hash_mismatch')
        if not isinstance(review.get('reason'),str) or not review['reason'].strip() or len(review['reason'])>2000:raise ValueError('review_reason')
        if not isinstance(topics,list) or not 1<=len(topics)<=32 or len(set(topics))!=len(topics) or any(t not in current or current[t][0]!=number for t in topics) or (number==20 and len(topics)!=1):raise ValueError('review_topic_scope')
        basis='hash-bound-editorial-review'
    if any(row.get(k) for k in ['attachments','code_runner','solution_attachments']): raise ValueError('unsupported_interactive_or_attachment')
    interactive_omitted=False
    if row.get('interactive'):
        if not isinstance(content_review,dict) or content_review.get('rawSha256')!=raw_hash:raise ValueError('supplemental_interactive_review_required')
        if any(content_review.get(k) is not True for k in ['supplementalInteractiveReviewed','statementSelfContained','staticSolutionFiguresPreserved']) or not isinstance(content_review.get('reason'),str) or not content_review['reason'].strip():raise ValueError('supplemental_interactive_review_scope')
        if not row.get('solution_images'):raise ValueError('supplemental_interactive_static_solution_missing')
        interactive_omitted=True
    scene_omitted=False
    if row.get('scene3d'):
        if not isinstance(content_review,dict) or content_review.get('rawSha256')!=raw_hash:raise ValueError('supplemental_scene_review_required')
        if any(content_review.get(k) is not True for k in ['allowSupplementalScene3d','statementSelfContained','staticSolutionFiguresPreserved']) or not isinstance(content_review.get('reason'),str) or not content_review['reason'].strip():raise ValueError('supplemental_scene_review_scope')
        if not row.get('solution_images'):raise ValueError('supplemental_scene_static_solution_missing')
        scene_omitted=True
    table_audit=[]
    if table_review is not None:
        if table_review.get('rawSha256')!=raw_hash:raise ValueError('table_review_hash_mismatch')
        replacements=table_review.get('replacements')
        if not isinstance(replacements,list) or not 1<=len(replacements)<=8 or not isinstance(table_review.get('reason'),str) or not table_review['reason'].strip():raise ValueError('table_review_scope')
        row=dict(row)
        for replacement in replacements:
            field=replacement.get('sourceField');exact=replacement.get('exactSource');value=replacement.get('replacementLatex')
            if field not in {'solution_latex','solution_html','content_latex','content_html'} or not isinstance(exact,str) or not exact or not isinstance(value,str) or not value.strip() or len(value)>MAX_TEXT or not isinstance(replacement.get('reason'),str) or not replacement['reason'].strip():raise ValueError('table_review_scope')
            if r'\begin{tabular}' not in exact or (row.get(field) or '').count(exact)!=1:raise ValueError('table_review_exact_mismatch')
            row[field]=row[field].replace(exact,value,1);table_audit.append('hash-bound-native-table-typesetting')
    condition=row.get('content_html') or row.get('content_latex')
    solution=row.get('solution_html') or row.get('solution_latex')
    math_text_letters=()
    if typesetting_review is not None:
        if typesetting_review.get('rawSha256')!=raw_hash:raise ValueError('typesetting_hash_mismatch')
        letters=typesetting_review.get('mathTextLetters')
        if not isinstance(letters,list) or not letters or len(set(letters))!=len(letters) or not set(letters)<=set('АВКСБНабилмсч') or not isinstance(typesetting_review.get('reason'),str) or not typesetting_review['reason'].strip():raise ValueError('typesetting_review_scope')
        math_text_letters=tuple(letters)
    transformations=list(table_audit)
    content=parse_mixed(condition,row.get('images') or [],resolver,'statement',audit=transformations,math_text_letters=math_text_letters)
    reference=parse_mixed(solution,row.get('solution_images') or [],resolver,'reference',append_unreferenced=False,audit=transformations,math_text_letters=math_text_letters)
    if (scene_omitted or interactive_omitted) and not any(b['type']=='image' for b in reference):raise ValueError('supplemental_static_solution_missing')
    answer_value=row.get('answer_display') or row.get('answer')
    if answer_review is not None:
        if answer_review.get('rawSha256')!=raw_hash:raise ValueError('answer_review_hash_mismatch')
        exact=answer_review.get('answerExactSource');field=answer_review.get('sourceField')
        if answer_value or field!='solution_latex' or not isinstance(exact,str) or not exact.strip() or len(exact)>16000 or exact not in (row.get(field) or '') or not isinstance(answer_review.get('reason'),str) or not answer_review['reason'].strip():raise ValueError('answer_review_scope')
        answer_value=exact;transformations.append('hash-bound-exact-source-answer-extraction')
    if isinstance(answer_value,str) and re.search(r'\\(?:sqrt|dfrac|frac)\b',answer_value) and not any(x in answer_value for x in ['$',r'\[',r'\(']) and not re.search('[А-Яа-яЁё]',answer_value):
        answer_value='$'+answer_value+'$';transformations.append('native-answer-math-delimiters')
    answer=parse_mixed(answer_value,[],resolver,'reference',False,transformations,math_text_letters)
    validator.validate_all(formula_modes_in(content)+formula_modes_in(reference)+formula_modes_in(answer))
    statement,ref_solution,ref_answer=projection(content),projection(reference),projection(answer)
    if (scene_omitted or interactive_omitted) and re.search(r'на рисунке|на чертеже|на модели|изображ[её]н|показан[оа]? на',statement.lower()):raise ValueError('supplemental_scene_condition_dependency')
    if number<=13:
        # Numeric auto-grading derives from the current exam position, never upstream answer_type.
        numeric=ref_answer.strip().replace('{,}',',').replace('−','-')
        if not re.fullmatch(r'[+-]?\d+(?:[.,]\d+)?',numeric): raise ValueError('non_numeric_short_answer')
        ref_answer=numeric;answer=[{'type':'paragraph','runs':[{'type':'text','value':numeric}]}]
    if not statement.strip() or len(statement)>16000 or len(ref_solution)>32000 or len(ref_answer)>16000: raise ValueError('projection_budget')
    if sum(b['type']=='image' for b in content+reference+answer)>16: raise ValueError('figure_budget')
    difficulty=native_difficulty(row.get('difficulty'))
    refs=[]
    for source in row.get('source_references') or []:
        parts=[source.get(k) for k in ['bank_name','source_name','external_key'] if source.get(k)]
        if parts:
            label='Сведения BankZadach: '+' · '.join(str(x) for x in parts)
            if len(label)>500 or len(refs)>=32: raise ValueError('source_reference_budget')
            refs.append({'publisher':None,'label':label,'url':None,'year':None,'examNumber':None})
    result={'schemaVersion':'botai-content.v1','provider':'bankzadach','externalId':identity,'formatId':'ege-profile-20-v1','examNumber':number,'topicIds':topics,'difficulty':difficulty,'sourceYear':None,'content':content,'statement':statement,'referenceAnswer':ref_answer,'referenceSolution':ref_solution,'referenceContent':reference,'referenceAnswerContent':answer,'acceptedAnswers':[ref_answer] if number<=13 else [],'provenance':{'sourceUrl':f'https://bank-zadach.ru/task/{identity}/','sourceGroups':['bankzadach'],'originalPublisher':None,'originalReferences':refs,'permissionRef':PERMISSION,'mappingRevision':REVISION,'retrievedAt':retrieved,'extractorVersion':VERSION},'assets':[]}
    quality={'externalId':identity,'seoCanonicalMismatchWarning':canonical_warning,'seoCanonicalUrl':canonical,'rawSha256':raw_hash,'classificationBasis':basis,'editorialReview':review,'typesettingReview':typesetting_review,'supplementalSceneOmitted':scene_omitted,'supplementalInteractiveOmitted':interactive_omitted,'contentReview':content_review,'answerReview':answer_review,'tableReview':table_review,'topicIds':topics,'examNumber':number,'sourceDifficulty':row.get('difficulty'),'difficultyBasis':'provider-native-1-5' if difficulty is not None else 'source-unknown-null','sourceReferences':row.get('source_references'),'sourceDescription':row.get('source_description'),'source':row.get('source'),'sourceMemberships':memberships,'sourceAnswerTypeIgnored':row.get('answer_type'),'formulaCount':len(formulas_in(content)+formulas_in(reference)+formulas_in(answer)),'typographicTransformations':dict(Counter(x for x in transformations if x not in {'unreferenced-provider-image-appended','orphan-provider-image-not-rendered'})),'normalizationAudit':dict(Counter(transformations))}
    return result,quality


def build(raw_root,output,node,katex,batch_size=500,reviews=None,typesetting_reviews=None,content_reviews=None,quality_issues=None,answer_reviews=None,table_reviews=None):
    if not 1<=batch_size<=1000: raise ValueError('batch_size')
    if output.exists() and any(output.iterdir()): raise ValueError('output_not_empty')
    private_directory(output)
    census=load_json(raw_root/'census.json'); media=load_json(raw_root/'normalized-media.json') if (raw_root/'normalized-media.json').exists() else {'assets':[]}
    acquired=load_json(raw_root/'media-manifest.json')
    media={a['identity']:a for a in media['assets']}; membership={r['id']:r['memberships'] for r in census['tasks']}
    validator=MathValidator(node,katex);accepted=[];quarantine=[];quality=[]
    quality_exclusions={item['taskId']:item for item in (quality_issues or []) if item.get('status') in {'quarantine-until-editorial-correction','quarantine'}}
    capture_paths=sorted((raw_root/'details').glob('*.json'))
    for path in capture_paths:
        try:
            row=load_json(path); row_assets={}
            raw_hash=hashlib.sha256(path.read_bytes()).hexdigest()
            if row.get('id') in quality_exclusions:
                if quality_exclusions[row['id']]['rawSha256']!=raw_hash:raise ValueError('quality_review_stale')
                raise ValueError('source_quality_issue')
            if row.get('id')!=path.stem or row.get('id') not in membership: raise ValueError('capture_identity_mismatch')
            if (acquired.get('tasks',{}).get(row['id']) or {}).get('complete') is not True: raise ValueError('acquisition_incomplete')
            def resolve(url,purpose):
                urls=(acquired.get('tasks',{}).get(row['id']) or {}).get('urls',{})
                key=urls.get(html.unescape(url))
                if key not in media: raise ValueError('media_unavailable')
                a=media[key];p=raw_root/a['path']
                if p.is_symlink() or not p.resolve().is_relative_to(raw_root.resolve()) or p.stat().st_size>8*1024*1024: raise ValueError('unsafe_media_path')
                data=p.read_bytes(); digest=hashlib.sha256(data).hexdigest()
                if digest!=a['sha256'] or len(data)<24 or data[:8]!=b'\x89PNG\r\n\x1a\n' or data[12:16]!=b'IHDR': raise ValueError('media_hash_or_type')
                width,height=struct.unpack('>II',data[16:24])
                if (width,height)!=(a['width'],a['height']) or not 0<width<=8192 or not 0<height<=8192 or width*height>20000000:raise ValueError('media_dimension_budget')
                aid=('s-' if purpose=='statement' else 'r-')+digest[:40]
                row_assets[aid]={'id':aid,'path':f'assets/{purpose}/{digest}.png','sha256':digest,'purpose':purpose,'_source':str(p)}
                return {'id':aid,'width':a['width'],'height':a['height']}
            record,q=normalize(row,membership.get(row['id'],[]),resolve,validator,census.get('retrievedAt') or datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),raw_hash,(reviews or {}).get(row['id']),(typesetting_reviews or {}).get(row['id']),(content_reviews or {}).get(row['id']),(answer_reviews or {}).get(row['id']),(table_reviews or {}).get(row['id']))
            if sum(Path(a['_source']).stat().st_size for a in row_assets.values())>64*1024*1024:raise ValueError('media_aggregate_budget')
            record['assets']=list(row_assets.values());accepted.append(record);quality.append(q)
        except Exception as e:
            # Deliberately no raw values/signed URLs in the status report.
            reason=str(e) if isinstance(e,ValueError) and re.fullmatch('[a-z0-9_]+',str(e)) else type(e).__name__
            quarantine.append({'externalId':path.stem,'reason':reason})
    for start in range(0,len(accepted),batch_size):
        target=output/f'batch-{start//batch_size+1:04d}';private_directory(target);lines=[]
        for record in accepted[start:start+batch_size]:
            for asset in record['assets']:
                source=Path(asset.pop('_source'));dest=target/asset['path']
                if not dest.exists(): private_write(dest,source.read_bytes())
            line=json.dumps(record,ensure_ascii=False,separators=(',',':')).encode()
            if len(line)>256*1024: raise ValueError('package_line_budget')
            lines.append(line)
        if sum(map(len,lines))>64*1024*1024: raise ValueError('package_byte_budget')
        private_write(target/'tasks.jsonl',b'\n'.join(lines)+b'\n')
    fingerprints={}
    for record in accepted:
        payload={key:record[key] for key in ['content','statement','referenceAnswer','referenceAnswerContent']}
        fingerprint=hashlib.sha256(json.dumps(payload,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        fingerprints.setdefault(fingerprint,[]).append(record['externalId'])
    duplicates=[{'fingerprint':key,'externalIds':ids,'count':len(ids)} for key,ids in sorted(fingerprints.items()) if len(ids)>1]
    summary={'exactDuplicateGroups':len(duplicates),'recordsInExactDuplicateGroups':sum(x['count'] for x in duplicates),'duplicateExtraRecords':sum(x['count']-1 for x in duplicates),'duplicateMetric':'Exact normalized statement/content and answer; accepted records only; no automatic deletion.','version':VERSION,'accepted':len(accepted),'quarantined':len(quarantine),'quarantineReasons':dict(Counter(r['reason'] for r in quarantine)),'positions':dict(Counter(r['examNumber'] for r in accepted)),'difficultyPolicy':'Exact provider integer 1..5; absent/unknown -> null. isGrob is derived by the backend iff difficulty=5; never accepted as an independent source flag.','rawTaskCount':len(capture_paths),'censusProviderUniqueTasks':len(membership),'missingCaptureCount':len(set(membership)-{p.stem for p in capture_paths})}
    for name,data in [('summary.json',summary),('quarantine.json',quarantine),('quality.json',quality),('duplicates.json',duplicates)]: private_write(output/name,json.dumps(data,ensure_ascii=False,indent=2).encode())
    return summary


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--raw-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--node',default='node');p.add_argument('--katex-package',type=Path,required=True);p.add_argument('--batch-size',type=int,default=500);p.add_argument('--reviews',type=Path);p.add_argument('--typesetting-reviews',type=Path);p.add_argument('--content-reviews',type=Path);p.add_argument('--quality-issues',type=Path);p.add_argument('--answer-reviews',type=Path);p.add_argument('--table-reviews',type=Path);a=p.parse_args()
    print(json.dumps(build(a.raw_root,a.output,a.node,a.katex_package,a.batch_size,load_json(a.reviews) if a.reviews else None,load_json(a.typesetting_reviews) if a.typesetting_reviews else None,load_json(a.content_reviews) if a.content_reviews else None,load_json(a.quality_issues) if a.quality_issues else None,load_json(a.answer_reviews) if a.answer_reviews else None,load_json(a.table_reviews) if a.table_reviews else None),ensure_ascii=False))
if __name__=='__main__':main()
