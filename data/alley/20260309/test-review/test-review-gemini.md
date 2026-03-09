# Darkcat Review: Test Quality Assessment — bin/test_triangulate.py

### Section 1: Narrative Report (human-readable)

The test suite for `bin/triangulate` achieves significant structural coverage but suffers from critical methodological flaws that undermine its value as a regression safety net. The most severe issue is the pattern of asserting known broken behavior to "document" bugs, which actively cements those defects into the codebase. 

Key findings:

1. **Cementing Bugs via Asserting Broken State (Critical)**: Multiple tests designed to document known bugs (e.g., `test_converged_2plus_n2_double_count_bug`, `test_match_diagnostics_hardcodes_threshold_bug`, and CLI parser bug tests) assert the *broken* output rather than asserting the *expected* output. This effectively locks the bug into the codebase. If a developer fixes `bin/triangulate`, these tests will fail, penalizing the fix and potentially leading to the fix being reverted to make the tests pass. These tests should assert the correct behavior and use `@pytest.mark.xfail`.
2. **Phantom Ledger in Spanning Tree Bug Test (High)**: `test_match_confidence_spanning_tree_bug` claims to demonstrate that the algorithm incorrectly averages `N-1` spanning tree edges instead of `N*(N-1)/2` edges. However, it provides three identical findings with a pairwise similarity of exactly 1.0. Because the average of two 1.0s is 1.0 and three 1.0s is 1.0, the test passes whether the bug is present or fixed, failing to detect the defect it claims to document.
3. **Semantic Hallucination in Greedy Algorithm Test (High)**: `test_implementation_is_greedy_no_merge` claims to prove that the greedy algorithm fails to merge groups optimally. However, the test data uses identical findings that successfully merge into a single 3-way group, and the test explicitly asserts this success (`len(three_way) == 1`). The test demonstrates the exact opposite of its title.
4. **Looks Right Trap / Implementation Testing (Medium)**: `TestCmdMetricsBypassBug` uses `inspect.getsource(tri.cmd_metrics)` to check if the string `"yaml.dump"` is in the source code. Behavioral tests should capture `sys.stdout` and inspect the output string instead of reading the target module's source code text, which is extremely fragile.
5. **Coverage Gaps in Metrics and CLI (High)**: The tests for `compute_metrics` entirely skip testing the `false_positive_rate` and `watchdog_distribution` metrics. Additionally, there are zero tests for the CLI command handler functions (`cmd_parse`, `cmd_summary`, `cmd_metrics`, etc.) and the main entrypoint.
6. **Shadow Validation in Export Tests (High)**: `TestExportAll` only verifies that the export files are created on disk. It completely skips validating the contents of these files (`findings-union.yaml`, `convergence.yaml`, etc.), missing the opportunity to verify the complex data transformations.

### Section 2: Structured Findings (machine-readable)

```yaml
review:
  model: "gemini-3.1-pro-preview"
  date: "2026-03-09"
  branches:
    - "main"
  base_commit: "c1a43ce"
findings:
  - id: F-001
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "1705-1733"
    severity: high
    watchdog: WD-PL
    slopodar: phantom-ledger
    title: "Spanning tree bug test uses identical findings, masking the bug"
    description: >
      `test_match_confidence_spanning_tree_bug` claims to document a bug where the match confidence calculation averages N-1 edges instead of all N*(N-1)/2 pairs.
      However, it provides three identical findings with similarity 1.0. Because the average of two 1.0s is 1.0 and three 1.0s is 1.0, the test will pass whether the bug is present or fixed.
    recommendation: "Change the test fixture findings to have varying similarities so that the average of the spanning tree edges (N-1) differs mathematically from the average of all pairs. Assert that the computed confidence is mathematically correct or mathematically incorrect to actually catch the bug."

  - id: F-002
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "2208-2230"
    severity: medium
    watchdog: WD-LRT
    slopodar: right-answer-wrong-work
    title: "Command metrics bug test uses inspect.getsource instead of testing behavior"
    description: >
      `TestCmdMetricsBypassBug` uses `inspect.getsource(tri.cmd_metrics)` to verify that `"yaml.dump"` is in the source code string.
      This is a fragile implementation-coupling test that tests syntax rather than behavior.
    recommendation: "Refactor the test to mock/patch `sys.stdout`, call `cmd_metrics`, and assert that the generated YAML output string lacks the multiline block scalar format (`|`) to prove it bypassed the custom dumper."

  - id: F-003
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "2237-2270"
    severity: high
    watchdog: WD-SH
    slopodar: phantom-ledger
    title: "Greedy algorithm test asserts success while claiming to test failure"
    description: >
      `test_implementation_is_greedy_no_merge` claims to document a bug where the greedy algorithm fails to merge findings optimally.
      However, the test uses identical findings that *do* successfully merge, and it actively asserts `len(three_way) == 1` (which means they merged perfectly). The test proves the opposite of its name.
    recommendation: "Change the test inputs to a scenario that actually forces the greedy algorithm to make a suboptimal choice (e.g., where a bridge finding connects two groups but gets consumed too early). Then assert the suboptimal output."

  - id: F-004
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "1573-1616"
    severity: critical
    watchdog: WD-PG
    slopodar: right-answer-wrong-work
    title: "Bug documentation tests cement defects by asserting broken output"
    description: >
      Several tests that document bugs (e.g., `test_converged_2plus_n2_double_count_bug`, `test_match_diagnostics_hardcodes_threshold_bug`, CLI parsing bugs) assert the buggy output as the expected outcome (e.g., `assert cr['rate_2plus'] == 1.0` when it should be 0.5).
      This locks the defect into the codebase. If a developer fixes the bug, the test will fail, heavily penalizing the fix.
    recommendation: "Change these tests to assert the *correct* (fixed) behavior, and decorate them with `@pytest.mark.xfail(reason='Bug: ...')`. This correctly documents the defect while allowing a future fix to pass."

  - id: F-005
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "2396-2431"
    severity: high
    watchdog: WD-CB
    slopodar: shadow-validation
    title: "Export tests only verify file creation, not file content"
    description: >
      `TestExportAll.test_creates_expected_files` verifies that export files like `findings-union.yaml` and `convergence.yaml` are created using `.exists()`.
      It completely skips validating the contents of these files, which are generated using complex deduplication and transformation logic.
    recommendation: "Read the generated files (e.g., via `yaml.safe_load`) and assert that their structures and values match the expected output data."

  - id: F-006
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "1562-1953"
    severity: high
    watchdog: WD-CB
    slopodar: shadow-validation
    title: "Complete coverage gap for watchdog_distribution and false_positive_rate"
    description: >
      `TestComputeMetrics` extensively tests most metric outputs but completely omits testing the `watchdog_distribution` and `false_positive_rate` metrics computed by `compute_metrics`.
    recommendation: "Add tests in `TestComputeMetrics` to verify that `watchdog_distribution` accurately counts watchdog categories and that `false_positive_rate` outputs its pending adjudication structure."

  - id: F-007
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "2473"
    severity: high
    watchdog: WD-CB
    slopodar: shadow-validation
    title: "No tests for CLI command handlers"
    description: >
      While helper functions and the argument parser are tested, the actual CLI command entrypoints (`cmd_parse`, `cmd_summary`, `cmd_metrics`, `cmd_convergence`, `cmd_export`, `load_reviews`, and `main`) have zero test coverage.
    recommendation: "Add integration tests that patch `sys.argv` and `sys.stdout`/`sys.stderr` to test the command handler functions directly."
```
