# Section 1: Narrative Report

**Darkcat Self-Review: bin/triangulate Pipeline Fix**

### Overview
This review covers the pipeline fixes committed in 69377ca — the diff from 975a24d that rewrote the matcher from greedy first-match to best-first assignment, replaced hard-coded FP rate with pending_adjudication, added variable review count support, match confidence reporting, all N! orderings for marginal value, and union export with line+recommendation fields.

### Key Issues
The most critical finding is that the docstring claims "max-weight bipartite matching" but the implementation is greedy best-first — a semantic hallucination that will mislead anyone auditing the instrument. The second critical issue is zero test coverage on a 600-line rewrite of the core triangulation instrument. Every other pipeline fix in the project has been darkcat-reviewed; this one has no automated regression protection.

The match confidence calculation averages admission scores rather than all pairwise similarities within a group, making the reported confidence an undercount for groups of 3+. The permutation calculation for marginal value will explode combinatorially beyond ~7 reviews with no guard. The CLI parser improvements, while functional, have edge cases with boolean flags and could swallow `--verbose` style flags that take no value.

Several lower-severity issues round out the picture: an unused parameter, redundant output for N=2, and the severity calibration key fix being unverified against the actual data.

# Section 2: Structured Findings

```yaml
review:
  model: "claude-opus-4-6"
  date: "2026-03-09"
  branches:
    - "pipeline-fix"
  base_commit: "975a24d"
findings:
  - id: F-001
    branch: "pipeline-fix"
    file: "bin/triangulate"
    line: "260-300"
    severity: high
    watchdog: WD-SH
    slopodar: shadow-validation
    title: "Docstring claims max-weight bipartite but implementation is greedy best-first"
    description: >
      The matcher docstring says "max-weight bipartite matching" but the actual
      algorithm is greedy best-first assignment. It sorts all pairwise scores
      descending and greedily assigns findings to groups, skipping when both
      findings are already in different groups. This is not bipartite matching —
      it cannot reassign to find a global optimum. The docstring is a semantic
      hallucination that will mislead anyone auditing the instrument.
    recommendation: "Either implement true max-weight bipartite matching (e.g., Hungarian algorithm via scipy) or correct the docstring to say greedy best-first assignment."

  - id: F-002
    branch: "pipeline-fix"
    file: "bin/triangulate"
    line: "373-376"
    severity: low
    watchdog: WD-DC
    slopodar: none
    title: "Unused all_findings parameter in _avg_similarity_to_group"
    description: >
      The helper function _avg_similarity_to_group accepts an all_findings
      parameter that is never referenced in the function body. This is dead
      code that adds confusion about the function's actual interface.
    recommendation: "Remove the unused parameter from the signature and all call sites."

  - id: F-003
    branch: "pipeline-fix"
    file: "bin/triangulate"
    line: "400-420"
    severity: medium
    watchdog: WD-PG
    slopodar: none
    title: "Permutation explosion with >3 reviews has no guard"
    description: >
      The marginal value calculation computes all N! permutations of review
      orderings. For 3 reviews this is 6 permutations. For 7 reviews this is
      5040. For 10 reviews this is 3.6M. There is no guard, warning, or
      fallback to sampling when N exceeds a reasonable threshold.
    recommendation: "Add a guard that switches to random sampling (e.g., 1000 samples) when N! exceeds a threshold, or cap N at 7 with a warning."

  - id: F-004
    branch: "pipeline-fix"
    file: "bin/triangulate"
    line: "763-768"
    severity: medium
    watchdog: WD-LRT
    slopodar: none
    title: "CLI parse_cli_args swallows boolean flags"
    description: >
      The parse_cli_args function expects all flags to have values (--flag value).
      Boolean flags like --verbose that take no value will cause the next
      positional argument to be consumed as the flag's value, or if at end of
      args, the flag itself may be treated as a file path.
    recommendation: "Maintain a set of known boolean flags and handle them separately, or use argparse."

  - id: F-005
    branch: "pipeline-fix"
    file: "bin/triangulate"
    line: "349-368"
    severity: medium
    watchdog: WD-PL
    slopodar: phantom-ledger
    title: "Match confidence averages admission scores not all pairwise scores"
    description: >
      match_confidence is described as the average pairwise similarity within
      a group, but the implementation only stores the score that triggered each
      admission. For a 3-member group, you get 2 scores (a spanning tree) instead
      of the 3 pairwise similarities. The reported confidence is not what it
      claims to be.
    recommendation: "After grouping is complete, compute all N*(N-1)/2 pairwise similarities for each group and average those for match_confidence."

  - id: F-006
    branch: "pipeline-fix"
    file: "bin/triangulate"
    line: "584-592"
    severity: low
    watchdog: WD-LRT
    slopodar: none
    title: "Redundant 'All 2 models' line when N=2"
    description: >
      When exactly 2 reviews are provided, the summary output prints both
      "All 2 models" and "2 of 2 models" lines that contain identical
      information, making the output confusing.
    recommendation: "Skip the '2 of N' line when N=2, since 'All N' already covers it."

  - id: F-007
    branch: "pipeline-fix"
    file: "bin/triangulate"
    line: "various"
    severity: low
    watchdog: WD-LRT
    slopodar: none
    title: "Parameter name 'data' shadows outer scope"
    description: >
      Several functions use 'data' as a parameter name which shadows the
      outer-scope variable of the same name in the module. While not a bug
      in Python, it increases the risk of accidental reference to the wrong
      scope during future edits.
    recommendation: "Rename to more specific names like review_data, parsed_data, etc."

  - id: F-008
    branch: "pipeline-fix"
    file: "bin/triangulate"
    line: "1-900"
    severity: high
    watchdog: WD-PG
    slopodar: paper-guardrail
    title: "Zero test coverage on 600-line rewrite of core instrument"
    description: >
      The pipeline fixes rewrote ~600 lines of the core triangulation instrument
      including the matcher, metrics, CLI parser, and export logic. There are
      zero automated tests. The only verification is manual re-runs of darkcat
      data. Any future change risks silent regression with no safety net.
    recommendation: "Write unit tests for: matcher (edge cases: 0 findings, 1 finding, duplicate titles, threshold boundary), CLI parser (flags, positional args, boolean flags), metrics computation (N=2, N=3, N>3), and export (line/recommendation fields present)."

  - id: F-009
    branch: "pipeline-fix"
    file: "bin/triangulate"
    line: "510-520"
    severity: low
    watchdog: WD-CB
    slopodar: none
    title: "Severity calibration key fix unverified"
    description: >
      The severity calibration normalization was changed but has not been
      verified against the actual darkcat review data to confirm the key
      mapping produces correct agreement scores.
    recommendation: "Run severity agreement calculation on the existing 9 reviews from the 20260309 run and spot-check that the reported percentages match manual counting."
```
