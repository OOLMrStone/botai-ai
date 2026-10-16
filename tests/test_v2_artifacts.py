"""Offline artifact provenance, exact JSON identity, and causal-reference boundaries."""
from copy import deepcopy
import hashlib
from io import BytesIO
import json
import random
from uuid import UUID

from PIL import Image
import pytest

from app.core.errors import ServiceError
from app.grading.images import SafeImage
from app.grading.v2_artifacts import MAX_DIAGRAM_BYTES, crop_diagram, validate_v2_response


SOURCE_ID = '00000000-0000-4000-8000-000000000001'
OTHER_SOURCE_ID = '00000000-0000-4000-8000-000000000002'
ARTIFACT_ID = '00000000-0000-4000-8000-000000000003'
BBOX = {'x': 0.25, 'y': 0.25, 'width': 0.5, 'height': 0.5}


def safe(image):
    output = BytesIO()
    image.save(output, format='PNG')
    return SafeImage(output.getvalue(), 'image/png')


@pytest.fixture
def source():
    image = Image.new('RGB', (80, 60), 'white')
    for x in range(80):
        for y in range(60):
            image.putpixel((x, y), (x * 3, y * 4, (x + y) % 256))
    return safe(image)


@pytest.fixture
def response(source):
    metadata, _ = crop_diagram(source, SOURCE_ID, BBOX, artifact_id=ARTIFACT_ID)
    return {
        'task': {'id': '00000000-0000-4000-8000-000000000004', 'task_number': 18, 'max_score': 3,
                 'statement': 'Докажите утверждение и найдите AB.', 'reference_answer': '3',
                 'reference_solution': None},
        'solution_image_ids': [SOURCE_ID], 'is_graded': True, 'rejection_reason': '',
        'ocr': {'steps': [
            {'id': 's1', 'type': 'construction', 'title': 'Чертёж и вычисление',
             'lines': ['$AB=4$'],
             'figure': {'kind': 'image', 'artifact_id': ARTIFACT_ID, 'alt': 'Чертёж ученика'}},
            {'id': 's2', 'type': 'answer', 'title': 'Ответ', 'lines': ['4'], 'figure': None},
        ], 'answer': '4'},
        'analysis': {
            'summary': 'Неверно вычислена длина.',
            'checks': {'domain': None, 'transformations': None,
                       'completeness': {'is_complete': True, 'reason': 'Решение закончено'}},
            'student_answer': {'text': '4', 'is_correct': False},
            'errors': [{'id': 'e1', 'code': None, 'description': 'Неверная длина', 'where': 'AB=4',
                        'correct_version': 'AB=3', 'advice': '', 'step_id': 's1', 'penalty': 1}],
            'strengths': [],
            'statuses': [
                {'id': 's1', 'status': 'error', 'note': 'Неверная длина', 'correct': 'AB=3',
                 'follows_from_step_ids': []},
                {'id': 's2', 'status': 'consequence', 'note': 'Следствие ошибки', 'correct': '3',
                 'follows_from_step_ids': ['s1']},
            ],
        },
        'grading': {'score': 2, 'criterion': 'Вычислительная ошибка', 'explanation': 'Неверная длина'},
        'artifacts': [metadata],
    }


def validate(response, **trusted):
    defaults = {'task': response.get('task'), 'image_ids': response.get('solution_image_ids'),
                'artifacts': response.get('artifacts'), 'reader_ocr': response.get('ocr')}
    return validate_v2_response(json.dumps(response, ensure_ascii=False), **(defaults | trusted))


