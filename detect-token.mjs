#!/usr/bin/env node
import process from "node:process";
import {
  AbiCoder,
  Contract,
  Interface,
  JsonRpcProvider,
  ZeroAddress,
  formatUnits,
  getAddress,
  id,
  keccak256,
  parseUnits,
  zeroPadValue,
} from "ethers";

const ADDRESSES = {
  uniswapV2Factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
  uniswapV2Router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  uniswapV3Factory: "0x1f98431c8ad98523631ae4a59f267346ea31f984",
  uniswapV3QuoterV2: "0x61ffe014ba17989e743c5f6cb21bf9697530b21e",
  uniswapV4PoolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
  uniswapV4StateView: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
  uniswapV4Quoter: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203",
  weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  usdt: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  dai: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  wbtc: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
};

const BASES = [
  { symbol: "WETH", address: ADDRESSES.weth, decimals: 18, buyAmount: "0.001" },
  { symbol: "USDC", address: ADDRESSES.usdc, decimals: 6, buyAmount: "1" },
  { symbol: "USDT", address: ADDRESSES.usdt, decimals: 6, buyAmount: "1" },
  { symbol: "DAI", address: ADDRESSES.dai, decimals: 18, buyAmount: "1" },
  { symbol: "WBTC", address: ADDRESSES.wbtc, decimals: 8, buyAmount: "0.00001" },
];

const V3_FEES = [100, 500, 3000, 10000];
const STABLE_SYMBOLS = new Set(["USDC", "USDT", "DAI"]);
const MAX_TICK = 887272;
const ZERO_NATIVE = "0x0000000000000000000000000000000000000000";
const V4_MAINNET_START_BLOCK = 21688329;

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function owner() view returns (address)",
];

const V2_FACTORY_ABI = [
  "function getPair(address tokenA,address tokenB) view returns (address pair)",
];

const V2_PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)",
];

const V2_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn,address[] path) view returns (uint256[] amounts)",
];

const V3_FACTORY_ABI = [
  "function getPool(address tokenA,address tokenB,uint24 fee) view returns (address pool)",
];

const V3_POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
];

const V3_QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
];

const V4_STATE_VIEW_ABI = [
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
];

const V4_QUOTER_ABI = [
  "function quoteExactInputSingle((tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
];

const V4_POOL_MANAGER_ABI = [
  "event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)",
];

const ERROR_SELECTORS = {
  "0x08c379a0": "Error(string)",
  "0x6190b2b0": "UnexpectedRevertBytes(bytes)",
  "0xecbd9804": "QuoteSwap(uint256)",
  "0x7a5ed734": "NotEnoughLiquidity(bytes32)",
  "0x7c9c6e8f": "Pool.PriceLimitAlreadyExceeded(uint160,uint160)",
  "0x486aa307": "PoolNotInitialized()",
  "0x9e4d7cc7": "Pool.PriceLimitOutOfBounds(uint160)",
  "0x4f2461b8": "SqrtPriceMath.InvalidPriceOrLiquidity()",
  "0x4323a555": "SqrtPriceMath.NotEnoughLiquidity()",
};

const args = parseArgs(process.argv.slice(2));
const tokenInput = args.token ?? args._[0] ?? process.env.TOKEN;

if (!tokenInput) {
  console.error("Usage: node detect-token.mjs <token-address>");
  process.exit(1);
}

const CONFIG = {
  rpcUrl: args.rpc ?? process.env.RPC_URL ?? "https://ethereum.publicnode.com",
  token: getAddress(tokenInput),
  sellAmount: args.sell ?? process.env.SELL_AMOUNT ?? "1",
  v4AutoScan: boolArg(args["v4-auto-scan"] ?? process.env.V4_AUTO_SCAN, true),
  v4ScanBlocks: optionalNumberArg(args["v4-scan-blocks"] ?? process.env.V4_SCAN_BLOCKS),
  v4ScanFromBlock: optionalNumberArg(args["v4-scan-from-block"] ?? process.env.V4_SCAN_FROM_BLOCK),
  v4ScanChunk: numberArg(process.env.V4_SCAN_CHUNK_BLOCKS, 50000),
  json: Boolean(args.json ?? process.env.JSON),
  summary: boolArg(args.summary ?? process.env.SUMMARY, false),
  v4Manual: {
    currency0: args["v4-currency0"] ?? process.env.V4_CURRENCY0,
    currency1: args["v4-currency1"] ?? process.env.V4_CURRENCY1,
    fee: args["v4-fee"] ?? process.env.V4_FEE,
    tickSpacing: args["v4-tick-spacing"] ?? process.env.V4_TICK_SPACING,
    hooks: args["v4-hooks"] ?? process.env.V4_HOOKS,
    poolId: args["v4-pool-id"] ?? process.env.V4_POOL_ID,
  },
};

