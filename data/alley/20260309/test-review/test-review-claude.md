# Darkcat Review: Test Quality Assessment — bin/test_triangulate.py

**Reviewer: Claude (claude-opus-4-6)**
**Date: 2026-03-09**

---

## Section 1: Narrative Report

### Overall Assessment

The test suite is structurally competent. 89 tests across 14 test classes cover the major public surface of `bin/triangulate`. The fixtures are well-designed, the bug documentation tests are a genuinely valuable pattern, and the test organisation mirrors the code's logical sections. This is substantially better than zero coverage.

But "substantially better than zero" is not the same as "trustworthy," and the gap between the two is where the interesting findings live.

### 1. The Bug Documentation Tests: Good Pattern, Weak Execution

The suite claims to document 8 known bugs. This is the highest-value part of the test file — regression detectors for known defects. But several of these tests have a critical structural problem: **they assert the buggy behaviour, not the correct behaviour**. This means they will *break* when the bug is *fixed*, rather than catching regressions if the bug *returns*.

Consider `test_converged_2plus_n2_double_count_bug` (line 502). The test asserts `cr["rate_2plus"] == 1.0` with a comment saying this is the bug. The EXPECTED comment says the correct value should be 0.5. But the assertion checks for 1.0 — the wrong value. When someone fixes the double-count bug, this test will fail with `0.5 != 1.0`, and the developer will have to read the docstring to understand this is expected. This is not a regression test — it is a snapshot of current broken behaviour dressed up as a regression test.

The same pattern repeats in `test_converged_2plus_n4_misses_intermediate_bug` (asserts `rate_2plus == 0` when it should be 1.0), `test_dangling_flag_at_end_bug` (asserts `"--out" in files` when it should error), and `test_boolean_flag_swallows_next_arg_bug` (asserts the buggy parsing result).

The proper pattern for documenting known bugs is either:
- `pytest.mark.xfail` with the *correct* assertion (test is expected to fail until the bug is fixed, then passes automatically), or
- A comment block with no assertion on the buggy value, asserting only the invariants that should hold regardless.

As written, these tests create a **maintenance trap**: fixing the bug causes test failures, which feels like regression, which discourages the fix.

### 2. The `match_confidence` Spanning Tree Bug Test Cannot Detect the Bug

`test_match_confidence_spanning_tree_bug` (line 634) claims to document a bug where match_confidence averages N-1 spanning-tree edges instead of N*(N-1)/2 pairwise scores. But the test uses three *identical* findings, where every pairwise score is ~1.0. The average of two 1.0 scores is 1.0. The average of three 1.0 scores is also 1.0. **The test cannot distinguish between the buggy and correct implementations.**

The docstring even acknowledges this: "the bug only manifests when scores differ across pairs." But the test uses identical data anyway. To actually demonstrate this bug, the test would need three findings where pairwise similarities differ (e.g., A-B = 0.9, A-C = 0.8, B-C = 0.6), then show that the match_confidence reflects only two of the three scores.

This is a textbook **right-answer-wrong-work** pattern: the assertion passes, the test name claims to verify the bug, but the causal path that produces the passing assertion has nothing to do with the bug being documented.

### 3. The `test_n2_display_bug_from_double_count` Bug Test: Phantom Verification

This test (line 978) documents a cascading display bug. The assertion checks `assert "100.0%" in output`. The docstring explains this is "coincidentally correct looking (100%) but computed wrong." The test literally verifies that the output *looks correct* while claiming the computation is wrong. This test will pass whether the bug exists or not — it passes today because the wrong computation produces the right-looking output, and it will pass after the fix because the right computation also produces 100.0%.

This is a **paper guardrail**: it performs the ceremony of verification without actually constraining behaviour.

### 4. The `test_cmd_metrics_does_not_use_multiline_dumper` Source Inspection Test

This test (line 1149) uses `inspect.getsource()` to check that `cmd_metrics` calls `yaml.dump` directly. This is clever, but it tests **implementation details** rather than **behaviour**. If someone refactors `cmd_metrics` to call a helper function that still bypasses `MultilineDumper`, the test breaks even though the bug persists. Conversely, if someone inlines `write_yaml`'s logic into `cmd_metrics` using `yaml.dump` with a custom Dumper, the test still passes (it looks for "yaml.dump" in source) even though the bug is fixed.

The correct test would call `cmd_metrics` with data containing long strings and verify the output format.

### 5. Module-Level Loading: Shared Mutable State Risk