def test_crop_is_exact_source_rectangle_with_self_consistent_metadata(source):
    original_data = source.data
    metadata, payload = crop_diagram(source, SOURCE_ID, BBOX)
    assert str(UUID(metadata['id'])) == metadata['id']
    assert metadata['source_image_id'] == SOURCE_ID
    assert metadata['bbox'] == BBOX and metadata['bbox'] is not BBOX
    assert (metadata['width'], metadata['height']) == (40, 30)
    assert metadata['byte_size'] == len(payload) <= MAX_DIAGRAM_BYTES
    assert metadata['sha256'] == hashlib.sha256(payload).hexdigest()
    assert metadata['media_type'] == 'image/jpeg'
    assert set(metadata) == {'id', 'kind', 'source_image_id', 'bbox', 'media_type',
                             'byte_size', 'width', 'height', 'sha256'}
    with Image.open(BytesIO(original_data)) as original:
        expected = BytesIO()
        original.crop((20, 15, 60, 45)).convert('RGB').save(expected, format='JPEG', quality=95)
    assert payload == expected.getvalue()
    assert source.data == original_data
    second, _ = crop_diagram(source, SOURCE_ID, BBOX)
    assert second['id'] != metadata['id']


@pytest.mark.parametrize('bbox', [None, [], {}, {**BBOX, 'extra': 1},
    {**BBOX, 'x': -0.1}, {**BBOX, 'x': 1}, {**BBOX, 'width': 0}, {**BBOX, 'height': -1},
    {**BBOX, 'x': float('nan')}, {**BBOX, 'x': float('inf')}, {**BBOX, 'x': True},
    {**BBOX, 'width': '0.5'}, {**BBOX, 'x': 10 ** 500},
    {'x': 0.5, 'y': 0.5, 'width': 1e-300, 'height': 1e-300},
])
def test_invalid_or_empty_pixel_crop_fails_as_service_error(source, bbox):
    with pytest.raises(ServiceError):
        crop_diagram(source, SOURCE_ID, bbox)


@pytest.mark.parametrize('source_id', ['https://example.test/image.jpg', '/private/image.jpg', '', None, []])
def test_crop_never_accepts_model_paths_or_urls(source, source_id):
    with pytest.raises(ServiceError):
        crop_diagram(source, source_id, BBOX)


def test_bad_image_and_bad_artifact_id_fail_as_service_errors(source):
    with pytest.raises(ServiceError):
        crop_diagram(SafeImage(b'not an image'), SOURCE_ID, BBOX)
    with pytest.raises(ServiceError):
        crop_diagram(source, SOURCE_ID, BBOX, artifact_id='../somewhere')


def test_crop_over_one_mebibyte_fails_without_resizing():
    noisy = Image.frombytes('RGB', (1200, 1200), random.Random(7).randbytes(1200 * 1200 * 3))
    with pytest.raises(ServiceError, match='1 МБ'):
        crop_diagram(safe(noisy), SOURCE_ID, {'x': 0, 'y': 0, 'width': 1, 'height': 1})


def test_valid_mixed_step_preserves_raw_and_all_trusted_snapshots(response):
    original = deepcopy(response)
    raw = json.dumps(response, ensure_ascii=False, indent=2)
    assert validate_v2_response(raw, task=response['task'], image_ids=response['solution_image_ids'],
                                artifacts=response['artifacts'], reader_ocr=response['ocr']) == []
    assert response == original and json.loads(raw) == original
    assert response['ocr']['steps'][0]['lines'] == ['$AB=4$']
    assert response['ocr']['steps'][0]['title'] == 'Чертёж и вычисление'


@pytest.mark.parametrize('field', ['id', 'kind', 'source_image_id', 'bbox', 'media_type', 'byte_size',
                                   'width', 'height', 'sha256'])
def test_every_artifact_field_is_required(response, field):
    del response['artifacts'][0][field]
    assert validate(response)


@pytest.mark.parametrize('key,value', [
    ('id', []), ('id', '/tmp/crop.jpg'), ('kind', 'reference'), ('source_image_id', OTHER_SOURCE_ID),
    ('media_type', 'image/svg+xml'), ('byte_size', True), ('byte_size', 0),
    ('byte_size', MAX_DIAGRAM_BYTES + 1), ('width', 0), ('height', 8193),
    ('sha256', 'ABCDEF' * 11), ('sha256', 'a' * 63), ('sha256', []),
    ('bbox', {**BBOX, 'y': 0.9}), ('url', 'https://example.test/crop'),
])
def test_untrusted_artifact_metadata_is_rejected(response, key, value):
    response['artifacts'][0][key] = value
    assert validate(response)


