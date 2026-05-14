# AI Usage Guide: Read-Only Token Risk Detector

This guide is for future AI agents that need to evaluate whether an Ethereum ERC20 token has a usable trading exit path.

The detector is read-only. It never uses private keys, never sends transactions, and never approves tokens.

## Location

Run from the repository root:

```bash
node detect-token.mjs <token-address>
```

The script is:

```text
detect-token.mjs
```

## Default Scope

The detector checks Ethereum mainnet:

- ERC20 metadata: `name`, `symbol`, `decimals`, `totalSupply`, `owner`.
- Uniswap v2 direct pools against WETH, USDC, USDT, DAI, WBTC.
- Uniswap v3 direct pools against WETH, USDC, USDT, DAI, WBTC.
- Uniswap v4 pools by scanning PoolManager `Initialize` events.
- Quote-implied sell prices, such as `1 TOKEN ~= x USDC`.

It does not prove that a wallet can execute a sale. It proves whether checked routes can produce read-only quotes.

## Fast Command

Use summary mode first:

```bash
SUMMARY=1 node detect-token.mjs <token-address>
```

For faster checks on very active tokens, narrow v4 scanning:

```bash
SUMMARY=1 V4_SCAN_BLOCKS=200000 node detect-token.mjs <token-address>
```

To skip v4 scanning and check only v2/v3:

```bash
SUMMARY=1 V4_SCAN_BLOCKS=0 node detect-token.mjs <token-address>
```

For machine-readable output:

```bash
JSON=1 node detect-token.mjs <token-address>
```

## Important Environment Variables

```text
RPC_URL                  Ethereum RPC URL. Default: https://ethereum.publicnode.com
SUMMARY=1               Print concise report.
JSON=1                  Print full JSON report.
SELL_AMOUNT=1           Token amount used for sell quote checks.
V4_AUTO_SCAN=false      Disable automatic v4 event scanning.
V4_SCAN_BLOCKS=200000   Scan only recent blocks. 0 disables v4 scanning.
V4_SCAN_FROM_BLOCK=...  Start v4 scan from an explicit block.
V4_SCAN_CHUNK_BLOCKS=50000  RPC log query chunk size.
```

Manual v4 PoolKey override:

```text
V4_CURRENCY0
V4_CURRENCY1
V4_FEE
V4_TICK_SPACING
V4_HOOKS
V4_POOL_ID              Optional. If omitted, the script computes it.
```

## How To Interpret Summary Output

Example normal output:

```text
Token Trade Detector Summary
USDT 0xdAC17F958D2ee523a2206206994597C13D831ec7
DIRECT_BUY_SELL_QUOTES_AVAILABLE: At least one direct route produced positive buy and sell quotes.
UniswapV2: routes=4, active=4, sellQuotes=4, buyQuotes=4
UniswapV3: routes=16, active=15, sellQuotes=15, buyQuotes=15
Best sell quotes:
- UniswapV3 USDT/USDC: 1.0 USDT -> 0.999748 USDC; price=1 USDT ~= 0.999748 USDC
```

This means:

- Pools exist.
- Some pools have active liquidity.
- At least one sell quote returns positive output.
- The quoted price is derived from `amountIn -> amountOut`.

Example risky v4 output:

```text
Token Trade Detector Summary
ePow 0xd59F8832023f6c9AC5EC7B7154893925bef9fBf7
POOLS_FOUND_BUT_NO_SELL_QUOTE: At least one pool exists, but no checked route produced a positive sell quote.
UniswapV4: routes=1, active=0, sellQuotes=0, buyQuotes=0
Best sell quotes: none
Top v4 routes:
- ETH/ePow pool=0x57b2739cdfd2929f2deb1fb51a0700f0c453b4dffa18a4367080b0008db980b8 active=false sell=false buy=false tick=887271 at/near max tick
```

This means:

- A v4 pool exists.
- There is no active liquidity in that pool.
- Sell quote failed.
- No reliable price can be derived from a sell route.

## Verdicts

Treat verdicts as follows:

```text
DIRECT_BUY_SELL_QUOTES_AVAILABLE
```

Likely normal route availability. Still not a final honeypot proof.

```text
SELL_QUOTE_AVAILABLE_NOT_EXECUTION_PROOF
```

Some sell quote exists, but checked routes are incomplete or asymmetric. Needs more review.

```text
POOLS_FOUND_BUT_NO_SELL_QUOTE
```

High exit-path risk. Pools exist, but no checked route can quote a positive sell.

```text
NO_DIRECT_POOL_FOUND
```

No direct Uniswap v2/v3/v4 route was found by this detector. It may still trade on other DEXes or through multi-hop/nonstandard routers.

## Field Meanings

Protocol summary fields:

```text
routes       Number of discovered pools/routes for this protocol.
active       Number of pools with active liquidity/reserves.
sellQuotes   Number of routes with positive token -> base quote.
buyQuotes    Number of routes with positive base -> token quote.
```

Quote fields:

```text
amountIn       Human-readable input amount.
amountOut      Human-readable output amount.
price          Quote-implied price from amountOut / amountIn.
gasEstimate    Quoter gas estimate if available.
error          Decoded revert/error when quote fails.
```

v4 route fields:

```text
pool           bytes32 PoolId, not a pair contract.
active         Whether current v4 active liquidity is nonzero.
tick           Current tick from StateView.
tickRisk       Boundary warning. "at/near max tick" or "at/near min tick" is risky.
```

## v4 Notes

Uniswap v4 pools do not have standalone pair contracts. The detector finds v4 pools by scanning the PoolManager `Initialize` event:

```text
Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, ...)
```

If the RPC has strict `eth_getLogs` limits, narrow scanning:

```bash
V4_SCAN_BLOCKS=200000
V4_SCAN_CHUNK_BLOCKS=10000
```

If a known v4 PoolKey exists, pass it manually for deterministic inspection.

## Recommended AI Workflow

1. Run summary mode:

```bash
SUMMARY=1 node token-trade-detector/detect-token.mjs <token-address>
```

2. If output is `DIRECT_BUY_SELL_QUOTES_AVAILABLE`, report that direct Uniswap quotes exist and include best sell prices.

3. If output is `POOLS_FOUND_BUT_NO_SELL_QUOTE`, report high exit-path risk and include failed route errors.

4. If output is `NO_DIRECT_POOL_FOUND`, state that this detector found no direct Uniswap route and recommend checking other DEXes, aggregators, official docs, and historical swaps.

5. For suspicious tokens, do not claim "safe" from this tool alone. Say: "read-only quotes exist, but execution is not proven."

6. Only if the user explicitly asks and understands the risk, follow up with wallet-level static simulation or a dust-size real sell. Never use `minOut=0` as proof of sellability.

## Known Limitations

- Does not check every DEX.
- Does not discover arbitrary multi-hop paths.
- Does not prove wallet execution.
- Does not fully detect blacklist, cooldown, transfer tax, rebase, proxy router, or allowlist behavior.
- A route can quote successfully and still fail for a specific wallet.
- A transaction can succeed with zero output if `minOut=0`; this is not a valid sell proof.

## Current Useful Examples

Normal token:

```bash
SUMMARY=1 V4_SCAN_BLOCKS=0 node token-trade-detector/detect-token.mjs 0xdAC17F958D2ee523a2206206994597C13D831ec7
```

Risky v4 sample:

```bash
SUMMARY=1 V4_SCAN_BLOCKS=200000 node token-trade-detector/detect-token.mjs 0xd59F8832023f6c9AC5EC7B7154893925bef9fBf7
```
