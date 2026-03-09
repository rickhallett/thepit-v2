# Darkcat Review: Numerical Pipeline (`bin/triangulate`)

**Reviewer:** claude
**Date:** 2026-03-09
**Target:** `bin/triangulate` (752 lines), metric specifications, review instructions schema

---

## Section 1: Narrative Report

### 1. Correctness

The metrics compute approximately what they claim, with two exceptions.

**Marginal value is order-locked.** `compute_metrics` (lines 294-308) computes marginal value in a single fixed order: R1, R2, R3 — determined entirely by CLI argument position. The metric answers "what does the Nth review add?" but only for one of six possible orderings. If R3 happens to find mostly novel issues, its marginal value will appear low simply because R1 and R2 were evaluated first and their shared findings were already counted. A fair marginal value analysis requires computing all permutations and reporting the distribution. As shipped, this metric will flatter whichever review is passed as `<r1>` and disadvantage whichever is `<r3>`.

**False positive rate produces real-looking zeros.** Lines 358-369 output `fp_rate: 0.0` and `confirmed_false: 0` — not "not computed" or `null`. Downstream consumers (notebooks, hex.tech dashboards) will treat these as measured values. A visualization showing "0% false positive rate across all models" is worse than no visualization, because it implies empirical verification that hasn't occurred. The field should emit `null` or be omitted entirely until human adjudication data exists.

There are no off-by-one errors in the convergence counting. Division-by-zero is guarded at lines 288-290 with `if total else 0`. The `format_summary` line 407 computes `rate_2plus - rate_3` for display, which is mathematically correct but subject to floating-point representation noise (e.g., displaying "33.3%" vs "33.29999...%") — minor but worth noting for a portfolio piece.

Line 464 (`agree/total_conv`) is safe because it's only reached when `metrics["severity_calibration"]` is truthy, guaranteeing `total_conv >= 1`.

### 2. Matching Quality

The matching algorithm (`match_findings`, lines 183-249) has three structural weaknesses.

**Seed-only comparison.** The inner loop (lines 216-231) compares each candidate `f_j` against the group seed `f_i` only — not against all findings in the group. Consider: R1 titles a finding "Missing error handling in auth flow", R2 titles the same issue "Auth module lacks try-catch", R3 titles it "Error handling absent in authentication". R1-R2 might score above threshold. R3-R1 might score below threshold. But R3-R2 might score above. Because R3 is only compared against R1 (the seed), it's excluded. The algorithm produces false negatives when reviewers use different vocabulary to describe the same issue. A centroid or best-of-group comparison would mitigate this.

**Order dependence.** The iteration order of `all_findings` depends on dict insertion order of the `reviews` argument, which depends on CLI argument position. Because greedy matching is first-come-first-served, swapping R1 and R2 at the CLI can produce different group assignments. The matching is not commutative: `triangulate summary A B C` may produce different convergence numbers than `triangulate summary B A C`. This is a defensibility problem for a tool whose output feeds a portfolio.

**Threshold semantics.** The combined score `0.3 * file_sim + 0.7 * title_sim` means that perfect file match (1.0) requires only ~0.43 title similarity, while zero file match requires ~0.86 title similarity. When reviewers reference different paths for the same logical issue (e.g., `lib/auth/index.ts` vs `lib/auth/middleware.ts` for a cross-cutting auth concern), the title threshold effectively jumps from 0.43 to 0.86. The weighting implicitly assumes file paths are stable across reviewers, which is not guaranteed.

### 3. Data Integrity

`write_yaml` (line 599-602) uses `allow_unicode=True` and `default_flow_style=False`, which handles most cases. PyYAML's `yaml.dump` will quote strings that start with YAML-special characters (`*`, `&`, `!`, `{`, `[`), so round-tripping is generally safe.

One edge case: `yaml.safe_load` on line 98 will parse YAML date strings (e.g., `2024-03-09`) as `datetime.date` objects, not strings. If a reviewer writes `date: 2024-03-09` without quotes, the parsed value is a Python `date` object. When re-serialized via `yaml.dump`, it becomes `2024-03-09` (no quotes), which round-trips correctly — but downstream Python consumers using `json.dumps` on the metrics dict will fail because `datetime.date` is not JSON-serializable. The `computed_at` field (line 372) uses `isoformat()` which returns a string, so that's fine. The risk is in re-exporting reviewer metadata.

### 4. Statistical Validity

**N=3 is not statistical.** Three reviews provide anecdotal convergence, not statistical significance. The metrics (convergence rate, severity calibration agreement) are presented as rates and percentages, which implies a sample size large enough for meaningful ratios. With 3 reviewers and perhaps 10-30 findings, a single mismatched finding swings rates by 3-10 percentage points. This is fine for a portfolio demonstrating methodology, but the tool should not claim statistical validity — it should claim process validity.

**Marginal value is confounded by ordering** (discussed above). Without permutation analysis, the marginal value chart will show a declining curve that is partially an artifact of evaluation order, not a measurement of diminishing returns.

