import unittest
from classification import TOPICS, method_candidates, validate_review


class ClassificationTests(unittest.TestCase):
    def review(self, topic='sdamgia-111'):
        return {'captureSha256': 'hash', 'topicId': topic, 'difficulty': 'easy', 'difficultyBasis': 'editorial-review',
                'sourceGroups': ['fipi', 'past-ege'], 'state': 'candidate', 'reason': 'Decisive inscribed angles'}

    def test_current_taxonomy_count_and_legacy_exclusion(self):
        self.assertEqual(sum(map(len, TOPICS.values())), 141)
        self.assertEqual(TOPICS[5], {'sdamgia-185'})
        self.assertEqual(len(TOPICS[20]), 6)

    def test_wrong_position_unreviewed_difficulty_changed_capture_rejected(self):
        self.assertEqual(validate_review(1, self.review(), 'hash'), 'sdamgia-111')
        for number, review, digest in [(4, self.review(), 'hash'), (1, self.review(), 'other'),
                                       (1, {**self.review(), 'difficultyBasis': 'provider-zero'}, 'hash'),
                                       (1, {**self.review(), 'sourceGroups': ['author']}, 'hash')]:
            with self.subTest(number=number, review=review), self.assertRaises(ValueError):
                validate_review(number, review, digest)

    def test_source_memberships_are_candidate_evidence_not_decisive_mapping(self):
        source = {'60': {'Name': 'Окружность, описанная около многоугольника'}}
        self.assertEqual(method_candidates(source, {'sdamgia-114': 'Описанные окружности'}), [])
        self.assertEqual(validate_review(1, self.review(), 'hash'), 'sdamgia-111')


if __name__ == '__main__':
    unittest.main()
