---
title: Receipt
sidebar_label: Receipt
sidebar_position: 2
slug: /api/receipt
---
# Receipt

**Inherits:**
ERC20, ReentrancyGuardTransient, Clone

**Title:**
Receipt — short-side ERC20 (collateral receipt)

**Author:**
Greek.fi

The short side of a Greek option pair. Holding this token is a receipt for the
collateral you deposited when minting: you received the premium (off-chain) and now
bear the obligation of the exercise payoff. It holds all collateral for the pair and
receives the consideration paid on exercise.
No oracle is consulted at any point. Settlement is purely time-gated:
| Mode      | `isEuro` | Pre-expiry exercise | In-window exercise | Post-window short exit                |
| --------- | -------- | ------------------- | ------------------ | ------------------------------------- |
| American  | `false`  | allowed             | allowed            | `redeem` (cons-first, then coll 1:1)  |
| European  | `true`   | reverts             | allowed            | `redeem` (cons-first, then coll 1:1)  |
The exercise window closes for everyone at `exerciseDeadline = expirationDate + windowSeconds`.
Pair-redeem (`burn`, called by Option) stays available pre-deadline.
## Rounding
- Collections from users (exercise): round UP (`toConsideration(amount, true)`).
- Payouts to users (redeem): round DOWN (floor).
## Supported tokens
This contract physically holds every collateral and consideration token for the pair and
tracks them 1:1 against its accounting, so the collateral/consideration MUST be standard
ERC-20 tokens with exact, balance-preserving transfers. Fee-on-transfer and rebasing /
elastic-supply tokens are NOT supported: any drift between `balanceOf` and the recorded
amounts breaks the redemption math and the solvency invariant. Fee-on-transfer pulls are
rejected at `Factory.transferFrom`; rebasing is undetectable on-chain and must be avoided
at option-creation time. See `Factory` for the full token policy.

Deployed once as a template; per-option instances are clones produced by
`ClonesWithImmutableArgs`. Every per-option value (strike, collateral, consideration,
expirationDate, exerciseDeadline, isPut, isEuro, decimals, option) is appended to the
clone's runtime bytecode at deploy time and read via `Clone._getArg*` helpers
(CALLDATALOAD, ~3 gas). There is no `init` function — the clone is fully configured
the moment its bytecode is written.
## Immutable args layout (packed, 112 bytes)
offset  0   strike            uint256  (32B)
offset 32   collateral        address  (20B)
offset 52   consideration     address  (20B)
offset 72   option            address  (20B)
offset 92   expirationDate    uint64   (8B, holds a uint40)
offset 100  exerciseDeadline  uint64   (8B, = expirationDate + windowSeconds; can exceed uint40)
offset 108  isPut             uint8    (1B, 0 or 1)
offset 109  isEuro            uint8    (1B, 0 or 1)
offset 110  decimals      uint8    (1B)
offset 111  consDecimals      uint8    (1B)


## factory
Factory that created this option, used to pull tokens through its Permit2-style
allowance registry. Set in the template constructor (= the factory that deployed
it) and inherited by every clone via the template's runtime bytecode.


```solidity
IFactory public immutable factory
```


## STRIKEDEC
Decimal basis of the strike — fixed at 18 and independent of token decimals.


```solidity
uint8 public constant STRIKEDEC = 18
```


## consBacked
Receipt-units the consideration pool can still back at strike rate. Incremented on
[exercise](/api/receipt) (cons inflow) and decremented by the cons leg of [_redeem](/api/receipt) (cons payout);
the collateral leg of redeem leaves it untouched. Equal to (total exercised − total
cons-redeemed), and never underflows — the cons leg caps its payout at this value.
Denominated in receipt/collateral units (the cons equivalent is `toConsideration`).


```solidity
uint256 public consBacked
```


## constructor

Template constructor. Never called for user-facing instances; clones are produced
by `ClonesWithImmutableArgs.clone(template, args)` and never delegate the
constructor. `factory` is captured from the deployer (the Factory that deployed
the template) so every clone-via-delegatecall reads the same FACTORY immutable.