def test_artifact_bytes_metadata_and_run_identity_cannot_be_replaced(response):
    trusted = deepcopy(response['artifacts'])
    response['artifacts'][0]['sha256'] = 'a' * 64
    assert any('trusted artifacts' in e for e in validate(response, artifacts=trusted))
    response['artifacts'] = deepcopy(trusted)
    response['artifacts'][0]['byte_size'] += 1
    assert any('trusted artifacts' in e for e in validate(response, artifacts=trusted))


def test_dangling_duplicate_and_unused_artifacts_fail(response):
    response['ocr']['steps'][0]['figure']['artifact_id'] = OTHER_SOURCE_ID
    assert any('no diagram artifact' in e for e in validate(response))
    assert any('unreferenced' in e for e in validate(response))
    response['ocr']['steps'][0]['figure']['artifact_id'] = ARTIFACT_ID
    response['artifacts'].append(deepcopy(response['artifacts'][0]))
    assert any('duplicate artifact' in e for e in validate(response))


@pytest.mark.parametrize('key,value', [('alt', ''), ('alt', None), ('artifact_id', []),
                                     ('url', 'https://example.test/x'), ('lines', [])])
def test_image_figure_is_an_exact_metadata_reference(response, key, value):
    response['ocr']['steps'][0]['figure'][key] = value
    assert validate(response)


@pytest.mark.parametrize('links', [[], ['s1', 's1'], ['s2'], ['missing'], [None], [['s1']], 's1'])
def test_consequence_requires_unique_earlier_error_references(response, links):
    response['analysis']['statuses'][1]['follows_from_step_ids'] = links
    assert any('follows_from_step_ids' in e for e in validate(response))


def test_causal_references_are_required_and_cannot_point_to_minor_or_future_steps(response):
    del response['analysis']['statuses'][0]['follows_from_step_ids']
    assert any('follows_from_step_ids' in e for e in validate(response))
    response['analysis']['statuses'][0]['follows_from_step_ids'] = ['s2']
    assert any('must be empty' in e for e in validate(response))
    response['analysis']['statuses'][0]['follows_from_step_ids'] = []
    response['analysis']['statuses'][0]['status'] = 'minor'
    assert any('earlier error' in e for e in validate(response))
    response['analysis']['statuses'][0]['status'] = 'error'
    response['ocr']['steps'].reverse()
    assert any('earlier error' in e for e in validate(response))


def test_causal_references_follow_step_order_not_status_array_order(response):
    response['analysis']['statuses'].reverse()
    assert validate(response) == []


def test_exact_task_ordered_sources_and_ocr_are_immutable(response):
    original = deepcopy(response)
    response['task']['statement'] = 'Changed'
    assert any('trusted task' in e for e in validate(response, task=original['task']))
    response['task'] = original['task']
    response['solution_image_ids'] = [OTHER_SOURCE_ID, SOURCE_ID]
    assert any('ordered source' in e for e in validate(response, image_ids=[SOURCE_ID, OTHER_SOURCE_ID]))
    response['solution_image_ids'] = original['solution_image_ids']
    response['ocr']['steps'][0]['lines'] = ['$AB=3$']
    assert any('unchanged reader' in e for e in validate(response, reader_ocr=original['ocr']))


def test_identity_is_type_sensitive(response):
    trusted = deepcopy(response['artifacts'])
    response['artifacts'][0]['bbox']['x'] = 0
    trusted[0]['bbox']['x'] = False
    assert any('trusted artifacts' in e for e in validate(response, artifacts=trusted))


