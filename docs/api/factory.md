---
title: Factory
sidebar_label: Factory
sidebar_position: 3
slug: /api/factory
---
# Factory

**Inherits:**
Ownable, ReentrancyGuardTransient, IERC20Errors

**Title:**
Factory — deployer, allowance hub, operator registry

**Author:**
Greek.fi

The only on-chain contract users need to interact with to *create* options. Once deployed,
every Option + Receipt pair runs off pre-compiled template clones, so creation is
cheap and the factory is never an upgradeable rug vector (the templates are immutable).
The factory also plays three lasting roles post-creation:
1. **Single allowance point.** Users `approve(collateralToken, amount)` on the factory once,
and any Option / Receipt pair created by this factory can pull from that allowance
via [transferFrom](/api/factory). No need to approve every new option individually.
2. **Operator registry.** [approveOperator](/api/factory) gives an address blanket authority to move
any Option produced by this factory on your behalf — the ERC-1155-style "setApprovalForAll"
pattern. Used by trading venues and aggregators.
3. **Auto-mint / auto-redeem opt-in.** [enableAutoMintBurn](/api/factory) flips a per-account flag that
Option consults on transfer to auto-mint deficits and auto-redeem matched Option+Receipt
on the receiving side.
## Exercise window
There is no oracle. Settlement is purely time-gated:
- `isEuro = false` (American) — exercise allowed from creation through `exerciseDeadline`.
- `isEuro = true`  (European) — exercise allowed only between `expirationDate` and
`exerciseDeadline`.
`windowSeconds` on `CreateParams` sets how long after expiration the window stays open;
it is taken literally — the contract NEVER substitutes a default. American options may
pass `0` for "no post-expiry extension" (window collapses to `expirationDate`).
European options must pass `windowSeconds > 0` (else `InvalidValue`). After
`expirationDate + windowSeconds`, exercise reverts (for both flavours) and short-side
redemption opens. `DEFAULT_EXERCISE_WINDOW` is an informational constant the frontend
may use as a suggested default; the contract does not consult it.
## Supported tokens (IMPORTANT)
Collateral and consideration MUST be standard ERC-20 tokens with **exact, balance-preserving
transfers**. The protocol tracks balances 1:1 internally; any token whose `balanceOf` can
diverge from the amounts actually moved will corrupt that accounting (deposits, redemptions,
share/conversion math, and the solvency invariant). Non-standard mechanics are NOT supported:
- **Fee-on-transfer** (a cut is skimmed on transfer) — actively rejected: [transferFrom](/api/factory)
checks the delivered balance delta and reverts [FeeOnTransferNotSupported](/api/factory) when a pull
lands short, so options on such tokens cannot be minted or exercised.
- **Rebasing / elastic-supply** (balances change with no transfer) — NOT detectable on-chain
and NOT supported: the collateral/consideration held by a `Receipt` can silently drift
from the recorded amounts, breaking redemption and solvency. There is no on-chain guard;
such tokens must simply not be used.
Do NOT create an option whose collateral or consideration implements either behaviour — its
accounting will not operate correctly. Frontends MUST surface this when users create options.


## RECEIPT_CLONE
Template Receipt contract; per-option instances are EIP-1167 clones of this.


```solidity
address public immutable RECEIPT_CLONE
```


## OPTION_CLONE
Template Option contract; per-option instances are EIP-1167 clones of this.


```solidity
address public immutable OPTION_CLONE
```


## DEFAULT_EXERCISE_WINDOW
Informational suggested-default for the post-expiry exercise window. The contract
NEVER substitutes this value — `CreateParams.windowSeconds` is taken literally.
Exposed so frontends can read a canonical "8 hours" without hardcoding it.


```solidity
uint40 public constant DEFAULT_EXERCISE_WINDOW = 8 hours
```


## receipts
`true` if the address is a Receipt clone this factory created. Doubles as the auth
gate for [transferFrom](/api/factory) — only registered Receipts can pull from factory allowances.
Validate an Option by reading its `receipt()` and confirming
`factory.receipts(rec) && Receipt(rec).option() == opt`.