`tri = load_triangulate()` at line 36 (module level) executes the triangulate script's module body once, at import time. This is a test isolation concern. If `bin/triangulate` had any module-level mutable state (it currently doesn't, but it imports `yaml` and `sys`), all tests would share it. The `io` and `textwrap` imports in the test file are unused, suggesting copy-paste from a template.

### 6. Coverage Gaps

The following functions have **zero test coverage**:

- **`load_reviews()`** — The function that ties together `parse_review_file` and `validate_review` for multi-file loading. No test verifies the `sys.exit(1)` path when fewer than 2 files are provided, or the stderr warning output.
- **`cmd_summary()`**, **`cmd_convergence()`**, **`cmd_export()`**, **`cmd_parse()`** — None of the CLI command handlers are tested as integrated units. The tests cover the underlying functions (`format_summary`, `format_convergence_matrix`, `export_all`) but never the command dispatch that parses args, loads files, and calls them.
- **`main()`** — The CLI entrypoint with command dispatch is untested. Unknown commands, `--help`, and the no-args path are not verified.
- **`usage()`** — Calls `sys.exit(1)`, never tested.
- **`export_all()` file content verification** — `test_creates_expected_files` checks file existence but never verifies the *contents* of `convergence.yaml`, `metrics.yaml`, or `findings-union.yaml`. The `metadata.yaml` content is checked only for `run_id`.

### 7. Missing Negative Tests

