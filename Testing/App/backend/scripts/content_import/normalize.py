"""Normalize a captured public task only with capture-bound editorial classification."""
from __future__ import annotations
import hashlib
import json
from classification import validate_review
from html_parser import parse_html, plain_projection
from transport import validate_provider_url

PERMISSION = 'user-grant-2026-10-05-shkolkovo-named-groups'


def decode_json(data):
    def object_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate source JSON key')
            result[key] = value
        return result
    if len(data) > 1024 * 1024:
        raise ValueError('Capture byte budget')
    return json.loads(data.decode('utf-8'), object_pairs_hook=object_pairs,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite source JSON')))


def normalize_capture(data, review, resolver):
    capture = decode_json(data)
    if capture.get('schemaVersion') != 'botai-dom-capture.v1' or capture.get('captureMode') != 'manual-dom-whitespace-normalized':
        raise ValueError('Unsupported source capture adapter')
    validate_provider_url(capture['sourceUrl'])
    number = capture['examNumber']
    identity = capture['externalId']
    question = capture['question']
    if str(question['Id']) != identity or not identity.isascii() or not identity.isdigit() or question.get('IsPrivate') or question.get('IsDeactivated'):
        raise ValueError('Invalid/public task identity')
    topic = validate_review(number, review, hashlib.sha256(data).hexdigest())
    sessions = capture['texSessions']
    condition = parse_html(sessions[str(question['QuestionTexSessionId'])]['Html'], question['QuestionTexSessionId'], resolver, 'statement')
    solution = parse_html(sessions[str(question['SolutionTexSessionId'])]['Html'], question['SolutionTexSessionId'], resolver, 'reference')
    answer = question['Answer']
    answer_content = None
    answer_assets = []
    if answer.get('TexSessionId'):
        parsed = parse_html(sessions[str(answer['TexSessionId'])]['Html'], answer['TexSessionId'], resolver, 'reference')
        answer_content = parsed.blocks
        answer_assets = parsed.asset_ids
        reference_answer = None if parsed.asset_ids else plain_projection(parsed.blocks)
    else:
        reference_answer = answer.get('text')
    if number <= 13 and (not isinstance(reference_answer, str) or not reference_answer.strip() or len(reference_answer) > 2000):
        raise ValueError('Short-answer source must provide an exact bounded literal answer')
    if number > 13 and (reference_answer is None or not isinstance(reference_answer, str) or not reference_answer.strip()) and not answer_content:
        raise ValueError('Extended answer must be complete')
    statement, reference_solution = plain_projection(condition.blocks), plain_projection(solution.blocks)
    if len(statement) > 16000 or len(reference_solution) > 32000 or (reference_answer is not None and len(reference_answer) > 16000):
        raise ValueError('Normalized text budget')
    result = {
        'schemaVersion': 'botai-content.v1', 'provider': 'shkolkovo', 'externalId': identity,
        'formatId': 'ege-profile-20-v1', 'examNumber': number, 'topicIds': [topic],
        'difficulty': review['difficulty'], 'sourceYear': review.get('sourceYear'),
        'content': condition.blocks, 'statement': statement, 'referenceAnswer': reference_answer,
        'referenceSolution': reference_solution, 'referenceContent': solution.blocks,
        'acceptedAnswers': [reference_answer] if number <= 13 else [],
        'provenance': {'sourceUrl': capture['sourceUrl'], 'sourceGroups': review['sourceGroups'],
                       'originalPublisher': None, 'originalReferences': review['originalReferences'],
                       'permissionRef': PERMISSION, 'mappingRevision': 'manual-pilot-method-review-v1',
                       'retrievedAt': capture['retrievedAt'],
                       'extractorVersion': 'manual-dom-whitespace-normalized.v1/ordered-parser.v1'},
    }
    if answer_content is not None:
        result['referenceAnswerContent'] = answer_content
    completeness = {'externalId': identity, 'reviewState': review['state'],
                    'captureSha256': hashlib.sha256(data).hexdigest(), 'captureMode': capture['captureMode'],
                    'statementFormulas': condition.formula_count, 'statementFigures': condition.figure_count,
                    'solutionFormulas': solution.formula_count, 'solutionFigures': solution.figure_count,
                    'assetIds': sorted(set(condition.asset_ids + solution.asset_ids + answer_assets)),
                    'difficultyBasis': review['difficultyBasis'], 'sourceDifficultyId': question.get('DifficultyId'),
                    'methodReason': review['reason'], 'hasObjectReplacement': '\ufffc' in statement or '\ufffc' in reference_solution,
                    'criteriaCaptured': str(question.get('GradeCriteriaTexSessionId')) in sessions}
    return result, completeness
