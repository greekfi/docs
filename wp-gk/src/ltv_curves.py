"""
Loan-to-Value (LTV) of a Receipt-Token-collateralised loan, plotted against
moneyness for a single 30-day, σ=50% call option and a few representative
issuance LTVs (α).

Setup. A borrower posts the Receipt Token as collateral and draws a loan
denominated in the underlying:

    V(S) = S - C(S)             (Receipt value per unit collateral)
    L    = α · S                (loan, α set at issuance)
    LTV(S) = L / V(S) = α / (1 - Π(S))      where Π = C(S)/S.

At moneyness S/K = 1 with non-zero time value, Π is already positive, so
LTV(t=0) > α. As the option moves ITM, Π grows and LTV climbs toward (and
through) the liquidation line. The visual story: how much room each α leaves
before the call premium eats the collateral cushion.

Run:
    python ltv_curves.py
Outputs:
    ltv_curves.png  (same directory as this script)
"""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from scipy.stats import norm


def bs_call(S: np.ndarray, K: float, r: float, sigma: float, T: float) -> np.ndarray:
    """Black-Scholes call price (no dividends)."""
    if T <= 0.0:
        return np.maximum(S - K, 0.0)
    sqrtT = np.sqrt(T)
    d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * sqrtT)
    d2 = d1 - sigma * sqrtT
    return S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)


def main() -> None:
    K = 100.0
    r = 0.0
    sigma = 0.50           # single 30-day, σ=50% option
    T = 30.0 / 365.0
    LIQUIDATION = 1.0      # LTV >= 1 = insolvent
    SOFT_THRESHOLD = 0.90  # typical Aave-style liquidation trigger

    S = np.linspace(80.0, 180.0, 600)
    moneyness = S / K
    premium = bs_call(S, K, r, sigma=sigma, T=T)
    pi = premium / S
    receipt_fraction = 1.0 - pi  # 1 - Π

    alphas = [0.5, 0.6, 0.7, 0.8]
    colors = ["#1f3a8a", "#3b82f6", "#93c5fd", "#f59e0b"]

    fig, ax = plt.subplots(figsize=(8.0, 5.0))

    # Danger / liquidation shading.
    ax.axhspan(LIQUIDATION, 1.4, color="#fecaca", alpha=0.55, zorder=0,
               label="Insolvent ($\\mathrm{LTV} \\geq 1$)")
    ax.axhspan(SOFT_THRESHOLD, LIQUIDATION, color="#fde68a", alpha=0.55, zorder=0,
               label=f"Liquidation zone (≥ {SOFT_THRESHOLD:.2f})")

    for alpha, color in zip(alphas, colors):
        ltv = alpha / receipt_fraction
        ax.plot(moneyness, ltv, lw=2.2, color=color, label=f"α = {alpha:.1f}")

    ax.axvline(1.0, color="#9ca3af", ls="--", lw=1, alpha=0.7)
    ax.set_xlabel("Moneyness  ($S / K$)")
    ax.set_ylabel(r"LTV  $= \alpha / (1 - \Pi)$")
    ax.set_title("LTV vs. Moneyness — 30-day, σ=50% option")
    ax.set_xlim(moneyness.min(), moneyness.max())
    ax.set_ylim(0.4, 1.2)
    ax.grid(alpha=0.25)
    ax.legend(loc="upper left", framealpha=0.95)

    out = Path(__file__).resolve().parent / "ltv_curves.png"
    fig.tight_layout()
    fig.savefig(out, dpi=150)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
