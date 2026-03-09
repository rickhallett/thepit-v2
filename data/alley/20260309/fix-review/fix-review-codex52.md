### Section 1: Narrative Report (human-readable)

The matcher rewrite improves over the seed-only approach, but it makes two claims that are not actually enforced. First, `match_confidence` is described as “average pairwise similarity within group,” yet the implementation only averages the subset of scores that happened to trigger group creation or addition. For a 3-member group, you never compute or include the missing pairwise similarity; and when a member is admitted via `_avg_similarity_to_group`, the stored score is still the original pair’s score, not the average used for admission. The confidence number therefore does not represent what the docs say it represents.

Second, the new “match diagnostics” reports a threshold of `0.6` regardless of the `--match-threshold` CLI flag used. This makes the diagnostics a phantom ledger: it claims a threshold that may not be the one actually used for matching. This is especially misleading when auditing runs with a non-default threshold.

There is also a correctness issue in the summary output when only two reviews are provided. The “2 of N models” line always prints the `converged_2` count but uses `rate_2plus - rate_all`. For `n_reviews = 2`, `rate_all == rate_2plus`, so the percentage always prints 0.0% even when all findings converge across both reviews. This is an edge-case reporting error.

Finally, the matcher advertises “max-weight bipartite-style matching,” but the implementation is a greedy best-first assignment that explicitly refuses to merge groups. In cases where A~B and B~C are above threshold (and all three are from distinct reviewers), if A–B and C–B are built as separate groups due to earlier pair ordering, the algorithm will skip merging and you’ll get two groups instead of one. That breaks the intended convergence counting under realistic conditions with multiple high-similarity pairs.

### Section 2: Structured Findings (machine-readable)

```yaml
review:
  model: "codex52"
  date: "2026-03-09"
  branches:
    - "pipeline-fix"
  base_commit: "975a24d"
findings:
  - id: F-001
    branch: "pipeline-fix"
    file: "bin/triangulate"
    line: "260-366"
    severity: high
    watchdog: WD-SH
    slopodar: shadow-validation
    title: "Group matching claims max-weight/avg-pairwise but skips merges"
    description: >
      The matcher docstring advertises max-weight bipartite-style matching and
      that group admission compares against all members. In practice it is
      greedy best-first and explicitly skips merging when both findings are
      already assigned to different groups. This can split what should be a
      single converged group (e.g., A~B and B~C over threshold) into two groups,
      undercounting convergence under realistic multi-match inputs.
    recommendation: "Either implement proper group merging when transitive matches exist or update the docstring and metrics to reflect the greedy no-merge behavior."
  - id: F-002
    branch: "pipeline-fix"
    file: "bin/triangulate"
    line: "349-368"
    severity: medium
    watchdog: WD-SH
    slopodar: phantom-ledger
    title: "match_confidence is not average pairwise similarity"
    description: >
      The code claims match_confidence is the average of pairwise scores within
      the group, but it only averages the subset of scores that happened to
      create/extend the group. For groups of size 3, the missing pairwise
      similarity is never computed, and when a member is added via
      _avg_similarity_to_group the stored score is the original pair score, not
      the average used for admission. This yields misleading confidence values.
    recommendation: "Compute all pairwise similarities among group members and average them, or rename the field to reflect the partial/greedy score source."
  - id: F-003
    branch: "pipeline-fix"
    file: "bin/triangulate"
    line: "545-560"
    severity: medium
    watchdog: WD-PL
    slopodar: phantom-ledger
    title: "Match diagnostics hard-codes threshold to 0.6"
    description: >
      match_diagnostics reports threshold=0.6 regardless of the CLI
      --match-threshold used for the run. This makes the diagnostics disagree
      with the actual matching process and is misleading for audit/repro.
    recommendation: "Thread the actual threshold into compute_metrics and record it in match_diagnostics."
  - id: F-004
    branch: "pipeline-fix"
    file: "bin/triangulate"
    line: "584-592"
    severity: low
    watchdog: WD-SH
    slopodar: none
    title: "2-review summary prints 0.0% even when all findings converge"
    description: >
      For n_reviews=2, the summary prints the count of converged_2 but computes
      rate_2only as rate_2plus - rate_all, which is always 0.0 when all findings
      converge across both reviews. The percentage displayed is incorrect in
      this edge case.
    recommendation: "Special-case n_reviews=2 or compute the percentage for the displayed count directly."
```
