import hashlib
import json
import unittest
from normalize import decode_json, normalize_capture


def capture(number=4, answer='0,3'):
    return {'schemaVersion': 'botai-dom-capture.v1', 'captureMode': 'manual-dom-whitespace-normalized',
            'externalId': '123', 'examNumber': number, 'sourceUrl': 'https://3.shkolkovo.online/catalog/7776/123',
            'retrievedAt': '2026-10-05T00:00:00Z', 'question': {'Id': 123, 'QuestionTexSessionId': 11,
            'SolutionTexSessionId': 12, 'Answer': {'TexSessionId': 0, 'text': answer}, 'DifficultyId': 0},
            'texSessions': {'11': {'Html': '<p>Своя тестовая задача.</p>'}, '12': {'Html': '<p>Свое решение.</p>'}}}


def review(raw, topic='sdamgia-166'):
    return {'captureSha256': hashlib.sha256(raw).hexdigest(), 'topicId': topic, 'difficulty': 'easy',
            'difficultyBasis': 'editorial-review', 'sourceGroups': ['fipi'], 'state': 'candidate',
            'reason': 'Explicit review', 'sourceYear': None, 'originalReferences': []}


class NormalizeTests(unittest.TestCase):
    def test_exact_short_answer_and_unknown_year_survive_without_source_grade_guess(self):
        raw = json.dumps(capture()).encode()
        record, quality = normalize_capture(raw, review(raw), lambda *_: None)
        self.assertEqual(record['referenceAnswer'], '0,3')
        self.assertEqual(record['acceptedAnswers'], ['0,3'])
        self.assertIsNone(record['sourceYear'])
        self.assertEqual(quality['sourceDifficultyId'], 0)
        self.assertEqual(quality['difficultyBasis'], 'editorial-review')
        self.assertNotIn('referenceAnswer', record['content'][0])

    def test_missing_short_answer_and_changed_capture_are_not_published(self):
        raw = json.dumps(capture(answer='')).encode()
        with self.assertRaises(ValueError):
            normalize_capture(raw, review(raw), lambda *_: None)
        raw = json.dumps(capture()).encode()
        with self.assertRaises(ValueError):
            normalize_capture(raw, {**review(raw), 'captureSha256': 'old'}, lambda *_: None)

    def test_duplicate_json_keys_and_nonfinite_values_rejected(self):
        for raw in [b'{"a":1,"a":2}', b'{"a":NaN}']:
            with self.assertRaises(ValueError):
                decode_json(raw)


if __name__ == '__main__':
    unittest.main()