const abiCoder = AbiCoder.defaultAbiCoder();
const provider = new JsonRpcProvider(CONFIG.rpcUrl);

const report = await detectToken(CONFIG.token);

if (CONFIG.json) {
  console.log(JSON.stringify(report, jsonReplacer, 2));
} else if (CONFIG.summary) {
  printSummary(report);
} else {
  printReport(report);
}

if (report.verdict.code === "POOLS_FOUND_BUT_NO_SELL_QUOTE") {
  process.exitCode = 2;
}

async function detectToken(tokenAddress) {
  const network = await provider.getNetwork();
  const code = await provider.getCode(tokenAddress);
  const token = await getCurrencyInfo(tokenAddress);

  const [v2, v3, manualV4, scannedV4] = await Promise.all([
    detectV2(token),
    detectV3(token),
    detectManualV4(token),
    scanRecentV4(token),
  ]);

  const routes = [...v2, ...v3, ...manualV4, ...scannedV4];
  const verdict = buildVerdict(routes);

  return {
    checkedAt: new Date().toISOString(),
    chainId: Number(network.chainId),
    rpcUrl: CONFIG.rpcUrl,
    token: {
      ...token,
      hasCode: code !== "0x",
    },
    inputs: {
      sellAmount: CONFIG.sellAmount,
      v4AutoScan: CONFIG.v4AutoScan,
      v4ScanBlocks: CONFIG.v4ScanBlocks,
      v4ScanFromBlock: CONFIG.v4ScanFromBlock,
    },
    routes,
    verdict,
    limits: [
      "Quotes are read-only simulations, not final proof that a wallet can sell.",
      "Fee-on-transfer, blacklist, cooldown, router allowlist, or proxy router logic can still break execution.",
      "Uniswap v4 discovery uses PoolManager Initialize logs; RPC log limits can affect very large scans.",
    ],
  };
}

async function detectV2(token) {
  const factory = new Contract(ADDRESSES.uniswapV2Factory, V2_FACTORY_ABI, provider);
  const router = new Contract(ADDRESSES.uniswapV2Router, V2_ROUTER_ABI, provider);
  const routes = [];

  for (const base of BASES.filter((item) => !same(item.address, token.address))) {
    const pairAddress = await optionalCall(() => factory.getPair(token.address, base.address));
    if (!pairAddress || pairAddress === ZeroAddress) continue;

    const pair = new Contract(pairAddress, V2_PAIR_ABI, provider);
    const [token0, token1, reserves] = await Promise.all([
      pair.token0(),
      pair.token1(),
      pair.getReserves(),
    ]);
    const tokenIs0 = same(token0, token.address);
    const tokenReserve = tokenIs0 ? reserves.reserve0 : reserves.reserve1;
    const baseReserve = tokenIs0 ? reserves.reserve1 : reserves.reserve0;

    const sell = await quoteV2(router, token, base, parseUnits(CONFIG.sellAmount, token.decimals));
    const buy = await quoteV2(router, base, token, parseUnits(base.buyAmount, base.decimals));

    routes.push({
      protocol: "UniswapV2",
      pool: pairAddress,
      pair: `${token.symbol}/${base.symbol}`,
      base,
      state: {
        reserveToken: decimalString(tokenReserve, token.decimals),
        reserveBase: decimalString(baseReserve, base.decimals),
        activeLiquidity: tokenReserve > 0n && baseReserve > 0n,
      },
      sell,
      buy,
      notes: [
        "V2 getAmountsOut does not prove transfer execution for fee-on-transfer or restricted tokens.",
      ],
    });
  }

  return routes;
}

async function quoteV2(router, input, output, amountIn) {
  try {
    const amounts = await router.getAmountsOut(amountIn, [input.address, output.address]);
    const amountOut = amounts[amounts.length - 1];
    return quoteOk(amountIn, amountOut, input, output);
  } catch (error) {
    return quoteFail(amountIn, input, output, error);
  }
}

