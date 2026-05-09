"""
Receipt-Token value as a fraction of the underlying collateral price,
plotted against moneyness for three premium regimes:

  1. theoretical (sharp hockey stick) -- intrinsic option value at expiry
  2. soft -- a typical pre-expiry premium (~30 days, moderate vol)
  3. lower -- a longer-dated / higher-vol premium (more time value)

For a covered call writer, the receipt position is worth
    receipt = collateral_price - premium
because the receipt holder owes the option premium back to the long. Dividing
by the collateral price gives a unitless quantity capped at 1: defining the
premium fraction Π = C(S) / S yields

    y(S) = 1 - Π      where C is the call price.

At expiry, C(S) = max(S - K, 0), so y collapses to min(1, K/S) -- the sharp
right-angle "hockey stick" reflected through 1. Pre-expiry the time value
softens the corner; longer time / higher vol pushes the curve down further.

Run:
    python short_value_curves.py
Outputs:
    short_value_curves.png  (same directory as this script)
"""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from scipy.stats import norm


def bs_call(S: np.ndarray, K: float, r: float, sigma: float, T: float) -> np.ndarray:
    """Black-Scholes call price (no dividends). Vectorised over S."""
    if T <= 0.0:
        return np.maximum(S - K, 0.0)
    sqrtT = np.sqrt(T)
    d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * sqrtT)
    d2 = d1 - sigma * sqrtT
    return S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)


def main() -> None:
    K = 100.0
    r = 0.0  # zero-rate keeps the visual centred on volatility/time effects
    S = np.linspace(40.0, 220.0, 600)
    moneyness = S / K

    # Three premium scenarios, increasing in time-value content.
    premium_intrinsic = np.maximum(S - K, 0.0)                # sharp hockey stick
    premium_soft = bs_call(S, K, r, sigma=0.50, T=30 / 365)   # 30 days, 50% vol
    premium_lower = bs_call(S, K, r, sigma=0.80, T=180 / 365) # 6 months, 80% vol

    receipt_intrinsic = (S - premium_intrinsic) / S
    receipt_soft = (S - premium_soft) / S
    receipt_lower = (S - premium_lower) / S

    fig, ax = plt.subplots(figsize=(8.0, 5.0))
    ax.plot(moneyness, receipt_intrinsic, lw=2.4, color="#1f3a8a",
            label="Theoretical (at expiry)")
    ax.plot(moneyness, receipt_soft, lw=2.0, color="#3b82f6",
            label="30-day, σ=50%")
    ax.plot(moneyness, receipt_lower, lw=2.0, color="#93c5fd",
            label="180-day, σ=80%")

    ax.axvline(1.0, color="#9ca3af", ls="--", lw=1, alpha=0.7)
    ax.axhline(1.0, color="#9ca3af", ls=":", lw=1, alpha=0.5)
    ax.set_xlabel("Moneyness  ($S / K$)")
    ax.set_ylabel(r"Receipt value / Collateral price  $1 - \Pi$")
    ax.set_title("Receipt-Token Value vs. Moneyness")
    ax.set_xlim(moneyness.min(), 1.5)
    ax.set_ylim(0.0, 1.05)
    ax.grid(alpha=0.25)
    ax.legend(loc="lower left", framealpha=0.95)

    out = Path(__file__).resolve().parent / "short_value_curves.png"
    fig.tight_layout()
    fig.savefig(out, dpi=150)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
