import _ from "lodash";
import { baseAsset, quoteAsset, side, grid, earn, interest, trigger, minNotional, interval } from "./modules/argv.js";
import * as binance from "./modules/binance.js";
import "./modules/db.js"; // Connect to MongoDB

let buyNotional;
let sellNotional;
let sellNotionalAvailable;
let buyPrice;
let sellPrice;
let kill = false;

// READS FILTERS
const exchangeInfo = await binance.exchangeInfo(baseAsset, quoteAsset);
const [symbols] = exchangeInfo.data.symbols;

const [
  // Use DESTRUCTURING ASSIGNMENT
  PRICE_FILTER, // filterType, minPrice, maxPrice, tickSize
  LOT_SIZE, // filterType, minQty, maxQty, stepSize
  MIN_NOTIONAL, // filterType, minNotional, applyToMarket, avgPriceMins
  ICEBERG_PARTS, // filterType, limit
  MARKET_LOT_SIZE, // filterType, minQty, maxQty, stepSize
  TRAILING_DELTA, // minTrailingAboveDelta, maxTrailingAboveDelta, minTrailingBelowDelta, maxTrailingBelowDelta
  PERCENT_PRICE_BY_SIDE, // bidMultiplierUp, bidMultiplierDown, askMultiplierUp, askMultiplierDown, avgPriceMins
  MAX_NUM_ORDERS, // filterType, maxNumOrders
  MAX_NUM_ALGO_ORDERS, // filterType, maxNumAlgoOrders
] = symbols.filters;

PRICE_FILTER.precision = Math.round(-Math.log10(PRICE_FILTER.tickSize));
LOT_SIZE.precision = Math.round(-Math.log10(LOT_SIZE.stepSize));
const notional = minNotional || MIN_NOTIONAL.minNotional;
console.log(`notional: ${notional}`);

console.log(`PRICE_FILTER.precision: ${PRICE_FILTER.precision} / LOT_SIZE.precision: ${LOT_SIZE.precision}`);