**Severity calibration conflates disagreement sources.** When two models assign different severities to a matched finding, the tool reports `max_delta` but doesn't distinguish between: (a) genuine calibration differences, (b) the models reviewing different versions of the code, (c) the models interpreting scope differently. The metric is useful but the narrative around it needs caveats.

### 5. Missing Metrics

**Metric 7 is specified but absent.** The metric table claims 8 metrics. The code implements 7 (with Metric 8 as a placeholder). Metric 7 (Pre-QA vs Post-QA delta) is documented in the spec but has no implementation, no placeholder, and no code comment explaining its absence — the code jumps from "Metric 6" (line 339) to "Metric 8" (line 357). The process doc acknowledges this, but the tool itself does not. A user running `--help` or reading the code will wonder what happened to Metric 7.

**No inter-reviewer agreement statistic.** Cohen's kappa or Fleiss' kappa (adapted for severity ordinals) would provide a single number answering "do these models agree more than chance?" This is the standard measure for inter-rater reliability and its absence will be noticed by anyone with a statistics background reviewing the portfolio.

**No confidence intervals.** Even simple bootstrap CIs on convergence rate would signal methodological awareness. With N=3, this is admittedly theatrical — but the audience (Anthropic red team) will notice the absence.

### 6. Schema Completeness

**Type validation is absent.** `validate_finding` (lines 130-146) checks field presence but not types. A finding with `severity: 42` or `line: [1, 2, 3]` passes validation without warning. The `severity` check on line 139 catches invalid string values but not non-string types — `42 not in VALID_SEVERITIES` is `True`, so it produces a warning, but `severity: true` (parsed by YAML as boolean `True`) would produce a confusing warning message: `"invalid severity 'True'"`.

**No ID format validation.** The schema specifies `F-NNN` format but `validate_finding` doesn't check it. Duplicate IDs across or within reviews are not detected.

**No intra-review deduplication.** If a reviewer lists the same finding twice (identical or near-identical), both are processed. This inflates that reviewer's finding count and distorts convergence metrics.

**YAML extraction is fragile with nested fences.** The regex `r"```ya?ml\s*\n(.*?)```"` (line 93) uses lazy matching, which works for simple cases. But if a review file contains a YAML block that itself includes a code fence as a string value (common in LLM-generated reviews discussing code), the regex will terminate at the inner fence. This is an edge case but the tool processes review files written by LLMs, which frequently include code examples.

---

## Section 2: Structured Findings