def test_rejections_are_null_without_diagrams_and_legacy_ocr_cannot_grade(response):
    original_artifacts = deepcopy(response['artifacts'])
    response['ocr'] = 'AB = 4'
    assert any('structured OCR' in e for e in validate(response))
    response.update(is_graded=False, rejection_reason='Нечитаемое фото', ocr=None, analysis=None,
                    grading=None, artifacts=[])
    assert validate(response) == []
    response['artifacts'] = original_artifacts
    assert any('empty for rejection' in e for e in validate(response))
    response['artifacts'] = []
    response['grading'] = {'score': 0, 'criterion': '', 'explanation': ''}
    assert validate(response)


def test_legacy_math_figures_only_for_supported_algebra_packages(response):
    response['artifacts'] = []
    response['ocr']['steps'][0]['figure'] = {'kind': 'number_line', 'variable': 'x', 'note': None,
                                           'points': [], 'arcs': []}
    assert any('cropped image figure' in e for e in validate(response))
    response['task'].update(task_number=16, max_score=2)
    response['grading']['score'] = 1
    response['ocr']['steps'][0]['type'] = 'intervals'
    assert validate(response) == []


@pytest.fixture
def circle_response(response):
    response['artifacts'] = []
    response['task'].update(task_number=14, max_score=2)
    response['grading']['score'] = 1
    response['ocr']['steps'][0].update(type='other', figure={
        'kind': 'unit_circle',
        'points': [{'id': 'p1', 'value': 'π/2', 'included': True, 'sign': '+'},
                   {'id': 'p2', 'value': 'π', 'included': None, 'sign': '-', 'bound': True}],
        'arcs': [{'from': 'p1', 'to': 'p2', 'sign': '-', 'selected': True,
                  'direction': 'cw', 'full_circle': False}]})
    return response


@pytest.mark.parametrize('direction', ['cw', 'ccw'])
@pytest.mark.parametrize('full_circle', [True, False])
def test_circle_explicit_path_passes_without_modifying_original_fields(circle_response, direction, full_circle):
    arc = circle_response['ocr']['steps'][0]['figure']['arcs'][0]
    arc.update(direction=direction, full_circle=full_circle, to='p1' if full_circle else 'p2')
    before = deepcopy(circle_response)
    assert validate(circle_response) == []
    assert circle_response == before


@pytest.mark.parametrize('field,value', [
    ('direction', None), ('direction', True), ('direction', 1), ('direction', ''),
    ('direction', 'CCW'), ('direction', 'unknown'), ('direction', []), ('direction', {}),
    ('full_circle', None), ('full_circle', 0), ('full_circle', 1), ('full_circle', 0.0),
    ('full_circle', 'false'), ('full_circle', []), ('full_circle', {}),
])
def test_circle_path_types_are_strict_and_never_defaulted(circle_response, field, value):
    circle_response['ocr']['steps'][0]['figure']['arcs'][0][field] = value
    assert any(field in error for error in validate(circle_response))


@pytest.mark.parametrize('field', ['direction', 'full_circle'])
def test_circle_path_fields_are_required_at_final_boundary(circle_response, field):
    del circle_response['ocr']['steps'][0]['figure']['arcs'][0][field]
    assert any(field in error for error in validate(circle_response))


@pytest.mark.parametrize('full_circle,to', [(True, 'p2'), (False, 'p1')])
def test_circle_full_turn_must_match_endpoint_identity(circle_response, full_circle, to):
    circle_response['ocr']['steps'][0]['figure']['arcs'][0].update(full_circle=full_circle, to=to)
    assert any('endpoint IDs' in error for error in validate(circle_response))


def test_circle_new_geometry_is_bound_to_original_reader_snapshot(circle_response):
    original = deepcopy(circle_response['ocr'])
    circle_response['ocr']['steps'][0]['figure']['arcs'][0]['direction'] = 'ccw'
    assert any('unchanged reader' in error for error in validate(circle_response, reader_ocr=original))