```solidity
mapping(address => bool) public receipts
```


## optionFor
Canonical Option address for a given set of economic params, keyed by [optionKey](/api/factory).
`address(0)` means no option with those params exists yet. [createOption](/api/factory) is
get-or-create: a second call with economically-identical params returns the existing
Option instead of deploying a duplicate, so identical markets stay canonical/deduped
and existence is queryable on-chain.


```solidity
mapping(bytes32 => address) public optionFor
```


## autoMintBurn
Per-account opt-in for auto-mint on transfer and auto-redeem on receive in `Option`.


```solidity
mapping(address => bool) public autoMintBurn
```


## constructor

Deploys the Option and Receipt templates internally so they record this factory
as their immutable `factory` (used to gate `init` and skip per-clone storage).


```solidity
constructor() Ownable(msg.sender);
```

## createOption(CreateParams memory p)

Deploy a new Option + Receipt pair. Emits [OptionCreated](/api/factory).

Option is an EIP-1167 clone; Receipt is a clone-with-immutable-args (per-option
strike, decimals, dates, etc. baked into the clone's runtime bytecode).
⚠ `collateral` and `consideration` MUST be standard ERC-20 tokens with exact,
balance-preserving transfers. Fee-on-transfer and rebasing / elastic-supply tokens are
NOT supported and will corrupt the option's 1:1 accounting (see the contract-level
"Supported tokens" note). There is no creation-time guard against this — the caller is
responsible for only pairing standard tokens.


```solidity
function createOption(CreateParams memory p) public nonReentrant nonZero(p.strike) returns (address option_);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`p`|`CreateParams`|See `CreateParams`: - `collateral`, `consideration`: ERC20 addresses; must differ. Standard ERC-20 only — no fee-on-transfer or rebasing tokens. - `expirationDate`: unix timestamp; must be in the future. - `strike`: 18-decimal fixed point (consideration per collateral, inverted for puts). - `isPut`: option flavour. - `isEuro`: `true` for European (no pre-expiry exercise), `false` for American. - `windowSeconds`: post-expiry exercise window length in seconds; taken literally (no contract-side default). American allows `0` (no extension); European requires `> 0`.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`option_`|`address`|The canonical `Option` address — either freshly deployed, or the existing option if an economically-identical one already exists (get-or-create; see `optionFor`).|


## createOptions(CreateParams[] memory params)

Batch form of [createOption](/api/factory). Same ordering in → same ordering out.


```solidity
function createOptions(CreateParams[] memory params) external returns (address[] memory result);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`params`|`CreateParams[]`|Array of `CreateParams`.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`result`|`address[]`|Array of newly-created Option addresses, aligned with `params`.|


## optionKey(CreateParams memory p)

Deterministic registry key for a set of economic params. All seven `CreateParams`
fields are economic identity, so every one is folded into the hash — two params that
differ in any field produce different keys (and therefore distinct option markets).

`public pure` so off-chain callers and tests can compute the key and look up
`optionFor` without a creation tx.


```solidity
function optionKey(CreateParams memory p) public pure returns (bytes32);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`p`|`CreateParams`|The `CreateParams` to key.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bytes32`|The `keccak256` registry key.|


## transferFrom(address from, address to, uint256 amount, address token)

Pull `amount` of `token` from `from` to `to`. Only callable by Receipt clones
that this factory has created.

Decrements `_allowances[token][from]` (unless it is `type(uint256).max`).
This is the mechanism by which a single user approval on the factory flows to every
option pair it creates, rather than requiring approvals on each Receipt clone.


```solidity
function transferFrom(address from, address to, uint256 amount, address token) external nonReentrant returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`from`|`address`|  Token owner.|
|`to`|`address`|    Recipient (typically the calling Receipt contract).|
|`amount`|`uint256`|Token amount to transfer.|
|`token`|`address`| Token to move.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bool`|success Always `true` on success; reverts otherwise.|


## allowance(address token, address owner_)

