Section 1: Narrative Report
I reviewed the CLI and specs as provided. Focused on correctness, matching, data integrity, statistical validity, missing metrics, and schema robustness.
Correctness
- Metric 1 counts are computed on matched groups, not raw findings. This means a model that reports two distinct findings which are merged into a single group still only counts as one. If the matching threshold is too low, you can undercount a model's total and unique findings. This is an intended design choice only if "finding" is defined as a deduplicated group, not raw model output, but the metric table does not state this. See `compute_metrics` around `finding_count` (lines 263-277).
- Metric 3 "marginal value" depends on group order. The code iterates groups in whatever order `match_findings` generates, which is effectively the insertion order of `all_findings`. This makes marginal value sensitive to the arbitrary ordering of reviews and findings. Two runs with the same findings but a different file order can change marginal curves. See `compute_metrics` lines 293-308 and `match_findings` lines 196-248. This impacts the "when does adding another model stop being worth it" narrative.
- The "2 of 3 models" line in summary is calculated as `rate_2plus - rate_3` (line 407). This matches the 2-only proportion but depends on floating rounding, not the integer counts. If `rate_2plus` and `rate_3` are rounded differently, the derived 2-only percentage can be off. Safer to compute from counts (converged_2 / total).
Matching quality
- Matching uses a greedy algorithm with a single pass and a single threshold. This can produce false positives and false negatives depending on ordering. Example: if A and B are a weak match and B and C are a strong match, A may capture B first, leaving C unmatched even though B and C are closer. This is a known failure mode of greedy clustering. See `match_findings` lines 202-248.
- Combined similarity weights file at 0.3 and title at 0.7. Many findings will share a file but different titles, or vice versa. If titles are generic ("Missing null check"), the matcher can merge across distinct files. If titles differ but file is same, you might get merges that collapse multiple distinct findings in a file. There is no secondary check using `line`, `branch`, or any normalized code location, which are available in the schema.
- The matching uses `SequenceMatcher` which is sensitive to superficial edits and substring overlap. It does not account for token order or key nouns. This can mis-match "Missing auth check" and "Auth check missing in X" (ok) but also "Missing auth check" and "Missing cache check" (bad) if the edit distance is small. The lack of stopword handling and domain-specific normalization increases false positives.
Data integrity
- YAML extraction uses a regex for fenced blocks and then `yaml.safe_load`. If a file contains multiple yaml blocks, only the first with "findings" is returned. This is acceptable but can be brittle if a reviewer includes a smaller example with "findings" earlier in the file, causing the parser to read the wrong block.
- `write_yaml` uses `allow_unicode=True`, which is fine, but the schema expects ASCII for downstream. If a reviewer uses Unicode punctuation in title/description, the output will include it. Downstream tools should be ok if they handle UTF-8, but this should be called out in docs or normalized in the exporter.
- There is no explicit schema validation for types (e.g., `line` might be a list or int). The validator only checks presence and enums. Malformed types can pass and produce difficult-to-debug downstream failures.
Statistical validity
- Convergence rate uses deduplicated groups as the denominator. This means the rate is dominated by the matching algorithm. If matching is noisy, the "convergence" metric measures clustering quality more than reviewer overlap. This undermines the cost-benefit claim unless the matching error is bounded.
- The marginal value metric is highly order-dependent and does not report variance or alternative permutations (e.g., all 6 orderings for 3 models). Without that, any slope-based inference can be spurious.
- Severity calibration reports agreement on ordinal labels but does not normalize by model bias or compute inter-rater statistics (e.g., weighted kappa). The current "agreement" is a binary check and can overstate alignment.
Missing metrics
- Metric 7 (pre-QA vs post-QA delta) is acknowledged as missing. There is no placeholder field or schema location for it in output, which complicates downstream notebooks that expect 8 metrics.
- Missing "confidence" in matching: there is no metric of match quality (e.g., average similarity score per group). That would help interpret convergence rates and allow excluding low-confidence clusters.
Schema completeness
- The parser assumes `findings` exists and is a list, but does not validate list entries are dicts. Non-dict entries will cause exceptions later (e.g., `f.get`).
- It does not validate `line` format or `branch` presence (only missing-field warnings). This means malformed inputs can silently propagate into outputs.
- Review metadata validation does not check `base_commit` even though the schema requires it. This is a schema drift between instructions and parser.
Section 2: Structured Findings
```yaml
review:
  model: "codex52"
  date: "2026-03-09"
  branches:
    - "numerical-pipeline"
  base_commit: "unknown"
findings:
  - id: F-001
    branch: "numerical-pipeline"
    file: "bin/triangulate"
    line: "202-248"
    severity: high
    watchdog: WD-PL
    slopodar: shadow-validation
    title: "Greedy matching causes order-dependent false matches"
    description: >
      match_findings uses a single-pass greedy clustering with SequenceMatcher.
      The first acceptable match absorbs a finding, preventing better later matches.
      This can collapse distinct findings into one group or split true duplicates,
      depending on the order of all_findings. Convergence metrics and marginal value
      then reflect matching artifacts rather than reviewer overlap.
    recommendation: "Use a stable clustering strategy (e.g., pairwise scores + max-weight matching or hierarchical clustering) and record match confidence per group."
  - id: F-002
    branch: "numerical-pipeline"
    file: "bin/triangulate"
    line: "293-308"
    severity: medium
    watchdog: WD-PL
    slopodar: paper-guardrail
    title: "Marginal value depends on arbitrary group order"
    description: >
      Marginal value is computed by iterating groups in their existing order, which
      depends on file read order and the greedy matcher. This makes the cumulative
      curve non-deterministic across equivalent inputs and biases the "value of
      the nth reviewer" interpretation.
    recommendation: "Define and document a deterministic ordering for groups (e.g., sort by canonical_file/title) or compute marginal value across all permutations and report mean/variance."
  - id: F-003
    branch: "numerical-pipeline"
    file: "bin/triangulate"
    line: "263-290"
    severity: medium
    watchdog: WD-LRT
    slopodar: right-answer-wrong-work
    title: "Convergence rates reflect matching quality more than reviewer overlap"
    description: >
      Convergence uses the deduplicated group count as denominator. If the matcher
      over-merges or over-splits, the convergence rate and total_unique_findings
      become artifacts of the similarity threshold and ordering, undermining the
      cost-benefit interpretation.
    recommendation: "Report matching diagnostics (avg similarity, distribution) and separate raw finding counts from grouped finding counts."
  - id: F-004
    branch: "numerical-pipeline"
    file: "bin/triangulate"
    line: "129-168"
    severity: low
    watchdog: WD-DC
    slopodar: paper-guardrail
    title: "Schema validation is shallow and can pass malformed types"
    description: >
      validate_finding checks presence and enum membership but not data types or
      formats. Non-dict entries or non-string line values can pass and later
      break downstream tools. base_commit is required by spec but not validated.
    recommendation: "Add type checks and format validation for fields (line, branch, file) and include base_commit in required metadata."
  - id: F-005
    branch: "numerical-pipeline"
    file: "bin/triangulate"
    line: "406-408"
    severity: low
    watchdog: WD-PL
    slopodar: right-answer-wrong-work
    title: "Derived 2-of-3 percentage uses rounded rates"
    description: >
      The summary derives the 2-of-3 percentage from rounded rate_2plus and rate_3,
      which can produce small but avoidable discrepancies. This weakens the precision
      of reported convergence percentages.
    recommendation: "Compute the 2-of-3 percentage from integer counts directly."
  - id: F-006
    branch: "numerical-pipeline"
    file: "bin/triangulate"
    line: "57-70"
    severity: low
    watchdog: WD-PL
    slopodar: paper-guardrail
    title: "No output placeholder for metric 7 (pre/post QA delta)"
    description: >
      The spec lists metric 7, but the output schema in metrics does not include
      a placeholder for it. This creates downstream schema drift and makes notebook
      code more brittle across runs.
    recommendation: "Add a null/placeholder metric_7_delta field to metrics output with an explicit 'not implemented' status."
```