```solidity
constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_);
```

## strike()

Strike price, 18-decimal fixed point (consideration per collateral; inverted for puts).


```solidity
function strike() public pure returns (uint256);
```

## collateral()

Underlying collateral token (e.g. WETH). All collateral sits here.


```solidity
function collateral() public pure returns (IERC20);
```

## consideration()

Consideration / quote token (e.g. USDC). Accrues here from exercise payments.


```solidity
function consideration() public pure returns (IERC20);
```

## option()

The paired `Option` contract. Only this address can call mint / burn / exercise.


```solidity
function option() public pure returns (address);
```

## expirationDate()

Unix timestamp at which the option expires.


```solidity
function expirationDate() public pure returns (uint40);
```

## exerciseDeadline()

Unix timestamp at which the post-expiry exercise window closes.

Returned as `uint64`: the stored value is `expirationDate + windowSeconds`,
and that sum can exceed `type(uint40).max` even though each operand is uint40,
so reading the full 64-bit slot avoids silently truncating the deadline.


```solidity
function exerciseDeadline() public pure returns (uint64);
```

## isPut()

`true` if put, `false` if call.


```solidity
function isPut() public pure returns (bool);
```

## isEuro()

`true` if European-style.


```solidity
function isEuro() public pure returns (bool);
```

## decimals()

Cached `collateral.decimals()` used in conversion math.


```solidity
function decimals() public pure override returns (uint8);
```

## consDecimals()

Cached `consideration.decimals()` used in conversion math.


```solidity
function consDecimals() public pure returns (uint8);
```

## mint(address account, uint256 amount)

Mint `amount` Receipt tokens to `account`, pulling the matching amount of
underlying collateral through the factory's allowance registry.

Only callable by the paired `Option` contract.


```solidity
function mint(address account, uint256 amount) public onlyOption nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|Recipient of the newly-minted Receipt tokens.|
|`amount`|`uint256`| Collateral-denominated amount.|


## burn(address account, uint256 amount)

Burn matched Option + Receipt pair, return collateral. Only callable by Option.

Trusts Option's own gating: direct `Option.burn` enforces `notExpired`
(pre-expiration only), while the auto-burn leg of `Option._settledTransfer` runs
under `beforeDeadline` (pre-`exerciseDeadline`). Once everyone is post-settlement,
all short-side exits must go through `_redeem`.


```solidity
function burn(address account, uint256 amount) public onlyOption nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|Recipient of the collateral.|
|`amount`|`uint256`| Amount of Receipt tokens to burn.|


## exercise(address account, uint256 amount)

Exercise path invoked by Option. `account` both pays the consideration and receives
the collateral — the two sides are coupled at this boundary so Receipt never has to
settle "pay-for-someone-else" semantics. Option enforces the matching authorisation
(self-exercise or `factory.allowExercise`) before calling.


```solidity
function exercise(address account, uint256 amount) public onlyOption nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|The address paying consideration and receiving collateral.|
|`amount`|`uint256`| Collateral units to deliver; consideration collected is `ceil(amount * strike)`.|


## redeem()

Redeem the caller's full Receipt balance.

Cons-first, FCFS: pays up to `consBacked` receipt-units from the
consideration pool at strike rate, callable any time the pool can cover them.
Any uncovered remainder is paid 1:1 in collateral **only after** `exerciseDeadline`;
pre-window, uncovered receipts stay in the caller's balance for later redemption.
The cons leg mirrors the equity-options "buy to close at strike" convention:
the writer sources consideration from previously-exercised counterparties sitting
in the pool. FCFS by design — a short who redeems early captures the cons premium
earlier exercisers paid in, leaving later post-window redeemers with collateral.
That asymmetry is intentional: it lets shorts lock in the strike-rate exchange
the moment the pool can fund it, rather than waiting for the window to close.


```solidity
function redeem() public nonReentrant;
```

## redeem(uint256 amount)

Redeem `amount` of the caller's Receipt. Same semantics as [redeem](/api/receipt).


```solidity
function redeem(uint256 amount) public nonReentrant;
```

## sweep(address token, address to)

Sweep any residual `token` balance held by this Receipt to `to`. Callable only by
the factory owner, and only once every receipt has been burned (`totalSupply == 0`),
so this can never short the redemption pool — it strictly cleans up rounding
residue, post-redemption donations, or stray ERC20s sent here by accident.


```solidity
function sweep(address token, address to) external nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`token`|`address`|ERC20 to drain. Typically the option's collateral or consideration.|
|`to`|`address`|   Recipient of the swept balance.|


