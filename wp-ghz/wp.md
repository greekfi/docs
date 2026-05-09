---
abstract: |
  We present AMMO, the Automated Market Maker for American Options
  created through the Greek Protocol. While most AMMs prices are
  dictacted through quantity and tick pricing, AMMO differs from typical
  AMMs in that the price is influenced be the Black-Scholes equation,
  which primarily depends on the price of the underlying asset, time to
  expiry, and volatity as inputs. AMMO also allows for variable spreads
  provided by Liquidity Providers, a trade-off between profit and
  patience. Because the AMM uses GreekFi Options Protocol where the
  underlying asset can be collateralized into an option just-in-time,
  the AMM can provide an option at any strike and expiry from a pool of
  liquidity without sacrificing fragmentation.
author:
- Mahmoud Lababidi
date: June 26, 2025
title: Gigahertz - Automated Market Maker for Options
---

# []{#sec:introduction label="sec:introduction"}Introduction

## Background

The crypto derivative market offerings have proliferated recently with
the rise of Deribit, Hyperliquid, Coinbase futures, Binance, etc. The
strength of these platforms have shown that interest in derivative
investments is ever-increasing. One aspect that seems missing from the
space is a DeFi approach to options, in particular where tokenized
options products can be used in a decentralized, composable manner.
GreekFi Options Protocol provides that composability, enabling a market
for these options.

Inspired by the automated and decentralized nature of AMMs and
perpetuals markets, we introduce Automated Market Maker for American
Options (AMMO). AMMO is an Oracle driven Market where the options prices
are dictated by the Black-Scholes formula.

### Motivation

While $xy=k$ is one of the most revolutionary implementations in
decentralized finance, we wave the white flag to the inability for
options to fulfill the liquidity requirements that AMMs need. AMMs
typically have slippage on the order of $\delta x / x$, where $\delta x$
is the quantity of token being swapped in and $x$ is LP's quantity. If
500 WETH (\$2M USD aotw) is distributed and collateralized across 7
expiration dates and 7 strikes (both considered low) to 10 option tokens
each, 1 purchased token results in 10% slippage, which is large and
untenable.

If a traditional LP cannot be used to create a price for an option, then
where will the price come from? If we look at current options market, we
take a hint from the core pricing formula, Black-Scholes.

## Black-Scholes

With the $xy=k$ pricing system as motivation where the swap price of the
tokens are determing by their respective ratios, we see that we can use
the state of the market to dictate the price of the options in somewhat
of a similar way.

Let's explore the Black-Scholes Equation (BSE) and see how to implement
it as an AMM. We will discuss some specific details about the BSE but we
leave in-depth explanations about it to references that have fully
delved into it. This table defines some values and parameters of the
BSE. One thing to note is that we use the $K_S=K/S_t$ ratio because this
simplifies calculations and provides an intuition on prices. We also
simplify to using $\tau$ to represent the amount of time left in the
option.

::: {#tab:functions}
  **Var**                **Description**
  ---------------------- ------------------------------------------------------
  $V$                    Option price or Premium
  $S$                    Underlying price
  $K$                    Strike price
  $K_S =  {K}/{S_{t}}$   Strike Underlying Ratio
  $r$                    Risk free rate of return
  $\sigma$               Volatity - standard deviation of the stock's returns
  $t$                    Time in years
  $\tau=t-T$             Time remaining until expiration

  : Options Variables
:::

The equation for the Price (relative to the Underlying Price) of a Call
Option is:

$${\displaystyle {
    \begin{aligned}
        C(K_S,\sigma,t)&=\mathcal{N}(d_{+})-\mathcal{N}(d_{-})e^{-r\tau}K_S\\
    \end{aligned}}}$$ where the CDF inputs are $${\displaystyle {
    \begin{aligned}
        d_{\pm}&={{\sigma^{-1} { {\tau}^{-1/2}}}}\left[-\ln \left({K_S}\right)+r\tau\pm{ {\sigma ^{2}\tau}/{2}}\right]\\
    \end{aligned}}}$$

The option price is determined by: $\tau$ time left in the contract,
$K_S$ Strike/Underlying Ratio, $r$ risk-free rate of return, and most
importantly $\sigma$ volatity. $\tau$, $K_S$, and $r$ are
straightforward values used in the price, there's no real complications
in determining their values from an Oracle on-chain. It's $\sigma$, the
volatity, that can cause issues in incorrect pricing that we'll focus
on.

### Volatility

While the parameter $\sigma$ seems like a straightforward value to input
into the BSE, determining the actual value is not as straightforward as
calculating the Standard Deviation of the underlying price over a
certain amount of time. Market prices of options tell a story of the
state of the market through the Implied Volatility that's calculated
from the option price, along with all the related siblings, the Greeks
($\delta$, $\gamma$, $\theta$, vega, $\rho$).