async function detectV3(token) {
  const factory = new Contract(ADDRESSES.uniswapV3Factory, V3_FACTORY_ABI, provider);
  const quoter = new Contract(ADDRESSES.uniswapV3QuoterV2, V3_QUOTER_ABI, provider);
  const routes = [];

  for (const base of BASES.filter((item) => !same(item.address, token.address))) {
    for (const fee of V3_FEES) {
      const poolAddress = await optionalCall(() => factory.getPool(token.address, base.address, fee));
      if (!poolAddress || poolAddress === ZeroAddress) continue;

      const pool = new Contract(poolAddress, V3_POOL_ABI, provider);
      const [liquidity, slot0] = await Promise.all([
        pool.liquidity(),
        pool.slot0(),
      ]);

      const sell = await quoteV3(quoter, token, base, fee, parseUnits(CONFIG.sellAmount, token.decimals));
      const buy = await quoteV3(quoter, base, token, fee, parseUnits(base.buyAmount, base.decimals));

      routes.push({
        protocol: "UniswapV3",
        pool: poolAddress,
        pair: `${token.symbol}/${base.symbol}`,
        base,
        fee,
        state: {
          activeLiquidity: liquidity > 0n,
          liquidity: liquidity.toString(),
          tick: Number(slot0.tick),
          tickRisk: tickRiskLabel(Number(slot0.tick)),
        },
        sell,
        buy,
        notes: [
          "V3 quote is stronger than reserve presence, but still not wallet execution proof.",
        ],
      });
    }
  }

  return routes;
}

async function quoteV3(quoter, input, output, fee, amountIn) {
  try {
    const quote = await quoter.quoteExactInputSingle.staticCall([
      input.address,
      output.address,
      amountIn,
      fee,
      0,
    ]);
    return quoteOk(amountIn, quote.amountOut, input, output, quote.gasEstimate);
  } catch (error) {
    return quoteFail(amountIn, input, output, error);
  }
}

async function detectManualV4(token) {
  const manual = CONFIG.v4Manual;
  const required = [manual.currency0, manual.currency1, manual.fee, manual.tickSpacing, manual.hooks];
  if (required.every((value) => value === undefined || value === "")) return [];
  if (required.some((value) => value === undefined || value === "")) {
    return [{
      protocol: "UniswapV4",
      pool: null,
      pair: "manual PoolKey",
      state: { activeLiquidity: false },
      sell: quoteConfigFail("Incomplete v4 PoolKey. Set V4_CURRENCY0, V4_CURRENCY1, V4_FEE, V4_TICK_SPACING, V4_HOOKS."),
      buy: quoteConfigFail("Incomplete v4 PoolKey."),
      notes: ["Manual v4 detection skipped because PoolKey is incomplete."],
    }];
  }

  const poolKey = normalizeV4PoolKey({
    currency0: manual.currency0,
    currency1: manual.currency1,
    fee: manual.fee,
    tickSpacing: manual.tickSpacing,
    hooks: manual.hooks,
  });
  const poolId = manual.poolId ?? computeV4PoolId(poolKey);
  return [await inspectV4Pool(token, poolKey, poolId, "manual")];
}

async function scanRecentV4(token) {
  if (!CONFIG.v4AutoScan || CONFIG.v4ScanBlocks === 0) return [];

  const iface = new Interface(V4_POOL_MANAGER_ABI);
  const topic0 = id("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)");
  const tokenTopic = zeroPadValue(token.address, 32);
  const latest = await provider.getBlockNumber();
  const fromBlock = CONFIG.v4ScanFromBlock ??
    (CONFIG.v4ScanBlocks === null
      ? V4_MAINNET_START_BLOCK
      : Math.max(0, latest - CONFIG.v4ScanBlocks));
  const logs = [];

  for (const topics of [[topic0, null, tokenTopic], [topic0, null, null, tokenTopic]]) {
    for (let from = fromBlock; from <= latest; from += CONFIG.v4ScanChunk) {
      const to = Math.min(latest, from + CONFIG.v4ScanChunk - 1);
      const chunk = await provider.getLogs({
        address: ADDRESSES.uniswapV4PoolManager,
        fromBlock: from,
        toBlock: to,
        topics,
      });
      logs.push(...chunk);
    }
  }

  const seen = new Set();
  const routes = [];
  for (const log of logs) {
    const parsed = iface.parseLog(log);
    const poolKey = normalizeV4PoolKey({
      currency0: parsed.args.currency0,
      currency1: parsed.args.currency1,
      fee: parsed.args.fee,
      tickSpacing: parsed.args.tickSpacing,
      hooks: parsed.args.hooks,
    });
    const poolId = parsed.args.id;
    if (seen.has(poolId)) continue;
    seen.add(poolId);
    routes.push(await inspectV4Pool(token, poolKey, poolId, `scan block ${log.blockNumber}`));
  }

  return routes;
}