- No test verifies that `validate_finding` handles extra/unexpected fields gracefully (or at all — it doesn't; it only checks for missing fields).
- No test for `extract_yaml_block` with a YAML block containing `findings: null` (would `None` pass the `isinstance(parsed, dict)` check? Yes, but `"findings" in parsed` would succeed and return `{"findings": null}`, which would then fail downstream).
- No test for `match_findings` with findings containing missing `file` or `title` keys (the code uses `.get("file", "")` which handles it, but this is untested).
- No test for `compute_metrics` with an empty `review_ids` list (division by zero in `n_perms`, empty permutations).
- No test for `format_summary` with `n_reviews >= 3` path (the `"All {n_reviews} models"` line is only shown for 3+ reviews; the only N=3 test is in `TestComputeMetrics`, not `TestFormatSummary`).

### 8. Fixture Quality

`_make_finding()` and `_make_review_yaml()` are correctly implemented and produce valid structures. However, `_make_finding()` defaults `line` to integer `42` while the schema validation only checks that string fields are strings — it never validates that `line` is a string. Looking at the review instructions, `line` is specified as `"<line range>"` (a string), but the fixture uses an integer. This could mask a type mismatch bug in downstream consumers that expect `line` to be a string.

`_make_reviews_data()` creates reviews with `"findings": []`, meaning the `reviews_data` passed to `compute_metrics` in most tests has no findings attached to the review metadata — only the pre-built `groups` have findings. This is architecturally correct for how `compute_metrics` works (it reads from groups, not from reviews_data), but it means the fixture would silently produce wrong results if `compute_metrics` ever changed to read findings from `reviews_data` instead.

### Summary of Concern

The test suite has good structural coverage of the happy paths but systematically fails at the places where tests provide the most value: bug regression detection, negative/error paths, and CLI integration. The bug documentation tests are the most concerning — they look authoritative but several cannot detect the bugs they claim to document, and others will actively interfere with bug fixes by failing when the fix is applied.

---

## Section 2: Structured Findings

```yaml
review:
  model: "claude-opus-4-6"
  date: "2026-03-09"
  branches:
    - "main"
  base_commit: "c1a43ce"
findings:
  - id: F-001
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "502-546"
    severity: high
    watchdog: WD-PL
    slopodar: phantom-ledger
    title: "Bug-doc tests assert buggy values instead of using xfail with correct values"
    description: >
      test_converged_2plus_n2_double_count_bug, test_converged_2plus_n4_misses_intermediate_bug,
      test_dangling_flag_at_end_bug, and test_boolean_flag_swallows_next_arg_bug all assert
      the buggy output value (e.g. rate_2plus == 1.0) with a comment saying the correct value
      is different (0.5). These tests will BREAK when the bugs are FIXED, creating a maintenance
      trap that discourages fixes. They should use pytest.mark.xfail with the correct assertion,
      so they automatically pass when the bug is fixed and fail (xfail) while it persists.
    recommendation: "Convert to xfail tests asserting the correct expected value, with reason strings documenting the bug."

  - id: F-002
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "634-662"
    severity: high
    watchdog: WD-LRT
    slopodar: right-answer-wrong-work
    title: "match_confidence spanning tree bug test uses identical data, cannot distinguish buggy from correct"
    description: >
      The test uses three identical findings where all pairwise scores are ~1.0.
      The average of N-1 scores of 1.0 equals the average of N*(N-1)/2 scores of 1.0.
      The test passes regardless of whether the code averages 2 or 3 scores, making it
      unable to detect the bug it claims to document. The docstring acknowledges this
      limitation but proceeds with the useless assertion anyway.
    recommendation: "Use three findings with distinct pairwise similarities (e.g., A-B=0.9, A-C=0.7, B-C=0.5) and assert the confidence reflects the spanning-tree average vs the all-pairs average."

  - id: F-003
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "978-1017"
    severity: high
    watchdog: WD-PG
    slopodar: paper-guardrail
    title: "N=2 display bug test asserts output that looks correct under both buggy and fixed code"
    description: >
      test_n2_display_bug_from_double_count asserts '100.0%' appears in the output.
      The docstring explains this is coincidentally correct-looking despite wrong computation.
      The test will pass identically after the bug is fixed (correct computation also produces
      100% for a single all-converged group). The assertion constrains nothing about the
      bug's presence or absence.
    recommendation: "Test with a scenario where the buggy and correct outputs differ visually (e.g., 2 groups, 1 converged — buggy shows 100%, correct shows 50%), or verify the underlying metric values instead of string output."

  - id: F-004
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "1149-1158"
    severity: medium
    watchdog: WD-LRT
    slopodar: shadow-validation
    title: "Source inspection test checks implementation text, not behaviour"
    description: >
      test_cmd_metrics_does_not_use_multiline_dumper uses inspect.getsource() to check
      for string literals in the source code. This couples the test to implementation details.
      A refactor that preserves the bug (e.g., extracting yaml.dump to a helper) would break
      the test. A fix that still contains 'yaml.dump' in source (e.g., yaml.dump with custom
      Dumper) would pass the test despite the fix.
    recommendation: "Test behaviour: capture stdout from cmd_metrics with data containing 200+ char strings, verify block scalar formatting is absent (documenting the bug) or present (after fix)."

  - id: F-005
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "1-1397"
    severity: high
    watchdog: WD-CB
    slopodar: shadow-validation
    title: "Zero coverage of CLI command handlers (cmd_parse, cmd_summary, cmd_metrics, cmd_convergence, cmd_export)"
    description: >
      None of the five CLI command handler functions are tested as integrated units.
      load_reviews(), main(), and usage() are also untested. These functions contain
      sys.exit() calls, stderr output, threshold parsing, and file I/O integration
      that the unit tests of underlying functions cannot verify. The command dispatch
      in main() is completely uncovered — unknown commands, help flags, and the
      no-args path are not tested.
    recommendation: "Add integration tests using tmp_path for file I/O and capsys/monkeypatch for sys.exit and stderr capture. Test at least: valid 2-file summary, invalid command, missing files, --help."

  - id: F-006
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "1098-1134"
    severity: medium
    watchdog: WD-SH
    slopodar: shadow-validation
    title: "write_yaml block style test asserts '|' in raw, which matches YAML pipe characters everywhere"
    description: >
      test_uses_block_style_for_multiline_strings and test_uses_block_style_for_newline_strings
      assert that '|' appears in the raw YAML output. The pipe character '|' could appear in
      other YAML contexts (e.g., as part of data values, in comments, or in flow notation).
      The assertion is weak — it checks for the presence of a single character, not that the
      specific string was rendered as a block scalar. For the current simple test data this
      happens to work, but it would produce false positives with more complex YAML.
    recommendation: "Assert a more specific pattern like the key followed by block indicator: 'description: |' or verify the string does NOT appear on a single inline line."

  - id: F-007
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "36"
    severity: low
    watchdog: WD-DC
    slopodar: none
    title: "Module-level load_triangulate() executes at import time; unused imports (io, textwrap)"
    description: >
      tri = load_triangulate() at module level means the triangulate module body executes
      once at import, before any test runs. If the module ever gains side effects (e.g.,
      argument parsing at module level), all tests would be affected. Additionally, 'io'
      and 'textwrap' are imported but never used in the test file.
    recommendation: "Move module loading to a session-scoped fixture. Remove unused imports."

  - id: F-008
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "1326-1376"
    severity: medium
    watchdog: WD-CB
    slopodar: shadow-validation
    title: "export_all tests check file existence but not file contents"
    description: >
      test_creates_expected_files verifies 6 output files exist but never reads their
      contents to verify correctness. Only metadata.yaml is checked for run_id.
      convergence.yaml, metrics.yaml, and findings-union.yaml could contain wrong
      data or malformed YAML and the tests would still pass.
    recommendation: "Add content assertions: load each exported YAML file, verify key structure and values match the input groups/metrics."

  - id: F-009
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "1174-1199"
    severity: medium
    watchdog: WD-PL
    slopodar: phantom-ledger
    title: "Docstring mismatch test cannot produce a scenario where greedy fails but bipartite succeeds"
    description: >
      test_implementation_is_greedy_no_merge uses identical findings across all three reviews.
      The docstring acknowledges the greedy algorithm works for this case. The test never
      constructs a scenario where the greedy algorithm produces a suboptimal grouping that
      true bipartite matching would handle correctly. Without such a scenario, the test
      documents a theoretical concern but provides no evidence the bug has practical impact.
    recommendation: "Construct findings where greedy order causes R2-A and R3-A to be placed in separate groups before R1-A arrives (e.g., slightly different titles with carefully chosen similarity scores around the threshold)."

  - id: F-010
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "42-57"
    severity: medium
    watchdog: WD-LRT
    slopodar: none
    title: "_make_finding defaults line to integer 42, but schema examples show line as string"
    description: >
      The review instructions specify line as '<line range>' (a string), and validate_finding
      does not check the type of 'line'. _make_finding uses line=42 (integer). If any downstream
      consumer expects line to be a string (e.g., for display or YAML output), this type mismatch
      would be masked by the fixture. All tests use integer line values as a result.
    recommendation: "Change _make_finding default to line='42' or line='40-45' to match the schema's string expectation. Add a validate_finding test for integer line values."

  - id: F-011
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "966-1091"
    severity: medium
    watchdog: WD-CB
    slopodar: none
    title: "No format_summary test exercises the N>=3 code path"
    description: >
      format_summary has a branch at line 638-639 that only executes when n_reviews >= 3,
      printing the 'All N models' line. TestFormatSummary only tests N=2 scenarios.
      The N=3 path is exercised in TestComputeMetrics but never through format_summary,
      meaning the display formatting of 3-way convergence is untested.
    recommendation: "Add a TestFormatSummary test with 3 review IDs and verify the 'All 3 models' line appears with correct count and percentage."

  - id: F-012
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "1-1397"
    severity: medium
    watchdog: WD-CB
    slopodar: none
    title: "No negative tests for compute_metrics edge cases (empty review_ids, empty groups)"
    description: >
      compute_metrics is never tested with empty review_ids (which would cause division
      by zero in n_perms = len(all_marginals) since permutations([]) yields one empty tuple)
      or with groups containing findings whose severity is not in SEVERITY_ORDINAL (the code
      defaults to ordinal 1 via .get(), but this behaviour is unverified).
    recommendation: "Add edge case tests: empty review_ids, groups with unknown severity values, groups where matched_findings keys don't match convergence list."

  - id: F-013
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "597-630"
    severity: low
    watchdog: WD-PL
    slopodar: phantom-ledger
    title: "N=4 bug test claims 'Gemini, HIGH' attribution but only tests the metric, not a 4-review scenario end-to-end"
    description: >
      test_converged_2plus_n4_misses_intermediate_bug manually constructs groups for N=4
      and passes them to compute_metrics. It never runs match_findings with 4 reviews to
      verify that the matching algorithm produces such groups. The bug is demonstrated at
      the metrics layer but the test doesn't prove the full pipeline produces the problematic
      scenario.
    recommendation: "Add a companion test that runs match_findings with 4 reviews and verifies that intermediate-convergence groups (3 of 4) exist, then checks that compute_metrics misreports them."

  - id: F-014
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "1264-1273"
    severity: low
    watchdog: WD-LRT
    slopodar: none
    title: "Empty title/file edge case test relies on SequenceMatcher('','') == 1.0, which is a library quirk not a correctness property"
    description: >
      test_empty_titles_and_files asserts that two findings with empty title and file strings
      match, because SequenceMatcher returns 1.0 for identical empty strings. This tests a
      quirk of Python's difflib rather than intended application behaviour. Two findings with
      no title and no file being grouped together is arguably wrong — they have no positive
      evidence of being the same finding.
    recommendation: "Document that this is testing current behaviour (not desired behaviour). Consider whether match_findings should treat empty strings as non-matchable."
```

---

*Review complete. 14 findings: 3 high, 8 medium, 3 low.*