Factory-level allowance lookup: how much of `token` can the factory pull from `owner_`?


```solidity
function allowance(address token, address owner_) public view returns (uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`token`|`address`| Token.|
|`owner_`|`address`|Token owner.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`uint256`|Current allowance.|


## approve(address token, uint256 amount)

Permit2-style allowance: caller authorises the factory to pull up to `amount` of
`token` (collateral or consideration) on their behalf when any Option / Receipt
pair created by this factory needs to move it. The user must also have granted the
underlying `token.approve(factory, ...)` so `safeTransferFrom` can land.

The allowance fans out to every Receipt clone (gated by the `receipts[]` registry)
and is consumed by `mint`, `exercise`, and — if [enableAutoMintBurn](/api/factory) is `true` —
the auto-mint leg of Option transfers triggered by approved operators. Granting
a large allowance here while also holding active [approveOperator](/api/factory) grants with
[enableAutoMintBurn](/api/factory) on is functionally equivalent to a permit on the underlying
token in favour of those operators.


```solidity
function approve(address token, uint256 amount) public nonZeroAddr(token);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`token`|`address`| ERC20 to be approved.|
|`amount`|`uint256`|Allowance to grant (use `type(uint256).max` for infinite, `0` to revoke).|


## approveOperator(address operator, bool approved)

Grant or revoke `operator` blanket authority to move any of the caller's Option tokens
across every option this factory has created (ERC-1155-style `setApprovalForAll`).

**Intended for audited swap / trading-venue contracts** — Uniswap-style routers,
RFQ market makers, vault adapters, anything that needs to pull a holder's Option as
part of a settlement flow without requiring a per-option ERC20 `approve`. Approved
operators skip the per-transfer `_spendAllowance` step on `Option.transferFrom`.
**⚠ Combination danger.** If the holder has also called `enableAutoMintBurn(true)`,
an approved operator gains the right to *mint new Option positions* against the
holder's factory collateral allowance, not just move existing balance. Path:
operator calls `Option.transferFrom(holder, recipient, amount)` for an amount the
holder doesn't currently hold → auto-mint pulls collateral via `factory.transferFrom`
→ minted Option lands at `recipient`. Functionally this combination is a permit on
collateral. Only grant [approveOperator](/api/factory) to entities you trust to also have
minting rights over your collateral allowance — i.e. audited protocol contracts,
never EOAs and never unaudited integrations.
[approveOperator](/api/factory) does NOT grant exercise rights ([allowExercise](/api/factory) is separate) and
does NOT grant redeem rights ([allowRedeem](/api/factory) is separate). Defaults to `false`;
revoke by passing `approved = false`.


```solidity
function approveOperator(address operator, bool approved) external nonZeroAddr(operator);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`operator`|`address`|Address being approved/revoked (must differ from `msg.sender`).|
|`approved`|`bool`|`true` to grant, `false` to revoke.|


## approvedOperator(address owner_, address operator)

Is `operator` an approved operator for `owner_`?


```solidity
function approvedOperator(address owner_, address operator) external view returns (bool);
```

## allowExercise(address exercisor, bool allowed)

Authorise `exercisor` to exercise the caller's options on their behalf.

Consumed by the on-behalf `Option.exercise(address,uint256)` overloads, which burn
the holder's option tokens, pull consideration from `exercisor`, and deliver the
collateral to `exercisor`. Distinct from [approveOperator](/api/factory): that grants transfer
authority over the holder's option tokens, this grants the right to *consume* them
(burn). Defaults to `false`; revoke by passing `allowed = false`.


```solidity
function allowExercise(address exercisor, bool allowed) external nonZeroAddr(exercisor);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`exercisor`|`address`|Account being authorised (must differ from `msg.sender`).|
|`allowed`|`bool`|  `true` to grant, `false` to revoke.|


## exerciseAllowed(address holder, address exercisor)

Is `exercisor` authorised to burn `holder`'s options on their behalf? Set/cleared
only via [allowExercise](/api/factory) — independent of [approveOperator](/api/factory), which grants transfer
(not burn) authority.