async function inspectV4Pool(token, poolKey, poolId, source) {
  const stateView = new Contract(ADDRESSES.uniswapV4StateView, V4_STATE_VIEW_ABI, provider);
  const quoter = new Contract(ADDRESSES.uniswapV4Quoter, V4_QUOTER_ABI, provider);

  const currency0 = await getCurrencyInfo(poolKey.currency0);
  const currency1 = await getCurrencyInfo(poolKey.currency1);
  const tokenIs0 = same(token.address, currency0.address);
  const tokenIs1 = same(token.address, currency1.address);
  const other = tokenIs0 ? currency1 : currency0;

  if (!tokenIs0 && !tokenIs1) {
    return {
      protocol: "UniswapV4",
      pool: poolId,
      pair: `${currency0.symbol}/${currency1.symbol}`,
      source,
      poolKey,
      state: { activeLiquidity: false },
      sell: quoteConfigFail("Token is not part of this v4 PoolKey."),
      buy: quoteConfigFail("Token is not part of this v4 PoolKey."),
      notes: ["PoolKey does not include target token."],
    };
  }

  const [slot0, liquidity] = await Promise.all([
    stateView.getSlot0(poolId),
    stateView.getLiquidity(poolId),
  ]);
  const sellZeroForOne = tokenIs0;
  const buyZeroForOne = tokenIs1;
  const sell = await quoteV4(quoter, poolKey, sellZeroForOne, token, other, parseUnits(CONFIG.sellAmount, token.decimals));
  const buy = await quoteV4(quoter, poolKey, buyZeroForOne, other, token, parseUnits(sampleBuyAmount(other), other.decimals));

  return {
    protocol: "UniswapV4",
    pool: poolId,
    pair: `${currency0.symbol}/${currency1.symbol}`,
    source,
    poolKey,
    state: {
      activeLiquidity: liquidity > 0n,
      liquidity: liquidity.toString(),
      sqrtPriceX96: slot0.sqrtPriceX96.toString(),
      tick: Number(slot0.tick),
      tickRisk: tickRiskLabel(Number(slot0.tick)),
      protocolFee: Number(slot0.protocolFee),
      lpFee: Number(slot0.lpFee),
    },
    sell,
    buy,
    notes: [
      "V4 pools live under PoolManager; no standalone pair contract exists.",
      "For v4, lack of active liquidity or boundary tick usually explains no-route behavior.",
    ],
  };
}

async function quoteV4(quoter, poolKey, zeroForOne, input, output, amountIn) {
  try {
    const quote = await quoter.quoteExactInputSingle.staticCall([
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
      zeroForOne,
      amountIn,
      "0x",
    ]);
    return quoteOk(amountIn, quote.amountOut, input, output, quote.gasEstimate);
  } catch (error) {
    return quoteFail(amountIn, input, output, error);
  }
}

async function getCurrencyInfo(address) {
  const normalized = normalizeCurrencyAddress(address);
  if (same(normalized, ZERO_NATIVE)) {
    return {
      address: ZERO_NATIVE,
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
      totalSupply: null,
      owner: null,
    };
  }

  const base = BASES.find((item) => same(item.address, normalized));
  const contract = new Contract(normalized, ERC20_ABI, provider);
  const [name, symbol, decimals, totalSupply, owner] = await Promise.all([
    optionalCall(() => contract.name()),
    optionalCall(() => contract.symbol()),
    optionalCall(() => contract.decimals()),
    optionalCall(() => contract.totalSupply()),
    optionalCall(() => contract.owner()),
  ]);

  const resolvedDecimals = decimals === null ? base?.decimals ?? 18 : Number(decimals);
  return {
    address: getAddress(normalized),
    symbol: cleanText(symbol) ?? base?.symbol ?? shortAddress(normalized),
    name: cleanText(name),
    decimals: resolvedDecimals,
    totalSupply: totalSupply === null ? null : decimalString(totalSupply, resolvedDecimals),
    owner: owner && owner !== ZeroAddress ? owner : null,
  };
}

