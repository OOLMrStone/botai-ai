#!/usr/bin/env python3
"""Record reviewed mock build image IDs for later live switching; never starts services."""
import argparse
import json
from common import RUNTIME, assert_isolated, assert_local_docker
from provenance import verify_proof, running_ids, write_state

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--accepted-ai-head', required=True)
parser.add_argument('--accepted-backend-source-sha256', required=True)
parser.add_argument('--security-reviewed', action='store_true', required=True,
                    help='Use only after root/security acceptance and mock HTTP checks')
args = parser.parse_args()
assert_isolated()
assert_local_docker()
proof = verify_proof(json.loads((RUNTIME / 'build-proof.json').read_text()))
if (proof['aiHead'] != args.accepted_ai_head
        or proof['backendSourceSha256'] != args.accepted_backend_source_sha256
        or running_ids() != proof['images']):
    raise SystemExit('Reviewed source/head/actual image IDs differ; build not accepted')
proof['securityReviewed'] = True
write_state(RUNTIME / 'accepted-build.json', proof)
print('Accepted immutable AI/backend/renderer image IDs recorded; no runtime/model action.')
