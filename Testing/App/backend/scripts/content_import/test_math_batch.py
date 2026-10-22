"""Exercise the importer stdin protocol when the local Node/KaTeX runtime exists."""
import json
from pathlib import Path
import shutil
import subprocess
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
NODE = shutil.which('node')
KATEX = ROOT.parent / 'botai-front/node_modules/katex/package.json'


@unittest.skipUnless(NODE and KATEX.exists(), 'local Node/KaTeX unavailable')
class MathBatchEncodingTest(unittest.TestCase):
    def test_utf8_character_split_across_stdin_chunks(self):
        payload = json.dumps([{'value': r'\text{метр}', 'displayMode': False}], ensure_ascii=False).encode()
        split = payload.index('м'.encode()) + 1
        process = subprocess.Popen(
            [NODE, str(ROOT / 'scripts/content_import/validate-math.mjs')],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            env={'BOTAI_KATEX_PACKAGE': str(KATEX), 'BOTAI_KATEX_BATCH': 'true'})
        try:
            process.stdin.write(payload[:split])
            process.stdin.flush()
            time.sleep(0.1)
            process.stdin.write(payload[split:])
            process.stdin.close()
            self.assertEqual(process.wait(timeout=5), 0)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


if __name__ == '__main__':
    unittest.main()
