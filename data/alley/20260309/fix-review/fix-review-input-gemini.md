> **You are: gemini.** State this in your review.model YAML field.

---

# Darkcat Review — Pipeline Fix (bin/triangulate)

You are reviewing a single commit's changes to `bin/triangulate`, a Python CLI tool that parses cross-model code review findings, matches them across reviewers, and computes triangulation metrics. The tool was itself reviewed by 3 models (Claude, Gemini, Codex) and these fixes respond to those findings.

**Context:** This diff is the ONLY change. There is one file: `bin/triangulate` (Python, ~750 lines post-change). The tool runs via `uv run --script`. No tests exist for this tool.

**What changed (author's summary):**
1. Matcher: Greedy first-match → pairwise scoring with best-first assignment. New findings compared against all group members (avg similarity), not just seed. Match confidence reported per group.
2. FP rate: `0.0` → `null` with `status: pending_adjudication` and explicit note.
3. CLI: Hard-coded 3 files → `parse_cli_args()` separates flags from positionals. All commands accept 2+ files.
4. Union export: Now includes `line` and `recommendation` fields.
5. Marginal value: Single ordering → all N! permutations with position means and per-model means.
6. YAML output: Custom dumper for readable multi-line strings (block style `|`).

**Your job:** Find what is wrong. Assess correctness, edge cases, documentation accuracy, and whether the fixes actually address the original findings or introduce new problems.

Use branch name "pipeline-fix" for all findings.

---

# Darkcat Review Instructions — Standardised Cross-Model Code Review

**Version:** 1.0

## What to Review

1. **Read every changed line.** Do not skip.
2. **Stain against the Watchdog taxonomy** (defined below). For each finding, classify it.
3. **Check for slopodar patterns** (defined below). Flag any you recognise.
4. **Assess documentation accuracy** — do comments and docstrings match what the code actually does?
5. **Assess algorithmic correctness** — does the matching algorithm do what it claims?
6. **Assess edge cases** — what happens with 0 findings, 1 finding, duplicate titles, empty files?

## Watchdog Taxonomy (classify every finding)

| ID | Category | Description |
|----|----------|-------------|
| WD-SH | Semantic Hallucination | Comments, docstrings, or variable names that claim behaviour the code does not implement |
| WD-LRT | Looks Right Trap | Code follows the correct pattern but operates on the wrong handle, fd, ref, scope, or uses a similar-but-wrong API |
| WD-CB | Completeness Bias | Each function is correct in isolation but duplicated logic is not extracted, cross-referenced, or consistently applied |
| WD-DC | Dead Code | Error-handling paths or branches that are unreachable in this context (often copied from elsewhere) |
| WD-TDF | Training Data Frequency | stdlib/API choices that reflect corpus frequency rather than current best practice |
| WD-PG | Paper Guardrail | A rule or constraint is stated (in comments, docs, or variable names) but not enforced by code or schema |
| WD-PL | Phantom Ledger | An audit trail or log claims to record operations but does not match what actually happened |

## Slopodar Patterns (flag if recognised)

- **right-answer-wrong-work**: Test assertion passes but via wrong causal path
- **phantom-ledger**: Audit trail ≠ actual operation
- **shadow-validation**: Abstraction covers easy cases, skips critical path
- **paper-guardrail**: Rule stated, not enforced
- **stale-reference-propagation**: Config describes a state that no longer exists
- **loom-speed**: Plan is granular but execution is bulk — exceptions get lost

## Required Output Format

### Section 1: Narrative Report (human-readable)
Free-form markdown. Include your reasoning.

### Section 2: Structured Findings (machine-readable)
A YAML block fenced with ```yaml and ```. Every field is required.

```yaml
review:
  model: "<your model name>"
  date: "2026-03-09"
  branches:
    - "pipeline-fix"
  base_commit: "975a24d"
findings:
  - id: F-001
    branch: "pipeline-fix"
    file: "bin/triangulate"
    line: "<line range>"
    severity: critical|high|medium|low
    watchdog: WD-XX
    slopodar: pattern-name|none
    title: "<max 120 chars>"
    description: >
      <detail>
    recommendation: "<what to do>"
```

## Severity Guide

| Level | Meaning |
|-------|---------|
| critical | Data loss, financial corruption, security breach, measurement instrument fundamentally wrong |
| high | Incorrect behaviour under realistic conditions |
| medium | Incorrect behaviour under edge conditions |
| low | Code quality, documentation inaccuracy, minor issue |

## What NOT to Do

- Do not praise code that works
- Do not suggest style changes
- Do not recommend "adding tests" generically — specify what scenario

---

# The Diff

```diff
diff --git a/bin/triangulate b/bin/triangulate
index ab6780c..b2ca970 100755
--- a/bin/triangulate
+++ b/bin/triangulate
@@ -11,18 +11,19 @@ matches findings across reviews, computes convergence metrics, and
 outputs both human-readable summaries and machine-readable YAML data.
 
 Usage:
-    triangulate summary <r1> <r2> <r3>                 # human-readable summary
-    triangulate metrics <r1> <r2> <r3>                 # machine-readable YAML metrics
-    triangulate convergence <r1> <r2> <r3>             # convergence matrix
-    triangulate export <r1> <r2> <r3> --out <dir>      # export all data products
-    triangulate parse <review_file>                    # parse + validate a single review
+    triangulate summary <r1> [<r2>] [<r3>] [options]      # human-readable summary
+    triangulate metrics <r1> [<r2>] [<r3>] [options]      # machine-readable YAML metrics
+    triangulate convergence <r1> [<r2>] [<r3>] [options]  # convergence matrix
+    triangulate export <r1> [<r2>] [<r3>] [options]       # export all data products
+    triangulate parse <review_file>                        # parse + validate a single review
 
-Arguments:
-    <r1>, <r2>, <r3>   Paths to review markdown files containing YAML findings blocks
+Options:
     --out <dir>        Output directory for export (default: data/alley/<run-id>)
     --run <id>         Run identifier (default: auto-generated from date)
     --match-threshold  Similarity threshold for matching findings (default: 0.6)
 
+Supports 2 or 3 review files for all commands.
+
 Backrefs: SD-318 (Darkcat Alley), SD-317 (QA sequencing), SD-309 (True North)
 Process:  docs/internal/weaver/darkcat-alley.md
 Instructions: docs/internal/weaver/darkcat-review-instructions.md
@@ -30,11 +31,11 @@ Instructions: docs/internal/weaver/darkcat-review-instructions.md
 
 import sys
 import re
-import json
 from datetime import datetime, timezone
+from itertools import permutations
 from pathlib import Path
 from difflib import SequenceMatcher
-from collections import Counter, defaultdict
+from collections import Counter
 from typing import Any
 
 import yaml
@@ -96,19 +97,34 @@ def parse_review_file(filepath: str) -> dict:
 def validate_finding(finding: dict, source: str) -> list[str]:
     """Validate a single finding against the schema. Returns list of warnings."""
     warnings = []
+
+    if not isinstance(finding, dict):
+        warnings.append(f"{source}: finding is not a dict — got {type(finding).__name__}")
+        return warnings
+
     required = {"id", "branch", "file", "line", "severity", "watchdog", "slopodar", "title", "description", "recommendation"}
     missing = required - set(finding.keys())
     if missing:
         warnings.append(f"{source}/{finding.get('id', '?')}: missing fields: {missing}")
 
     sev = finding.get("severity", "")
-    if sev not in VALID_SEVERITIES:
+    if not isinstance(sev, str):
+        warnings.append(f"{source}/{finding.get('id', '?')}: severity must be a string, got {type(sev).__name__}")
+    elif sev not in VALID_SEVERITIES:
         warnings.append(f"{source}/{finding.get('id', '?')}: invalid severity '{sev}' — must be one of {VALID_SEVERITIES}")
 
     wd = finding.get("watchdog", "")
-    if wd not in WATCHDOG_IDS:
+    if not isinstance(wd, str):
+        warnings.append(f"{source}/{finding.get('id', '?')}: watchdog must be a string, got {type(wd).__name__}")
+    elif wd not in WATCHDOG_IDS:
         warnings.append(f"{source}/{finding.get('id', '?')}: unknown watchdog category '{wd}' — expected one of {WATCHDOG_IDS}")
 
+    # Type checks for string fields
+    for field in ("title", "description", "file", "branch", "id"):
+        val = finding.get(field)
+        if val is not None and not isinstance(val, str):
+            warnings.append(f"{source}/{finding.get('id', '?')}: '{field}' should be a string, got {type(val).__name__}")
+
     return warnings
 
 
@@ -120,7 +136,7 @@ def validate_review(data: dict, source: str) -> list[str]:
         warnings.append(f"{source}: missing 'review' metadata block")
     else:
         review = data["review"]
-        for field in ["model", "date", "branches"]:
+        for field in ["model", "date", "branches", "base_commit"]:
             if field not in review:
                 warnings.append(f"{source}: review metadata missing '{field}'")
 
@@ -141,16 +157,44 @@ def similarity(a: str, b: str) -> float:
     return SequenceMatcher(None, a.lower(), b.lower()).ratio()
 
 
-def match_key(finding: dict) -> str:
-    """Generate a matching key from file + title for deduplication."""
-    return f"{finding.get('file', '')}::{finding.get('title', '')}"
+def compute_pairwise_scores(
+    all_findings: list[tuple[str, dict]],
+    threshold: float,
+) -> list[tuple[int, int, float]]:
+    """Compute all pairwise similarity scores between findings from different reviews.
+
+    Returns list of (i, j, score) tuples where score >= threshold,
+    sorted by score descending (best matches first).
+    """
+    scores = []
+    for i in range(len(all_findings)):
+        rid_i, f_i = all_findings[i]
+        for j in range(i + 1, len(all_findings)):
+            rid_j, f_j = all_findings[j]
+            # Only compare findings from different reviews
+            if rid_i == rid_j:
+                continue
+
+            file_sim = similarity(f_i.get("file", ""), f_j.get("file", ""))
+            title_sim = similarity(f_i.get("title", ""), f_j.get("title", ""))
+            combined = 0.3 * file_sim + 0.7 * title_sim
+
+            if combined >= threshold:
+                scores.append((i, j, combined))
+
+    # Sort by score descending — best matches consumed first
+    scores.sort(key=lambda x: -x[2])
+    return scores
 
 
 def match_findings(
     reviews: dict[str, list[dict]],
     threshold: float = 0.6,
 ) -> list[dict]:
-    """Match findings across reviews by file + title similarity.
+    """Match findings across reviews using max-weight bipartite-style matching.
+
+    Uses pairwise scoring with greedy-best-first assignment. Compares all
+    findings against all group members (not just seed) for group admission.
 
     Returns a list of matched finding groups, each containing:
     - matched_findings: dict mapping review_id -> finding
@@ -158,6 +202,7 @@ def match_findings(
     - canonical_title: representative title
     - canonical_file: representative file
     - canonical_severity: highest severity across reviews
+    - match_confidence: average pairwise similarity score within group
     """
     # Collect all findings with their source
     all_findings: list[tuple[str, dict]] = []
@@ -165,39 +210,72 @@ def match_findings(
         for f in findings:
             all_findings.append((review_id, f))
 
-    # Greedy matching: for each finding, check if it matches an existing group
+    # Compute all pairwise scores above threshold
+    scores = compute_pairwise_scores(all_findings, threshold)
+
+    # Max-weight greedy assignment: consume best matches first
+    # Each finding can be in exactly one group
+    # Each group has at most one finding per review
     groups: list[dict] = []
-    used: set[int] = set()
+    assigned: dict[int, int] = {}  # finding_index -> group_index
 
-    for i, (rid_i, f_i) in enumerate(all_findings):
-        if i in used:
+    for i, j, score in scores:
+        rid_i = all_findings[i][0]
+        rid_j = all_findings[j][0]
+
+        gi = assigned.get(i)
+        gj = assigned.get(j)
+
+        if gi is not None and gj is not None:
+            # Both already in groups — skip (no merging to keep it simple)
             continue
+        elif gi is not None:
+            # i is in a group, try to add j to it
+            group = groups[gi]
+            if rid_j not in group["matched_findings"]:
+                # Check j against all existing group members (not just seed)
+                avg_sim = _avg_similarity_to_group(all_findings[j][1], group, all_findings)
+                if avg_sim >= threshold:
+                    group["matched_findings"][rid_j] = all_findings[j][1]
+                    group["convergence"].append(rid_j)
+                    group["_scores"].append(score)
+                    assigned[j] = gi
+        elif gj is not None:
+            # j is in a group, try to add i to it
+            group = groups[gj]
+            if rid_i not in group["matched_findings"]:
+                avg_sim = _avg_similarity_to_group(all_findings[i][1], group, all_findings)
+                if avg_sim >= threshold:
+                    group["matched_findings"][rid_i] = all_findings[i][1]
+                    group["convergence"].append(rid_i)
+                    group["_scores"].append(score)
+                    assigned[i] = gj
+        else:
+            # Neither in a group — create new group
+            new_group = {
+                "matched_findings": {rid_i: all_findings[i][1], rid_j: all_findings[j][1]},
+                "convergence": [rid_i, rid_j],
+                "_scores": [score],
+            }
+            group_idx = len(groups)
+            groups.append(new_group)
+            assigned[i] = group_idx
+            assigned[j] = group_idx
 
-        group = {
-            "matched_findings": {rid_i: f_i},
-            "convergence": [rid_i],
-        }
-        used.add(i)
+    # Create singleton groups for unmatched findings
+    for idx, (rid, finding) in enumerate(all_findings):
+        if idx not in assigned:
+            groups.append({
+                "matched_findings": {rid: finding},
+                "convergence": [rid],
+                "_scores": [],
+            })
 
-        for j, (rid_j, f_j) in enumerate(all_findings):
-            if j in used or rid_j == rid_i:
-                continue
-            # Already have a finding from this review in the group
-            if rid_j in group["matched_findings"]:
-                continue
-
-            # Match by file + title similarity
-            file_sim = similarity(f_i.get("file", ""), f_j.get("file", ""))
-            title_sim = similarity(f_i.get("title", ""), f_j.get("title", ""))
-            combined = 0.3 * file_sim + 0.7 * title_sim
-
-            if combined >= threshold:
-                group["matched_findings"][rid_j] = f_j
-                group["convergence"].append(rid_j)
-                used.add(j)
-
-        # Set canonical values
-        first_finding = f_i
+    # Set canonical values and match confidence for all groups
+    for group in groups:
+        # Canonical = first finding in the group (by review ID order)
+        first_rid = group["convergence"][0]
+        first_finding = group["matched_findings"][first_rid]
         group["canonical_title"] = first_finding.get("title", "unknown")
         group["canonical_file"] = first_finding.get("file", "unknown")
 
@@ -210,11 +288,32 @@ def match_findings(
         rev_ordinal = {v: k for k, v in SEVERITY_ORDINAL.items()}
         group["canonical_severity"] = rev_ordinal.get(max_sev_ord, "low")
 
-        groups.append(group)
+        # Match confidence = average of pairwise scores in this group
+        if group["_scores"]:
+            group["match_confidence"] = round(sum(group["_scores"]) / len(group["_scores"]), 4)
+        else:
+            group["match_confidence"] = None  # singleton — no match to score
+
+        del group["_scores"]
 
     return groups
 
 
+def _avg_similarity_to_group(
+    finding: dict,
+    group: dict,
+    all_findings: list[tuple[str, dict]],
+) -> float:
+    """Compute average similarity of a finding to all existing members of a group."""
+    sims = []
+    for rid, existing_f in group["matched_findings"].items():
+        file_sim = similarity(finding.get("file", ""), existing_f.get("file", ""))
+        title_sim = similarity(finding.get("title", ""), existing_f.get("title", ""))
+        combined = 0.3 * file_sim + 0.7 * title_sim
+        sims.append(combined)
+    return sum(sims) / len(sims) if sims else 0.0
+
+
 # ── Metrics Computation ────────────────────────────────────────
 
 def compute_metrics(
@@ -224,6 +323,7 @@ def compute_metrics(
 ) -> dict:
     """Compute all Darkcat Alley metrics from matched finding groups."""
 
+    n_reviews = len(review_ids)
     total = len(groups)
 
     # Metric 1: Finding count by model
@@ -233,7 +333,7 @@ def compute_metrics(
         t = sum(1 for g in groups if rid in g["convergence"])
         u = sum(1 for g in groups if g["convergence"] == [rid])
         s2 = sum(1 for g in groups if rid in g["convergence"] and len(g["convergence"]) == 2)
-        s3 = sum(1 for g in groups if rid in g["convergence"] and len(g["convergence"]) == 3)
+        s3 = sum(1 for g in groups if rid in g["convergence"] and len(g["convergence"]) >= 3)
         finding_count[rid] = {
             "model": model_name,
             "total": t,
@@ -243,35 +343,73 @@ def compute_metrics(
         }
 
     # Metric 2: Convergence rate
-    converged_3 = sum(1 for g in groups if len(g["convergence"]) == 3)
+    converged_all = sum(1 for g in groups if len(g["convergence"]) == n_reviews)
     converged_2 = sum(1 for g in groups if len(g["convergence"]) == 2)
     single_model = sum(1 for g in groups if len(g["convergence"]) == 1)
+    converged_2plus = converged_all + converged_2
     convergence_rate = {
         "total_unique_findings": total,
-        "converged_3": converged_3,
+        "n_reviews": n_reviews,
+        "converged_all": converged_all,
         "converged_2": converged_2,
         "single_model": single_model,
-        "rate_3": round(converged_3 / total, 4) if total else 0,
-        "rate_2plus": round((converged_3 + converged_2) / total, 4) if total else 0,
+        "rate_all": round(converged_all / total, 4) if total else 0,
+        "rate_2plus": round(converged_2plus / total, 4) if total else 0,
         "rate_single": round(single_model / total, 4) if total else 0,
     }
 
-    # Metric 3: Marginal value (in order R1, R2, R3)
-    seen: set[int] = set()
-    marginal = []
-    for rid in review_ids:
-        new_unique = 0
-        for idx, g in enumerate(groups):
-            if rid in g["convergence"] and idx not in seen:
-                new_unique += 1
-                seen.add(idx)
-        marginal.append({
-            "model": reviews_data[rid].get("review", {}).get("model", rid),
-            "review_id": rid,
-            "cumulative_unique": len(seen),
-            "new_unique": new_unique,
+    # Metric 3: Marginal value — all permutations
+    all_marginals = []
+    for perm in permutations(review_ids):
+        seen: set[int] = set()
+        perm_marginal = []
+        for rid in perm:
+            new_unique = 0
+            for idx, g in enumerate(groups):
+                if rid in g["convergence"] and idx not in seen:
+                    new_unique += 1
+                    seen.add(idx)
+            perm_marginal.append({
+                "model": reviews_data[rid].get("review", {}).get("model", rid),
+                "review_id": rid,
+                "cumulative_unique": len(seen),
+                "new_unique": new_unique,
+            })
+        all_marginals.append({"order": list(perm), "cumulative": perm_marginal})
+
+    # Compute mean marginal value per position across all orderings
+    n_perms = len(all_marginals)
+    position_means = []
+    for pos in range(n_reviews):
+        mean_new = sum(m["cumulative"][pos]["new_unique"] for m in all_marginals) / n_perms
+        mean_cum = sum(m["cumulative"][pos]["cumulative_unique"] for m in all_marginals) / n_perms
+        position_means.append({
+            "position": pos + 1,
+            "mean_new_unique": round(mean_new, 2),
+            "mean_cumulative": round(mean_cum, 2),
         })
-    marginal_value = {"order": review_ids, "cumulative": marginal}
+
+    # Per-model mean marginal value (average new_unique across all positions this model appears)
+    model_mean_marginal = {}
+    for rid in review_ids:
+        model_name = reviews_data[rid].get("review", {}).get("model", rid)
+        new_uniques = []
+        for m in all_marginals:
+            for entry in m["cumulative"]:
+                if entry["review_id"] == rid:
+                    new_uniques.append(entry["new_unique"])
+        model_mean_marginal[rid] = {
+            "model": model_name,
+            "mean_new_unique": round(sum(new_uniques) / len(new_uniques), 2) if new_uniques else 0,
+        }
+
+    marginal_value = {
+        "dispatch_order": {"order": review_ids, "cumulative": all_marginals[0]["cumulative"] if all_marginals else []},
+        "all_permutations": all_marginals,
+        "position_means": position_means,
+        "model_means": model_mean_marginal,
+        "n_permutations": n_perms,
+    }
 
     # Metric 4: Severity distribution by model
     severity_dist = {}
@@ -306,34 +444,53 @@ def compute_metrics(
     severity_calibration = []
     for g in groups:
         if len(g["convergence"]) >= 2:
-            entry = {"finding": g["canonical_title"]}
+            entry = {"finding": g["canonical_title"], "match_confidence": g.get("match_confidence")}
             severities_seen = {}
             for rid in g["convergence"]:
                 f = g["matched_findings"].get(rid)
                 if f:
-                    model_name = reviews_data[rid].get("review", {}).get("model", rid)
                     sev = f.get("severity", "low")
-                    severities_seen[model_name] = sev
+                    severities_seen[rid] = sev
                     entry[f"severity_{rid}"] = sev
             ordinals = [SEVERITY_ORDINAL.get(s, 1) for s in severities_seen.values()]
             entry["agreement"] = len(set(ordinals)) == 1
             entry["max_delta"] = max(ordinals) - min(ordinals) if ordinals else 0
             severity_calibration.append(entry)
 
-    # Metric 8: False positive rate (placeholder — requires human input)
-    fp_rate = {}
+    # Metric 8: False positive rate — NOT YET ADJUDICATED
+    # All findings default to "pending" — no claims about FP rate until human review
+    fp_rate = {
+        "status": "pending_adjudication",
+        "note": "FP rate requires human verification of each finding. Values below are placeholders, not measurements.",
+        "per_model": {},
+    }
     for rid in review_ids:
         model_name = reviews_data[rid].get("review", {}).get("model", rid)
         t = sum(1 for g in groups if rid in g["convergence"])
-        fp_rate[rid] = {
+        fp_rate["per_model"][rid] = {
             "model": model_name,
             "total_findings": t,
-            "confirmed_true": t,  # Default: all true until marked otherwise
-            "confirmed_false": 0,
-            "disputed": 0,
-            "fp_rate": 0.0,
+            "confirmed_true": None,
+            "confirmed_false": None,
+            "disputed": None,
+            "fp_rate": None,
         }
 
+    # Match diagnostics — report match quality
+    converged_groups = [g for g in groups if len(g["convergence"]) >= 2]
+    match_diagnostics = {
+        "threshold": 0.6,
+        "total_groups": len(groups),
+        "converged_groups": len(converged_groups),
+        "singleton_groups": len(groups) - len(converged_groups),
+    }
+    if converged_groups:
+        confidences = [g["match_confidence"] for g in converged_groups if g["match_confidence"] is not None]
+        if confidences:
+            match_diagnostics["avg_confidence"] = round(sum(confidences) / len(confidences), 4)
+            match_diagnostics["min_confidence"] = round(min(confidences), 4)
+            match_diagnostics["max_confidence"] = round(max(confidences), 4)
+
     return {
         "computed_at": datetime.now(timezone.utc).isoformat(),
         "finding_count": finding_count,
@@ -343,6 +500,7 @@ def compute_metrics(
         "watchdog_distribution": watchdog_dist,
         "severity_calibration": severity_calibration,
         "false_positive_rate": fp_rate,
+        "match_diagnostics": match_diagnostics,
     }
 
 
@@ -351,6 +509,7 @@ def compute_metrics(
 def format_summary(groups: list[dict], metrics: dict, review_ids: list[str], reviews_data: dict) -> str:
     """Format a human-readable summary of the triangulation."""
     lines = []
+    n_reviews = len(review_ids)
     lines.append("=" * 72)
     lines.append("  DARKCAT ALLEY — TRIANGULATION SUMMARY")
     lines.append("=" * 72)
@@ -369,25 +528,52 @@ def format_summary(groups: list[dict], metrics: dict, review_ids: list[str], rev
     cr = metrics["convergence_rate"]
     lines.append("CONVERGENCE:")
     lines.append(f"  Total unique findings: {cr['total_unique_findings']}")
-    lines.append(f"  All 3 models:          {cr['converged_3']} ({cr['rate_3']:.1%})")
-    lines.append(f"  2 of 3 models:         {cr['converged_2']} ({cr['rate_2plus'] - cr['rate_3']:.1%})")
+    if n_reviews >= 3:
+        lines.append(f"  All {n_reviews} models:          {cr['converged_all']} ({cr['rate_all']:.1%})")
+    rate_2only = cr['rate_2plus'] - cr['rate_all']
+    lines.append(f"  2 of {n_reviews} models:         {cr['converged_2']} ({rate_2only:.1%})")
     lines.append(f"  Single model only:     {cr['single_model']} ({cr['rate_single']:.1%})")
     lines.append("")
 
-    # Marginal value
-    lines.append("MARGINAL VALUE (in dispatch order):")
-    for m in metrics["marginal_value"]["cumulative"]:
+    # Match diagnostics
+    md = metrics.get("match_diagnostics", {})
+    if md.get("avg_confidence") is not None:
+        lines.append("MATCH DIAGNOSTICS:")
+        lines.append(f"  Threshold: {md.get('threshold', '?')}")
+        lines.append(f"  Avg confidence: {md.get('avg_confidence', '?')}")
+        lines.append(f"  Min confidence: {md.get('min_confidence', '?')}")
+        lines.append(f"  Max confidence: {md.get('max_confidence', '?')}")
+        lines.append("")
+
+    # Marginal value (dispatch order)
+    mv = metrics["marginal_value"]
+    lines.append("MARGINAL VALUE (dispatch order):")
+    for m in mv["dispatch_order"]["cumulative"]:
         lines.append(f"  {m['model']:20s}  +{m['new_unique']:2d} new  ({m['cumulative_unique']:2d} cumulative)")
     lines.append("")
 
+    # Marginal value (mean across all orderings)
+    lines.append(f"MARGINAL VALUE (mean across {mv['n_permutations']} orderings):")
+    for pm in mv["position_means"]:
+        lines.append(f"  Position {pm['position']}: +{pm['mean_new_unique']:.1f} new  ({pm['mean_cumulative']:.1f} cumulative)")
+    lines.append("")
+
+    lines.append("MODEL MEAN MARGINAL VALUE:")
+    for rid in review_ids:
+        mm = mv["model_means"][rid]
+        lines.append(f"  {mm['model']:20s}  mean +{mm['mean_new_unique']:.1f} new per ordering")
+    lines.append("")
+
     # Converged findings (highest priority)
     converged = [g for g in groups if len(g["convergence"]) >= 2]
     if converged:
         lines.append("CONVERGED FINDINGS (2+ models agree):")
-        for g in sorted(converged, key=lambda x: -len(x["convergence"])):
+        for g in sorted(converged, key=lambda x: (-len(x["convergence"]), -SEVERITY_ORDINAL.get(x["canonical_severity"], 0))):
             conv = ",".join(g["convergence"])
+            conf = g.get("match_confidence")
+            conf_str = f" (conf={conf:.2f})" if conf is not None else ""
             lines.append(f"  [{g['canonical_severity'].upper():8s}] {g['canonical_title']}")
-            lines.append(f"           → {g['canonical_file']}  [{conv}]")
+            lines.append(f"           → {g['canonical_file']}  [{conv}]{conf_str}")
         lines.append("")
 
     # Single-model findings
@@ -437,6 +623,12 @@ def format_summary(groups: list[dict], metrics: dict, review_ids: list[str], rev
                 lines.append(f"      {sevs}  (delta: {d['max_delta']})")
     lines.append("")
 
+    # FP rate status
+    fp = metrics.get("false_positive_rate", {})
+    lines.append(f"FALSE POSITIVE RATE: {fp.get('status', 'unknown').upper()}")
+    lines.append(f"  {fp.get('note', '')}")
+    lines.append("")
+
     lines.append("=" * 72)
     lines.append(f"  Computed: {metrics['computed_at']}")
     lines.append("=" * 72)
@@ -455,15 +647,16 @@ def format_convergence_matrix(groups: list[dict], review_ids: list[str], reviews
     for rid in review_ids:
         model = reviews_data[rid].get("review", {}).get("model", rid)[:10]
         header += f"| {model} "
-    header += "| Converge |"
+    header += "| Converge | Confidence |"
     lines.append(header)
 
     sep = "|---------|----------"
     for _ in review_ids:
         sep += "|:---:"
-    sep += "|----------|"
+    sep += "|----------|------------|"
     lines.append(sep)
 
+    n_reviews = len(review_ids)
     for g in sorted(groups, key=lambda x: (-len(x["convergence"]), -SEVERITY_ORDINAL.get(x["canonical_severity"], 0))):
         row = f"| {g['canonical_title'][:50]} | {g['canonical_severity'].upper()} "
         for rid in review_ids:
@@ -472,12 +665,14 @@ def format_convergence_matrix(groups: list[dict], review_ids: list[str], reviews
             else:
                 row += "| — "
         conv_count = len(g["convergence"])
-        if conv_count == 3:
-            row += "| **ALL 3** |"
-        elif conv_count == 2:
-            row += f"| {'+'.join(g['convergence'])} |"
+        conf = g.get("match_confidence")
+        conf_str = f"{conf:.2f}" if conf is not None else "—"
+        if conv_count == n_reviews:
+            row += f"| **ALL {n_reviews}** | {conf_str} |"
+        elif conv_count >= 2:
+            row += f"| {'+'.join(g['convergence'])} | {conf_str} |"
         else:
-            row += f"| {g['convergence'][0]} only |"
+            row += f"| {g['convergence'][0]} only | — |"
         lines.append(row)
 
     return "\n".join(lines)
@@ -525,13 +720,14 @@ def export_all(
             "severity": g["canonical_severity"],
             "convergence": g["convergence"],
             "convergence_count": len(g["convergence"]),
+            "match_confidence": g.get("match_confidence"),
         })
     write_yaml(out_dir / "convergence.yaml", convergence)
 
     # All metrics
     write_yaml(out_dir / "metrics.yaml", metrics)
 
-    # Union of findings (deduplicated)
+    # Union of findings (deduplicated) — include recommendation and line
     union = []
     for g in groups:
         entry = {
@@ -540,6 +736,7 @@ def export_all(
             "severity": g["canonical_severity"],
             "found_by": g["convergence"],
             "convergence_count": len(g["convergence"]),
+            "match_confidence": g.get("match_confidence"),
             "details": {},
         }
         for rid, f in g["matched_findings"].items():
@@ -548,7 +745,9 @@ def export_all(
                 "severity": f.get("severity"),
                 "watchdog": f.get("watchdog"),
                 "slopodar": f.get("slopodar"),
+                "line": f.get("line"),
                 "description": f.get("description"),
+                "recommendation": f.get("recommendation"),
             }
         union.append(entry)
     write_yaml(out_dir / "findings-union.yaml", union)
@@ -563,9 +762,19 @@ def export_all(
 
 
 def write_yaml(path: Path, data: Any) -> None:
-    """Write data to a YAML file."""
+    """Write data to a YAML file with readable multi-line strings."""
+    class MultilineDumper(yaml.SafeDumper):
+        pass
+
+    def str_representer(dumper: yaml.SafeDumper, data: str) -> Any:
+        if "\n" in data or len(data) > 100:
+            return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
+        return dumper.represent_scalar("tag:yaml.org,2002:str", data)
+
+    MultilineDumper.add_representer(str, str_representer)
+
     with open(path, "w", encoding="utf-8") as f:
-        yaml.dump(data, f, default_flow_style=False, sort_keys=False, allow_unicode=True, width=120)
+        yaml.dump(data, f, Dumper=MultilineDumper, default_flow_style=False, sort_keys=False, allow_unicode=True, width=120)
 
 
 # ── CLI ────────────────────────────────────────────────────────
@@ -576,6 +785,25 @@ def usage() -> None:
     sys.exit(1)
 
 
+def parse_cli_args(args: list[str]) -> tuple[list[str], dict[str, str]]:
+    """Parse CLI args into positional file paths and named options.
+
+    Separates --flag value pairs from positional arguments.
+    Returns (file_paths, options_dict).
+    """
+    files = []
+    options = {}
+    i = 0
+    while i < len(args):
+        if args[i].startswith("--") and i + 1 < len(args):
+            options[args[i]] = args[i + 1]
+            i += 2
+        else:
+            files.append(args[i])
+            i += 1
+    return files, options
+
+
 def cmd_parse(args: list[str]) -> None:
     """Parse and validate a single review file."""
     if len(args) < 1:
@@ -606,10 +834,14 @@ def cmd_parse(args: list[str]) -> None:
         print(f"  [{sev:8s}] {title}")
 
 
-def load_reviews(r1_path: str, r2_path: str, r3_path: str) -> tuple[list[str], dict, dict]:
-    """Load and validate 3 review files. Returns (review_ids, reviews_data, raw_findings)."""
-    review_ids = ["R1", "R2", "R3"]
-    paths = {"R1": r1_path, "R2": r2_path, "R3": r3_path}
+def load_reviews(file_paths: list[str]) -> tuple[list[str], dict, dict]:
+    """Load and validate 2+ review files. Returns (review_ids, reviews_data, raw_findings)."""
+    if len(file_paths) < 2:
+        print("ERROR: At least 2 review files required", file=sys.stderr)
+        sys.exit(1)
+
+    review_ids = [f"R{i+1}" for i in range(len(file_paths))]
+    paths = dict(zip(review_ids, file_paths))
     reviews_data: dict[str, dict] = {}
     all_warnings: list[str] = []
 
@@ -634,16 +866,13 @@ def load_reviews(r1_path: str, r2_path: str, r3_path: str) -> tuple[list[str], d
 
 def cmd_summary(args: list[str]) -> None:
     """Print human-readable summary."""
-    if len(args) < 3:
-        print("Usage: triangulate summary <r1> <r2> <r3>")
+    files, options = parse_cli_args(args)
+    if len(files) < 2:
+        print("Usage: triangulate summary <r1> <r2> [<r3>] [--match-threshold <float>]")
         sys.exit(1)
 
-    threshold = 0.6
-    for i, a in enumerate(args):
-        if a == "--match-threshold" and i + 1 < len(args):
-            threshold = float(args[i + 1])
-
-    review_ids, reviews_data, reviews = load_reviews(args[0], args[1], args[2])
+    threshold = float(options.get("--match-threshold", "0.6"))
+    review_ids, reviews_data, reviews = load_reviews(files)
     groups = match_findings(reviews, threshold)
     metrics = compute_metrics(groups, review_ids, reviews_data)
     print(format_summary(groups, metrics, review_ids, reviews_data))
@@ -651,16 +880,13 @@ def cmd_summary(args: list[str]) -> None:
 
 def cmd_metrics(args: list[str]) -> None:
     """Output machine-readable YAML metrics."""
-    if len(args) < 3:
-        print("Usage: triangulate metrics <r1> <r2> <r3>")
+    files, options = parse_cli_args(args)
+    if len(files) < 2:
+        print("Usage: triangulate metrics <r1> <r2> [<r3>] [--match-threshold <float>]")
         sys.exit(1)
 
-    threshold = 0.6
-    for i, a in enumerate(args):
-        if a == "--match-threshold" and i + 1 < len(args):
-            threshold = float(args[i + 1])
-
-    review_ids, reviews_data, reviews = load_reviews(args[0], args[1], args[2])
+    threshold = float(options.get("--match-threshold", "0.6"))
+    review_ids, reviews_data, reviews = load_reviews(files)
     groups = match_findings(reviews, threshold)
     metrics = compute_metrics(groups, review_ids, reviews_data)
     yaml.dump(metrics, sys.stdout, default_flow_style=False, sort_keys=False, allow_unicode=True, width=120)
@@ -668,49 +894,31 @@ def cmd_metrics(args: list[str]) -> None:
 
 def cmd_convergence(args: list[str]) -> None:
     """Output convergence matrix in markdown."""
-    if len(args) < 3:
-        print("Usage: triangulate convergence <r1> <r2> <r3>")
+    files, options = parse_cli_args(args)
+    if len(files) < 2:
+        print("Usage: triangulate convergence <r1> <r2> [<r3>] [--match-threshold <float>]")
         sys.exit(1)
 
-    threshold = 0.6
-    for i, a in enumerate(args):
-        if a == "--match-threshold" and i + 1 < len(args):
-            threshold = float(args[i + 1])
-
-    review_ids, reviews_data, reviews = load_reviews(args[0], args[1], args[2])
+    threshold = float(options.get("--match-threshold", "0.6"))
+    review_ids, reviews_data, reviews = load_reviews(files)
     groups = match_findings(reviews, threshold)
     print(format_convergence_matrix(groups, review_ids, reviews_data))
 
 
 def cmd_export(args: list[str]) -> None:
     """Export all data products."""
-    if len(args) < 3:
-        print("Usage: triangulate export <r1> <r2> <r3> [--out <dir>] [--run <id>]")
+    files, options = parse_cli_args(args)
+    if len(files) < 2:
+        print("Usage: triangulate export <r1> <r2> [<r3>] [--out <dir>] [--run <id>]")
         sys.exit(1)
 
-    out_dir = None
-    run_id = datetime.now(timezone.utc).strftime("run-%Y%m%d-%H%M%S")
-    threshold = 0.6
+    out_dir_str = options.get("--out")
+    run_id = options.get("--run", datetime.now(timezone.utc).strftime("run-%Y%m%d-%H%M%S"))
+    threshold = float(options.get("--match-threshold", "0.6"))
 
-    # Parse optional args after the 3 review files
-    i = 3
-    while i < len(args):
-        if args[i] == "--out" and i + 1 < len(args):
-            out_dir = Path(args[i + 1])
-            i += 2
-        elif args[i] == "--run" and i + 1 < len(args):
-            run_id = args[i + 1]
-            i += 2
-        elif args[i] == "--match-threshold" and i + 1 < len(args):
-            threshold = float(args[i + 1])
-            i += 2
-        else:
-            i += 1
+    out_dir = Path(out_dir_str) if out_dir_str else Path("data/alley") / run_id
 
-    if out_dir is None:
-        out_dir = Path("data/alley") / run_id
-
-    review_ids, reviews_data, reviews = load_reviews(args[0], args[1], args[2])
+    review_ids, reviews_data, reviews = load_reviews(files)
     groups = match_findings(reviews, threshold)
     metrics = compute_metrics(groups, review_ids, reviews_data)
     export_all(groups, metrics, review_ids, reviews_data, out_dir, run_id)

```
