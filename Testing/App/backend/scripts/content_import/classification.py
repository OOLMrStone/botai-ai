"""Explicit reviewed taxonomy; source memberships are candidates, never final guesses."""
from __future__ import annotations
import re
import unicodedata

LEGACY = {
    1: [79,90,96,102,94,111,112,113,114], 2: [182], 3: [192,193,180,148,140,178,177,197,194,144,151],
    4: [166], 5: [185], 6: [130], 7: [14,9,10,11,12,13], 8: [55,60,57,62,56,61,58,63,65,59,64],
    9: [69,68,70,183], 10: [71,72,76,77,73,74,75,184], 11: [88,84,85,86,87,89],
    12: [267,294,125,122,272,191,296], 13: [334,332], 14: [330,290,275,186,167,302,291,202,306,201,303,304,305],
    15: [280,281,307,282,308,309,283,311,284,285,257,310,206,331],
    16: [243,242,237,320,238,318,239,313,319,315,245,314,316,244,317], 17: [333],
    18: [276,321,277,278,322,323,279,325,326,324], 19: [171,328,327,270,268,207,273,208,274,329,271,266,269,235],
}
TOPICS_20 = ('divisibility', 'integer-equations', 'digits', 'sequences', 'invariants', 'extrema')
TOPICS = {number: {f'sdamgia-{identity}' for identity in ids} for number, ids in LEGACY.items()}
TOPICS[20] = {f'botai-20-{name}' for name in TOPICS_20}
SOURCE_GROUPS = {'past-ege', 'fipi', 'statgrad', 'egkr', 'yashchenko'}


def validate_review(exam_number, review, capture_hash):
    if type(exam_number) is not int or exam_number not in TOPICS:
        raise ValueError('Unknown exam position')
    if review.get('captureSha256') != capture_hash:
        raise ValueError('Method review belongs to another source capture')
    if review.get('topicId') not in TOPICS[exam_number]:
        raise ValueError('Reviewed topic is not current for this position')
    if review.get('difficulty') not in {'easy', 'medium', 'hard'} or review.get('difficultyBasis') != 'editorial-review':
        raise ValueError('Unknown source difficulty requires an explicit editorial review')
    groups = review.get('sourceGroups')
    if not isinstance(groups, list) or not groups or len(set(groups)) != len(groups) or set(groups) - SOURCE_GROUPS:
        raise ValueError('Only named verified source groups are allowed')
    if review.get('state') not in {'candidate', 'approved'} or not review.get('reason'):
        raise ValueError('Method review state/reason required')
    return review['topicId']


def normalized_title(value):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', value).replace('\u00ad', '').replace('ё', 'е').lower()).strip()


def method_candidates(source_themes, canonical_titles):
    """Exact metadata-title match provides evidence for human review, not auto-publication."""
    candidates = set()
    for theme in source_themes.values():
        title = normalized_title(theme.get('Name', ''))
        for identity, canonical in canonical_titles.items():
            if title and title == normalized_title(canonical):
                candidates.add(identity)
    return sorted(candidates)