```solidity
function exerciseAllowed(address holder, address exercisor) external view returns (bool);
```

## allowRedeem(address redeemer, bool allowed)

Authorise `redeemer` to trigger post-window pro-rata redeem on the caller's behalf
via `Receipt.redeemFor`.

Unlike [allowExercise](/api/factory), this grant carries no value-extraction risk: the redeemer
can only burn the holder's receipts; the collateral / consideration payout always
goes to the holder. Use this to wire a keeper that sweeps dust post-window, or to
let a vault-management contract unwind its own positions via a worker.


```solidity
function allowRedeem(address redeemer, bool allowed) external nonZeroAddr(redeemer);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`redeemer`|`address`|Account being authorised (must differ from `msg.sender`).|
|`allowed`|`bool`| `true` to grant, `false` to revoke.|


## redeemAllowed(address holder, address redeemer)

Is `redeemer` authorised to trigger `Receipt.redeemFor` on behalf of `holder`?


```solidity
function redeemAllowed(address holder, address redeemer) external view returns (bool);
```

## enableAutoMintBurn(bool enabled)

Opt in to `Option`'s auto-mint-on-send and auto-redeem-on-receive transfer behaviour.

Quality-of-life flag for active holders. When `true`:
- On `Option.transfer` / `transferFrom` *from* the holder where balance is short,
the missing amount is auto-minted by pulling collateral via the factory's
allowance registry (saves a separate `mint` tx before sending).
- On `Option.transfer` / `transferFrom` *to* the holder where the holder already
holds the matching Receipt, the incoming Option is immediately pair-burned and
collateral is returned (avoids dangling matched positions).
**⚠ Combination danger.** When combined with [approveOperator](/api/factory), this flag promotes
the operator's transfer right into a *minting* right against the holder's factory
collateral allowance — see the warning on [approveOperator](/api/factory). The flag is per-account
and applies to every option pair this factory has created. Treat it like a permit:
enable it only while you have collateral approvals out to operators you trust to
also have minting rights over those approvals.
Defaults to `false`; revoke by passing `enabled = false`.


```solidity
function enableAutoMintBurn(bool enabled) external;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`enabled`|`bool`|`true` to opt in, `false` to opt out.|


## OptionCreated
Emitted for every newly-created option.


```solidity
event OptionCreated(
    address indexed collateral,
    address indexed consideration,
    uint40 expirationDate,
    uint256 strike,
    bool isPut,
    bool isEuro,
    uint40 windowSeconds,
    address indexed option,
    address receipt
);
```

## OperatorApproval
Emitted on [approveOperator](/api/factory).


```solidity
event OperatorApproval(address indexed owner, address indexed operator, bool approved);
```

## ExerciseApproval
Emitted on [allowExercise](/api/factory).


```solidity
event ExerciseApproval(address indexed holder, address indexed exercisor, bool allowed);
```

## RedeemApproval
Emitted on [allowRedeem](/api/factory).


```solidity
event RedeemApproval(address indexed holder, address indexed redeemer, bool allowed);
```

## AutoMintBurnUpdated
Emitted on [enableAutoMintBurn](/api/factory).


```solidity
event AutoMintBurnUpdated(address indexed account, bool enabled);
```

## Approval
Emitted on [approve](/api/factory) (factory-level allowance set by token owner).


```solidity
event Approval(address indexed token, address indexed owner, uint256 amount);
```

## InvalidAddress
Thrown when a zero address is supplied where a real contract is required.


```solidity
error InvalidAddress();
```

## InvalidTokens
Thrown when `collateral == consideration` (no real option pair).


```solidity
error InvalidTokens();
```

## InvalidValue
Thrown when a value param (strike, expiration, window) is invalid.


```solidity
error InvalidValue();
```

## FeeOnTransferNotSupported
Thrown when a token's transferFrom delivers less than `amount` (fee-on-transfer / rebasing).


```solidity
error FeeOnTransferNotSupported();
```


