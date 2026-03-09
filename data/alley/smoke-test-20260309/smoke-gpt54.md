Section 1

I found two substantive issues.

First, `calculate_discount` does not match its own contract in two ways. Its docstring says it “Returns discounted price,” which implies the final price after applying the discount, but the implementation returns only the discount amount (`price * discount`). In addition, the docstring advertises support for a `platinum` tier at 30%, but that tier is missing from the lookup table and silently receives no discount. This is a high-severity correctness issue because callers can easily compute and display the wrong price while believing they are using a documented API.

Second, `deduplicate_users` treats missing emails as the same normalized key `""`, so only the first user without an email is preserved and all later such users are dropped as “duplicates.” That is usually not what “duplicate users by email” means, because records lacking an email cannot be safely deduplicated by that field. There is also a small dead-code smell in the `else` branch where `seen.add(email)` is repeated after membership has already been established.

```yaml
review:
  model: "gpt-5"
  date: "2026-03-09"
  branches:
    - "main"
  base_commit: "smoke-test"
findings:
  - id: F-001
    branch: "main"
    file: "smoke-test-snippet.py"
    line: "1-10"
    severity: high
    watchdog: WD-SH
    slopodar: none
    title: "Discount function contradicts docstring and omits documented platinum tier"
    description: >
      The function claims to "Return discounted price" and documents four tiers,
      including platinum at 30%. The implementation instead returns only the
      discount amount (`price * discount`) rather than the final post-discount
      price, and the discounts table does not include `platinum` at all. As a
      result, callers following the documented API will compute incorrect totals,
      and platinum customers silently receive no discount.
    recommendation: "Either return `price * (1 - discount)` or rename/document the function as returning the discount amount, and add the missing `platinum: 0.30` tier if it is intended to be supported."
  - id: F-002
    branch: "main"
    file: "smoke-test-snippet.py"
    line: "12-22"
    severity: medium
    watchdog: WD-LRT
    slopodar: none
    title: "Users without email are incorrectly collapsed into a single record"
    description: >
      Deduplication is keyed on `user.get(\"email\", \"\").lower()`. For any user
      missing an email, the key becomes the empty string, so only the first such
      record is kept and all subsequent users without email are discarded as
      duplicates. This is a looks-right trap: normalizing and deduplicating by
      email is reasonable, but applying the same key to absent emails causes
      unrelated users to be merged.
    recommendation: "Treat missing or empty emails as non-deduplicable records (e.g., always keep them), or validate that email is present before using it as the deduplication key."
  - id: F-003
    branch: "main"
    file: "smoke-test-snippet.py"
    line: "19-22"
    severity: low
    watchdog: WD-DC
    slopodar: none
    title: "Redundant `seen.add(email)` in else branch is dead code"
    description: >
      Inside the `else` branch, `seen.add(email)` is executed even though the
      branch is only reached when `email in seen` is already true. This has no
      effect and adds noise that can obscure the actual deduplication logic.
    recommendation: "Remove the redundant `seen.add(email)` from the `else` branch."
```