setInterval(async () => {
  if (kill) process.exit(0);

  let baseToBuy;
  let baseAvailable;
  let baseToSell;

  // READS BALANCES
  const account = await binance.account();
  console.log(`=======================================`);

  const [makerCommission, takerCommission] = binance.calculateCommissions(account.data);

  const balances = binance.getBalances(account.data.balances);

  const orders = await binance.openOrders(baseAsset, quoteAsset);
  const exchangeOrders = orders;
  console.log(`There are ${orders.data.length} of ${MAX_NUM_ORDERS.maxNumOrders} orders open.`);

  const ticker = await binance.tickerPrice(baseAsset, quoteAsset);

  let price = ticker.data.price;

  let lowerPrice = binance.getLowerPrice(price, grid, PRICE_FILTER.precision);
  let higherPrice = binance.getHigherPrice(price, grid, PRICE_FILTER.precision);

  console.log(`lowerPrice: ${lowerPrice} - slot: ${binance.priceToSlot(lowerPrice, grid)}`);
  console.log(`price: ${price} - slot: ${binance.priceToSlot(price, grid)}`);
  console.log(`higherPrice: ${higherPrice} - slot: ${binance.priceToSlot(higherPrice, grid)}`);

  try {
    switch (side) {
      case "buy":
        buyPrice = higherPrice;
        sellPrice = _.floor(buyPrice * (1 + interest), PRICE_FILTER.precision);

        if (trigger !== undefined && sellPrice >= trigger) {
          throw new Error("sellPrice >= trigger");
        } else console.log("Trigger NOT active!");

        if (buyPrice === sellPrice) throw new Error("buyPrice === sellPrice");

        baseToBuy = _.ceil(notional / buyPrice, LOT_SIZE.precision);
        baseAvailable = baseToBuy * (1 - takerCommission);

        buyNotional = buyPrice * baseToBuy;

        if (balances[quoteAsset] === undefined || balances[quoteAsset].free < buyNotional) throw new Error("No BUY balance to trade.");

        if (earn === "base") {
          baseToSell = _.ceil(buyNotional / sellPrice / (1 - makerCommission), LOT_SIZE.precision);
        } else if (earn === "quote") {
          baseToSell = _.floor(baseAvailable, LOT_SIZE.precision);
        }

        if (baseAvailable - baseToSell < 0) throw new Error("baseAvailable - baseToSell < 0");

        sellNotional = sellPrice * baseToSell;
        sellNotionalAvailable = sellNotional * (1 - makerCommission);

        if (sellNotionalAvailable - buyNotional < 0) throw new Error("sellNotionalAvailable - buyNotional < 0");

        break;
      case "sell":
        sellPrice = lowerPrice;
        buyPrice = _.ceil(sellPrice / (1 + interest), PRICE_FILTER.precision);

        if (trigger !== undefined && buyPrice <= trigger) {
          throw new Error("buyPrice <= trigger");
        } else console.log("Trigger NOT active!");

        if (buyPrice === sellPrice) throw new Error("buyPrice === sellPrice");

        baseToSell = _.ceil(notional / sellPrice / (1 - interest) / (1 - takerCommission), LOT_SIZE.precision);

        sellNotional = sellPrice * baseToSell;

        if (balances[baseAsset] === undefined || balances[baseAsset].free * sellPrice < sellNotional) throw new Error("No SELL balance to trade.");

        sellNotionalAvailable = sellNotional * (1 - takerCommission);

        if (earn === "base") {
          baseToBuy = _.floor(sellNotionalAvailable / buyPrice, LOT_SIZE.precision);
        } else if (earn === "quote") {
          baseToBuy = _.ceil(baseToSell / (1 - makerCommission), LOT_SIZE.precision);
        }

        baseAvailable = baseToBuy * (1 - makerCommission);

        if (baseAvailable - baseToSell < 0) throw new Error("baseAvailable - baseToSell < 0");

        buyNotional = buyPrice * baseToBuy;

        if (sellNotionalAvailable - buyNotional < 0) throw new Error("sellNotionalAvailable - buyNotional < 0");

        break;
    }
  } catch (error) {
    console.error(error);
    return;
  }

  let slot1 = binance.priceToSlot(sellPrice, grid);
  let slot2 = binance.priceToSlot(buyPrice, grid);

  const openOrders = binance.getOpenOrders(exchangeOrders.data, grid);

  if ((side === "buy" && openOrders[slot1] !== undefined) || (side === "sell" && openOrders[slot2] !== undefined)) {
    console.log(`slot1: ${slot1} / slot2: ${slot2}`);
    return;
  }

  switch (side) {
    case "buy":
      // BUY ORDER
      const buyOrder = await binance.order({
        symbol: baseAsset + quoteAsset,
        side: "BUY",
        type: "LIMIT",
        timeInForce: "FOK",
        quantity: baseToBuy,
        price: buyPrice,
      });
      console.log(buyOrder.data);

      if (buyOrder.data.status === "FILLED") {
        // SELL ORDER
        const sellOrder = await binance.order({
          symbol: baseAsset + quoteAsset,
          side: "SELL",
          type: "LIMIT",
          timeInForce: "GTC",
          quantity: baseToSell,
          price: sellPrice,
        });
      }
      break;
    case "sell":
      // SELL ORDER
      const sellOrder = await binance.order({
        symbol: baseAsset + quoteAsset,
        side: "SELL",
        type: "LIMIT",
        timeInForce: "FOK",
        quantity: baseToSell,
        price: sellPrice,
      });
      console.log(sellOrder.data);

      if (sellOrder.data.status === "FILLED") {
        // BUY ORDER
        const buyOrder = await binance.order({
          symbol: baseAsset + quoteAsset,
          side: "BUY",
          type: "LIMIT",
          timeInForce: "GTC",
          quantity: baseToBuy,
          price: buyPrice,
        });
        console.log(buyOrder.data);
      }
      break;
  }
}, interval);

process.on("SIGINT", () => {
  kill = true;
});
