# Read-Only Token Risk Detector

Read-only Ethereum mainnet token liquidity and exit-path risk detector.

For AI-agent operation details, see [AI_USAGE.md](AI_USAGE.md).

The detector checks:

- ERC20 metadata and common owner flag.
- Uniswap v2 direct pairs against WETH, USDC, USDT, DAI, and WBTC.
- Uniswap v3 direct pools against WETH, USDC, USDT, DAI, and WBTC.
- Uniswap v4 pool discovery by scanning `Initialize` events from PoolManager.
- Optional Uniswap v4 pool checks by PoolKey for faster exact checks.
- Quote-implied prices such as `1 TOKEN ~= x USDC/WETH`.

It never sends transactions, never approves tokens, and never uses private keys.
Quote availability is not investment advice and is not final proof that a wallet
can execute a sale.

## Usage

From the repository root:

```bash
node detect-token.mjs <token-address>
```

Examples:

```bash
node detect-token.mjs 0xdAC17F958D2ee523a2206206994597C13D831ec7
SUMMARY=1 node detect-token.mjs <token-address>
SELL_AMOUNT=10 node detect-token.mjs <token-address>
RPC_URL=https://ethereum.publicnode.com node detect-token.mjs <token-address>
```

## Uniswap v4

Uniswap v4 pools do not have standalone pair addresses. By default the detector scans PoolManager
`Initialize` events from the known Ethereum mainnet v4 start block. You normally only need the token
address:

```bash
node detect-token.mjs <token-address>
```

To narrow or disable the scan:

```bash
V4_SCAN_BLOCKS=200000 node detect-token.mjs <token-address>
V4_SCAN_BLOCKS=0 node detect-token.mjs <token-address>
V4_AUTO_SCAN=false node detect-token.mjs <token-address>
```

If you know the PoolKey, pass it to skip discovery ambiguity and directly inspect that pool:

```bash
V4_CURRENCY0=0x0000000000000000000000000000000000000000 \
V4_CURRENCY1=0xd59F8832023f6c9AC5EC7B7154893925bef9fBf7 \
V4_FEE=8388608 \
V4_TICK_SPACING=60 \
V4_HOOKS=0xD3BB8dAd3a6f7e5d1bFFafa80e130d6ee6939080 \
node detect-token.mjs 0xd59F8832023f6c9AC5EC7B7154893925bef9fBf7
```

## Verdicts

- `NO_DIRECT_POOL_FOUND`: no direct Uniswap v2/v3/v4 pool was found by this tool.
- `POOLS_FOUND_BUT_NO_SELL_QUOTE`: pools exist, but sell quote is unavailable or zero.
- `SELL_QUOTE_AVAILABLE_NOT_EXECUTION_PROOF`: at least one sell quote exists, but this is not proof that a wallet can execute a sale.
- `DIRECT_BUY_SELL_QUOTES_AVAILABLE`: both buy and sell quotes exist on at least one route, still not final honeypot proof.

Quoter output is not a complete honeypot proof. A token can still block transfers, charge transfer taxes, require a specific router, or fail execution despite a quote. For high-risk tokens, follow up with wallet-level static simulation and then a tiny real sale only if the simulation returns positive output.
