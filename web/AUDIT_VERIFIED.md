# Verified Security Issues

## Confirmed Bugs

### 1. Silent Failure in `sufficientBalance` Modifier (CRITICAL)
**Location**: [Redemption.sol:145](packages/foundry/contracts/Redemption.sol#L145)

```solidity
modifier sufficientBalance(address account, uint256 amount) {
    if (balanceOf(account) < amount) return;  // ← Should be revert
    _;
}
```

**Fix**: Change `return` to `revert InsufficientBalance();`

### 2. No Fee Validation in `Redemption.adjustFee()` (Medium)
**Location**: [Redemption.sol:512](packages/foundry/contracts/Redemption.sol#L512)

```solidity
function adjustFee(uint64 fee_) public onlyOwner {
    fee = fee_;  // ← No cap validation
}
```

**Fix**: Add `require(fee_ <= 0.01e18, "fee exceeds maximum");`

## Invalid Findings (from original reports)

- **uint160 truncation**: False - already validated at lines 255 & 406
- **Auto-mint/auto-redeem**: Intentional design
- **redeemConsideration expiry**: Intentional - allowed anytime
- **Dependency vulnerabilities**: Already addressed via package.json resolutions
