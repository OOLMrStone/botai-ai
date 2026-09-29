# Live deployment smoke check — 29 September 2026

One explicitly user-authorized grading API request, no retry, for FIPI case `15.1.1` (project task 16). The input was the original task/reference-answer image plus one student solution photograph; the hidden expected score was used only for comparison after the response.

- Model: `deepseek-v4-flash`, live OpenAI-compatible provider on the existing server, reached over an SSH tunnel.
- HTTP 200, `is_graded=true`, score **2/2**, expected **2/2**.
- Exact response validation passed; elapsed **87.333 seconds**.
- Request ID: `req_66e0c54864854629`.
- No additional grading requests, no automatic repeats. One service request includes its normal internal preparation and tool conversation.

This verifies that the deployed service still returns a valid live result after reorganization; it is not a new accuracy estimate. Existing September 27 evaluation statistics remain unchanged. Full response and images remain locally in ignored `output/evals/20260929-github-smoke/`. Historical run metadata records the temporary local tunnel endpoint.

## Repository verification before push

The exact staged source tree was exported to a separate directory without ignored local files. Its offline suite passed: **365 passed, 3 skipped**. Both eval loaders were exercised in dry-run mode (21 FIPI and 19 locally available Kostyan cases); preprocessing and HTML report rendering were also verified offline. All 70 deployed payload files match their corresponding staged source files. Secrets, private tutor images and raw run outputs are excluded from the commit.