## redeemFor(address[] calldata holders)

Keeper-triggered batch redeem. For each holder where the caller is authorised via
`factory.allowRedeem(holder, msg.sender, true)` (or `msg.sender == holder`), the
holder's full balance is redeemed under [redeem](/api/receipt) semantics (cons-first; mix only
post-window). The resulting collateral / consideration go to the **holder** —
never to the caller. Unauthorised and zero-balance holders are skipped silently
so a single stale entry doesn't brick the batch.
Composability-safe by design: a Receipt held inside an ERC4626 vault, Morpho
market, or multisig CANNOT be force-unwound by an unauthorised third party
(the previous permissionless `redeem(address)` variants were removed for exactly
this reason — they let any caller change a vault's collateral balance out from
under it).


```solidity
function redeemFor(address[] calldata holders) external nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`holders`|`address[]`|Holders whose receipts to redeem in full.|


## toConsideration(uint256 amount, bool round)


```solidity
function toConsideration(uint256 amount, bool round) public pure returns (uint256);
```

## toCollateral(uint256 consAmount)

Convert a consideration amount to the matching collateral-denominated receipt count.

Floors by design. No longer used internally — `_redeem` now tracks cons-backed
receipt-units via the `consBacked` counter — but exposed for off-chain
indexers and invariant tests that need the inverse of [toConsideration](/api/receipt).


```solidity
function toCollateral(uint256 consAmount) public pure returns (uint256);
```

## name()


```solidity
function name() public view override returns (string memory);
```

## symbol()


```solidity
function symbol() public view override returns (string memory);
```

## Redeemed
Emitted on every path that returns collateral or consideration to a user.


```solidity
event Redeemed(address option, address token, address holder, uint256 amount);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`option`|`address`|The paired Option contract.|
|`token`|`address`| The token actually transferred out (`collateral` or `consideration`).|
|`holder`|`address`|Recipient of the payout.|
|`amount`|`uint256`|Token units sent.|

## UnauthorizedCaller
Thrown when a privileged path is called by anyone other than the paired `Option`.


```solidity
error UnauthorizedCaller();
```

## ContractExpired
Thrown when a pre-expiry-only path (mint) runs after expiration.


```solidity
error ContractExpired();
```

## ZeroValue
Thrown on `amount == 0` (or any derived zero-amount the invariant requires to be positive).


```solidity
error ZeroValue();
```

## ExerciseWindowClosed
Thrown when exercise is attempted after `exerciseDeadline`.


```solidity
error ExerciseWindowClosed();
```

## ExerciseWindowOpen
Thrown when a post-window-only path is called before the window closes.


```solidity
error ExerciseWindowOpen();
```

## BeforeExerciseWindow
Thrown when short-side redemption is attempted on a European option before its
exercise window opens (`block.timestamp < expirationDate`). Mirrors the long-side
European pre-expiry guard so the revert reason states the schedule explicitly.


```solidity
error BeforeExerciseWindow();
```

## OutstandingReceipts
Thrown when [sweep](/api/receipt) is called while receipts are still outstanding.


```solidity
error OutstandingReceipts();
```

## InsufficientPool
Thrown when neither the consideration nor the collateral pool can fully fund the
requested redemption — caller should split into smaller amounts.


```solidity
error InsufficientPool();
```