function buildVerdict(routes) {
  const poolsFound = routes.length;
  const activePools = routes.filter((route) => route.state?.activeLiquidity).length;
  const sellQuotes = routes.filter((route) => route.sell?.ok && route.sell.amountOutRaw !== "0").length;
  const buyQuotes = routes.filter((route) => route.buy?.ok && route.buy.amountOutRaw !== "0").length;

  if (poolsFound === 0) {
    return {
      code: "NO_DIRECT_POOL_FOUND",
      detail: "No direct Uniswap v2/v3 pool was found, and no v4 pool was supplied or discovered.",
      poolsFound,
      activePools,
      sellQuotes,
      buyQuotes,
    };
  }

  if (sellQuotes === 0) {
    return {
      code: "POOLS_FOUND_BUT_NO_SELL_QUOTE",
      detail: "At least one pool exists, but no checked route produced a positive sell quote.",
      poolsFound,
      activePools,
      sellQuotes,
      buyQuotes,
    };
  }

  if (buyQuotes === 0) {
    return {
      code: "SELL_QUOTE_AVAILABLE_NOT_EXECUTION_PROOF",
      detail: "A sell quote exists, but buy quote is missing on checked direct routes. This is not wallet execution proof.",
      poolsFound,
      activePools,
      sellQuotes,
      buyQuotes,
    };
  }

  return {
    code: "DIRECT_BUY_SELL_QUOTES_AVAILABLE",
    detail: "At least one direct route produced positive buy and sell quotes. This still does not prove a wallet can sell.",
    poolsFound,
    activePools,
    sellQuotes,
    buyQuotes,
  };
}

function printReport(report) {
  console.log("Read-Only Token Risk Detector");
  console.log(`checkedAt=${report.checkedAt}`);
  console.log(`chainId=${report.chainId}`);
  console.log("");
  console.log("Token");
  console.log(`address=${report.token.address}`);
  console.log(`symbol=${report.token.symbol}`);
  if (report.token.name) console.log(`name=${report.token.name}`);
  console.log(`decimals=${report.token.decimals}`);
  console.log(`totalSupply=${report.token.totalSupply ?? "unknown"}`);
  console.log(`owner=${report.token.owner ?? "none/unknown"}`);
  console.log(`hasCode=${report.token.hasCode}`);
  console.log("");

  console.log("Routes");
  if (report.routes.length === 0) {
    console.log("No direct routes found.");
  }

  for (const route of report.routes) {
    console.log(`- ${route.protocol} ${route.pair} pool=${route.pool}`);
    if (route.fee !== undefined) console.log(`  fee=${route.fee}`);
    if (route.source) console.log(`  source=${route.source}`);
    if (route.state) {
      const stateItems = Object.entries(route.state)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ");
      console.log(`  state: ${stateItems}`);
    }
    console.log(`  sell: ${formatQuote(route.sell)}`);
    console.log(`  buy:  ${formatQuote(route.buy)}`);
    for (const note of route.notes ?? []) {
      console.log(`  note: ${note}`);
    }
  }

  console.log("");
  console.log("Verdict");
  console.log(`${report.verdict.code}: ${report.verdict.detail}`);
  console.log(`poolsFound=${report.verdict.poolsFound}, activePools=${report.verdict.activePools}, sellQuotes=${report.verdict.sellQuotes}, buyQuotes=${report.verdict.buyQuotes}`);
  console.log("");
  console.log("Limits");
  for (const limit of report.limits) {
    console.log(`- ${limit}`);
  }
}

