# Smoke test snippet for fleet validation
# Contains 3 deliberate bugs for models to find


def calculate_discount(price: float, tier: str) -> float:
    """Apply tier-based discount. Returns discounted price.
    Tiers: bronze (5%), silver (10%), gold (20%), platinum (30%)."""
    discounts = {
        "bronze": 0.05,
        "silver": 0.10,
        "gold": 0.20,
        # BUG 1: platinum missing from dict despite docstring claiming it
    }
    discount = discounts.get(tier, 0)
    return price * discount  # BUG 2: returns discount amount, not discounted price


def deduplicate_users(users: list[dict]) -> list[dict]:
    """Remove duplicate users by email. Preserves first occurrence."""
    seen = set()
    result = []
    for user in users:
        email = user.get("email", "").lower()
        if email not in seen:
            seen.add(email)
            result.append(user)
        else:
            seen.add(
                email
            )  # BUG 3: redundant add, but also silently drops user without logging
    return result