```yaml
review:
  model: "claude"
  date: "2026-03-09"
  branches:
    - "numerical-pipeline"
  base_commit: "unknown"

findings:
  - id: F-001
    branch: "numerical-pipeline"
    file: "bin/triangulate"
    line: "206-249"
    severity: high
    watchdog: WD-PL
    slopodar: shadow-validation
    title: "Greedy matching is order-dependent and non-commutative"
    description: >
      match_findings uses greedy first-come-first-served assignment. The
      iteration order depends on dict insertion order of the reviews argument,
      which depends on CLI argument position. Swapping R1 and R2 at the CLI
      can produce different convergence numbers. For a tool whose output
      feeds portfolio visualisations, non-deterministic results undermine
      defensibility. The algorithm also only compares candidates against the
      group seed, not all group members, producing false negatives when
      reviewers use different vocabulary for the same issue.
    recommendation: "Compute similarity against best-in-group (not seed only). Run matching on all permutations of review order and report variance. If variance is zero, the matching is robust; if non-zero, report the range."

  - id: F-002
    branch: "numerical-pipeline"
    file: "bin/triangulate"
    line: "224-226"
    severity: high
    watchdog: WD-PL
    slopodar: shadow-validation
    title: "Seed-only similarity comparison produces false negatives"
    description: >
      The inner matching loop compares f_j against f_i (the seed) only.
      Two findings that are both similar to a third but dissimilar to each
      other will not be grouped. This is the primary failure mode of the
      matching algorithm: R1 says 'missing error handling', R2 says
      'lacks try-catch blocks', R3 says 'no error handling'. R1-R3 match,
      R1-R2 might not, so R2 ends up as a separate single-model finding
      despite describing the same issue.
    recommendation: "Compare candidates against all findings in the group (best-of-group score) rather than only the seed. Alternatively, use transitive closure: if A matches B and B matches C, group all three."

  - id: F-003
    branch: "numerical-pipeline"
    file: "bin/triangulate"
    line: "294-308"
    severity: high
    watchdog: WD-PG
    slopodar: phantom-ledger
    title: "Marginal value computed for single ordering only"
    description: >
      The marginal value metric answers 'what does the Nth review add?'
      but only for the ordering determined by CLI argument position. The
      first review always gets credit for the most findings. With 3
      reviews there are 6 possible orderings; the tool computes 1. The
      resulting line chart will show a declining curve that is partly an
      artifact of evaluation order, not a true measurement of diminishing
      returns. This is the most misleading metric in the tool.
    recommendation: "Compute marginal value for all 6 permutations of review order. Report mean, min, max marginal value per model. This is 6x the work but the permutation count is trivially small."

  - id: F-004
    branch: "numerical-pipeline"
    file: "bin/triangulate"
    line: "358-369"
    severity: medium
    watchdog: WD-PG
    slopodar: phantom-ledger
    title: "False positive rate outputs measured-looking zeros instead of null"
    description: >
      The FP rate metric defaults all findings to confirmed_true=total,
      confirmed_false=0, fp_rate=0.0. Downstream consumers will render
      this as '0% false positive rate' which implies empirical verification
      that has not occurred. This is a phantom ledger: the books show a
      clean audit trail that doesn't correspond to any actual audit.
    recommendation: "Output null or omit the FP rate fields entirely until human adjudication data exists. If the placeholder must exist, add a field 'adjudicated: false' so downstream tools can filter it."

  - id: F-005
    branch: "numerical-pipeline"
    file: "bin/triangulate"
    line: "130-146"
    severity: medium
    watchdog: WD-CB
    slopodar: paper-guardrail
    title: "Finding validation checks presence but not types"
    description: >
      validate_finding checks that required fields exist but does not
      validate their types. severity: 42, line: [1,2,3], or title: true
      (parsed as boolean by YAML) will pass validation or produce
      confusing warning messages. The watchdog field is validated against
      a set but only as string membership — a list value would produce
      a misleading warning. No ID format validation (F-NNN expected).
      No duplicate ID detection within or across reviews.
    recommendation: "Add type checks: severity must be str, line must be str or int, id must match r'F-\\d{3}'. Track seen IDs and warn on duplicates."

  - id: F-006
    branch: "numerical-pipeline"
    file: "bin/triangulate"
    line: "254-380"
    severity: medium
    watchdog: none
    slopodar: none
    title: "No inter-rater reliability statistic (kappa)"
    description: >
      The tool computes severity agreement as a binary (agree/disagree)
      and max_delta. It does not compute Cohen's or Fleiss' kappa, which
      is the standard measure for inter-rater reliability. The portfolio
      audience (Anthropic red team, ML researchers) will expect this
      metric. Its absence signals either unfamiliarity with the standard
      or deliberate avoidance — neither is a good signal.
    recommendation: "Implement ordinal-weighted Fleiss' kappa for severity ratings across converged findings. Even with small N, the metric demonstrates methodological awareness."

  - id: F-007
    branch: "numerical-pipeline"
    file: "bin/triangulate"
    line: "93"
    severity: medium
    watchdog: WD-SH
    slopodar: none
    title: "YAML extraction regex fragile with nested code fences"
    description: >
      The regex r'```ya?ml\s*\n(.*?)```' uses lazy matching that terminates
      at the first ``` after the opening fence. If a YAML block contains
      a string value with triple backticks (common in LLM-generated reviews
      discussing code), the block will be truncated. The tool specifically
      processes LLM output, making this a plausible failure mode.
    recommendation: "Count fence depth (track opening/closing triple-backtick pairs) or require a specific marker comment in the YAML block (e.g., '# triangulate-findings') to identify the correct block."

  - id: F-008
    branch: "numerical-pipeline"
    file: "bin/triangulate"
    line: "339-355"
    severity: low
    watchdog: none
    slopodar: none
    title: "Metric 7 absent with no code-level acknowledgment"
    description: >
      The spec claims 8 metrics. The code jumps from 'Metric 6' (line 339)
      to 'Metric 8' (line 357) with no comment, placeholder, or error for
      Metric 7 (Pre-QA vs Post-QA delta). The process doc acknowledges
      the gap but the tool itself does not. A user running --help or reading
      the code will wonder what happened to Metric 7.
    recommendation: "Add a comment or placeholder dict entry for Metric 7 in the metrics output: {'status': 'not_implemented', 'reason': 'requires two-run comparison'}. Update the docstring to say 7 of 8 metrics implemented."

  - id: F-009
    branch: "numerical-pipeline"
    file: "bin/triangulate"
    line: "161-168"
    severity: low
    watchdog: none
    slopodar: none
    title: "No intra-review deduplication"
    description: >
      If a reviewer includes the same finding twice (copy-paste error or
      overlapping scope), both are processed. This inflates that reviewer's
      finding count and distorts convergence metrics. Given that reviewers
      are LLMs, which sometimes produce duplicate findings in long outputs,
      this is a realistic failure mode.
    recommendation: "Add intra-review deduplication in validate_review: compute pairwise similarity within a single review's findings and warn when any pair exceeds the match threshold."

  - id: F-010
    branch: "numerical-pipeline"
    file: "bin/triangulate"
    line: "407"
    severity: low
    watchdog: none
    slopodar: none
    title: "Display rate for 'exactly 2 models' computed via float subtraction"
    description: >
      format_summary line 407 displays the '2 of 3 models' rate as
      rate_2plus - rate_3. This is mathematically correct but floating-point
      subtraction can produce display artifacts (e.g., 33.29999...% instead
      of 33.3%). In a portfolio piece, cosmetic precision matters.
    recommendation: "Compute the 'exactly 2' rate directly from converged_2/total rather than subtracting two rounded values."
```