function printSummary(report) {
  const byProtocol = {};
  for (const route of report.routes) {
    const bucket = byProtocol[route.protocol] ?? {
      routes: 0,
      active: 0,
      sellQuotes: 0,
      buyQuotes: 0,
    };
    bucket.routes += 1;
    if (route.state?.activeLiquidity) bucket.active += 1;
    if (route.sell?.ok && route.sell.amountOutRaw !== "0") bucket.sellQuotes += 1;
    if (route.buy?.ok && route.buy.amountOutRaw !== "0") bucket.buyQuotes += 1;
    byProtocol[route.protocol] = bucket;
  }

  console.log("Read-Only Token Risk Detector Summary");
  console.log(`${report.token.symbol} ${report.token.address}`);
  console.log(`${report.verdict.code}: ${report.verdict.detail}`);
  for (const [protocol, stats] of Object.entries(byProtocol)) {
    console.log(`${protocol}: routes=${stats.routes}, active=${stats.active}, sellQuotes=${stats.sellQuotes}, buyQuotes=${stats.buyQuotes}`);
  }

  const bestSellQuotes = bestSellRoutes(report.routes);
  if (bestSellQuotes.length > 0) {
    console.log("Best sell quotes:");
    for (const route of bestSellQuotes.slice(0, 5)) {
      const priceText = route.sell.price
        ? `price=1 ${report.token.symbol} ~= ${route.sell.price.outputPerInput} ${route.sell.outputSymbol}`
        : "price=unknown";
      console.log(`- ${route.protocol} ${route.pair}: ${route.sell.amountIn} ${route.sell.inputSymbol} -> ${route.sell.amountOut} ${route.sell.outputSymbol}; ${priceText}`);
    }
  } else {
    console.log("Best sell quotes: none");
  }

  const v4 = report.routes.filter((route) => route.protocol === "UniswapV4");
  if (v4.length > 0) {
    console.log("Top v4 routes:");
    for (const route of v4.slice(0, 10)) {
      console.log(`- ${route.pair} pool=${route.pool} active=${route.state.activeLiquidity} sell=${route.sell.ok} buy=${route.buy.ok} tick=${route.state.tick} ${route.state.tickRisk}`);
    }
  }
}

function formatQuote(quote) {
  if (!quote.ok) return `FAIL ${quote.error}`;
  const gas = quote.gasEstimate ? `, gas=${quote.gasEstimate}` : "";
  const price = quote.price ? `, price=1 ${quote.inputSymbol} ~= ${quote.price.outputPerInput} ${quote.outputSymbol}` : "";
  return `OK ${quote.amountIn} ${quote.inputSymbol} -> ${quote.amountOut} ${quote.outputSymbol}${price}${gas}`;
}

function quoteOk(amountIn, amountOut, input, output, gasEstimate = null) {
  return {
    ok: true,
    inputSymbol: input.symbol,
    outputSymbol: output.symbol,
    amountIn: decimalString(amountIn, input.decimals),
    amountOut: decimalString(amountOut, output.decimals),
    amountInRaw: amountIn.toString(),
    amountOutRaw: amountOut.toString(),
    price: buildPrice(amountIn, amountOut, input, output),
    gasEstimate: gasEstimate === null ? null : gasEstimate.toString(),
  };
}

function quoteFail(amountIn, input, output, error) {
  return {
    ok: false,
    inputSymbol: input.symbol,
    outputSymbol: output.symbol,
    amountIn: decimalString(amountIn, input.decimals),
    amountInRaw: amountIn.toString(),
    error: decodeRevert(error.data) ?? shortError(error),
  };
}

function quoteConfigFail(message) {
  return {
    ok: false,
    inputSymbol: null,
    outputSymbol: null,
    amountIn: null,
    amountInRaw: null,
    error: message,
  };
}

function bestSellRoutes(routes) {
  return routes
    .filter((route) => route.sell?.ok && route.sell.amountOutRaw !== "0")
    .sort((a, b) => sellRouteScore(b) - sellRouteScore(a));
}

function sellRouteScore(route) {
  const quote = route.sell;
  const stableBonus = STABLE_SYMBOLS.has(quote.outputSymbol) ? 1_000_000 : 0;
  const ethBonus = quote.outputSymbol === "WETH" || quote.outputSymbol === "ETH" ? 500_000 : 0;
  const activeBonus = route.state?.activeLiquidity ? 10_000 : 0;
  return stableBonus + ethBonus + activeBonus + (Number(quote.price?.outputPerInputNumber) || 0);
}

function buildPrice(amountIn, amountOut, input, output) {
  if (amountIn === 0n || amountOut === 0n) return null;
  const outputPerInput = decimalRatio(amountOut, output.decimals, amountIn, input.decimals);
  const inputPerOutput = decimalRatio(amountIn, input.decimals, amountOut, output.decimals);
  return {
    outputPerInput,
    inputPerOutput,
    outputPerInputNumber: Number(outputPerInput),
    inputPerOutputNumber: Number(inputPerOutput),
  };
}