def test_v1_circle_schema_and_number_line_loop_remain_unchanged(circle_response):
    from app.grading.expert_json import ocr_errors
    ocr = deepcopy(circle_response['ocr'])
    figure = ocr['steps'][0]['figure']
    assert ocr_errors(ocr, 14)  # V1 still forbids the new fields.
    del figure['arcs'][0]['direction']
    del figure['arcs'][0]['full_circle']
    assert ocr_errors(ocr, 14) == []
    figure.update(kind='number_line', variable='t', note='при t > 0')
    figure['arcs'][0]['to'] = figure['arcs'][0]['from']
    circle_response['ocr'] = ocr
    before = deepcopy(circle_response)
    assert validate(circle_response) == []
    assert circle_response == before
    figure['arcs'][0]['direction'] = 'cw'
    assert validate(circle_response)  # Number-line arcs did not gain circle-only fields.


def test_shared_validator_still_checks_grade_and_malformed_nested_values(response):
    for bad in (None, [], True, 99):
        candidate = deepcopy(response)
        candidate['grading']['score'] = bad
        assert validate(candidate)
    candidate = deepcopy(response)
    candidate['analysis']['errors'][0]['step_id'] = ['s1']
    assert validate(candidate)
    candidate = deepcopy(response)
    candidate['ocr']['steps'][0]['unexpected'] = 'ignored?'
    assert validate(candidate)


@pytest.mark.parametrize('suffix', ['\n', ' trailing'])
def test_exact_json_envelope_is_required(response, suffix):
    raw = json.dumps(response) + suffix
    assert validate_v2_response(raw, task=response['task'], image_ids=response['solution_image_ids'],
                                artifacts=response['artifacts'], reader_ocr=response['ocr'])


def test_duplicate_keys_and_unknown_root_members_are_rejected(response):
    response['unexpected'] = None
    assert validate(response)
    raw = json.dumps(response)
    raw = raw.replace('"is_graded": true', '"is_graded": false, "is_graded": true')
    assert any('duplicate key' in e for e in validate_v2_response(
        raw, task=response['task'], image_ids=response['solution_image_ids'],
        artifacts=response['artifacts'], reader_ocr=response['ocr']))


def test_malformed_json_types_at_each_v2_boundary_are_reported(response):
    paths = [('artifacts',), ('artifacts', 0), ('artifacts', 0, 'bbox'),
             ('ocr',), ('ocr', 'steps'), ('ocr', 'steps', 0), ('ocr', 'steps', 0, 'figure'),
             ('analysis',), ('analysis', 'statuses'), ('analysis', 'statuses', 0),
             ('analysis', 'statuses', 0, 'follows_from_step_ids')]
    for path in paths:
        for bad in (None, [], {}, True, 1, ''):
            candidate = deepcopy(response)
            target = candidate
            for part in path[:-1]:
                target = target[part]
            target[path[-1]] = bad
            assert type(validate(candidate)) is list


def test_every_nested_untrusted_type_returns_errors_without_mutating_snapshot(response):
    def positions(value, path=()):
        yield path
        if type(value) is dict:
            for key, item in value.items():
                yield from positions(item, (*path, key))
        elif type(value) is list:
            for index, item in enumerate(value):
                yield from positions(item, (*path, index))

    trusted = {'task': deepcopy(response['task']), 'image_ids': deepcopy(response['solution_image_ids']),
               'artifacts': deepcopy(response['artifacts']), 'reader_ocr': deepcopy(response['ocr'])}
    before = deepcopy(trusted)
    for path in positions(response):
        for bad in (None, [], {}, True, 1, '', float('inf'), 10 ** 500):
            candidate = deepcopy(response)
            if path:
                target = candidate
                for part in path[:-1]:
                    target = target[part]
                target[path[-1]] = bad
            else:
                candidate = bad
            errors = validate_v2_response(json.dumps(candidate), **trusted)
            assert type(errors) is list, (path, bad)
    assert trusted == before