function decimalRatio(numeratorRaw, numeratorDecimals, denominatorRaw, denominatorDecimals) {
  const numerator = Number(formatUnits(numeratorRaw, numeratorDecimals));
  const denominator = Number(formatUnits(denominatorRaw, denominatorDecimals));
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return "unknown";
  }
  return compactNumber(numerator / denominator);
}

function compactNumber(value) {
  if (!Number.isFinite(value)) return "unknown";
  if (value === 0) return "0";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return value.toExponential(6);
  if (absolute >= 1) return value.toLocaleString("en-US", { maximumSignificantDigits: 10 });
  if (absolute >= 0.000001) return value.toPrecision(8).replace(/\.?0+$/, "");
  return value.toExponential(6);
}

function decodeRevert(data) {
  if (!data || typeof data !== "string" || data.length < 10) return null;
  const selector = data.slice(0, 10).toLowerCase();
  const name = ERROR_SELECTORS[selector] ?? selector;

  try {
    if (selector === "0x08c379a0") {
      const [reason] = abiCoder.decode(["string"], `0x${data.slice(10)}`);
      return `${name}: ${reason}`;
    }

    if (selector === "0x6190b2b0") {
      const [inner] = abiCoder.decode(["bytes"], `0x${data.slice(10)}`);
      const innerDecoded = decodeRevert(inner);
      return innerDecoded ? `${name} -> ${innerDecoded}` : name;
    }

    if (selector === "0x7a5ed734") {
      const [poolId] = abiCoder.decode(["bytes32"], `0x${data.slice(10)}`);
      return `${name}: poolId=${poolId}`;
    }

    if (selector === "0x7c9c6e8f") {
      const [current, limit] = abiCoder.decode(["uint160", "uint160"], `0x${data.slice(10)}`);
      return `${name}: current=${current} limit=${limit}`;
    }

    if (selector === "0xecbd9804") {
      const [amount] = abiCoder.decode(["uint256"], `0x${data.slice(10)}`);
      return `${name}: amount=${amount}`;
    }
  } catch {
    return name;
  }

  return name;
}

function normalizeV4PoolKey(poolKey) {
  return {
    currency0: normalizeCurrencyAddress(poolKey.currency0),
    currency1: normalizeCurrencyAddress(poolKey.currency1),
    fee: Number(poolKey.fee),
    tickSpacing: Number(poolKey.tickSpacing),
    hooks: getAddress(poolKey.hooks),
  };
}

function computeV4PoolId(poolKey) {
  return keccak256(abiCoder.encode(
    ["address", "address", "uint24", "int24", "address"],
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
  ));
}

function normalizeCurrencyAddress(address) {
  if (!address) throw new Error("Missing address");
  if (same(address, ZERO_NATIVE) || same(address, ZeroAddress)) return ZERO_NATIVE;
  return getAddress(address);
}

function same(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function decimalString(value, decimals) {
  return formatUnits(value, decimals);
}

function sampleBuyAmount(currency) {
  const base = BASES.find((item) => same(item.address, currency.address));
  if (base) return base.buyAmount;
  if (same(currency.address, ZERO_NATIVE)) return "0.001";
  return "1";
}

function tickRiskLabel(tick) {
  if (tick >= MAX_TICK - 1) return "at/near max tick";
  if (tick <= -MAX_TICK + 1) return "at/near min tick";
  return "inside normal bounds";
}

function cleanText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\u0000/g, "").trim();
  return trimmed === "" ? null : trimmed;
}

function shortAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function optionalCall(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function shortError(error) {
  return error?.shortMessage || error?.reason || error?.message || String(error);
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      parsed._.push(item);
      continue;
    }

    const withoutPrefix = item.slice(2);
    const equalIndex = withoutPrefix.indexOf("=");
    if (equalIndex !== -1) {
      parsed[withoutPrefix.slice(0, equalIndex)] = withoutPrefix.slice(equalIndex + 1);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[withoutPrefix] = next;
      index += 1;
    } else {
      parsed[withoutPrefix] = true;
    }
  }
  return parsed;
}

function numberArg(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected number, got ${value}`);
  return parsed;
}

function optionalNumberArg(value) {
  if (value === undefined || value === null || value === "") return null;
  return numberArg(value, null);
}

function boolArg(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === false) return value;
  const normalized = String(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Expected boolean, got ${value}`);
}

function jsonReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}
