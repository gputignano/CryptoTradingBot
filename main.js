import _ from "lodash";
import WebSocket from "ws";
import { baseAsset, quoteAsset, side, grid, earn, interest, trigger, minNotional, interval } from "./modules/argv.js";
import * as binance from "./modules/binance.js";

let kill = false;
let price;

const [PRICE_FILTER, LOT_SIZE, MIN_NOTIONAL, ICEBERG_PARTS, MARKET_LOT_SIZE, TRAILING_DELTA, PERCENT_PRICE_BY_SIDE, MAX_NUM_ORDERS, MAX_NUM_ALGO_ORDERS,] = await binance.getExchangeInfoFilters(baseAsset, quoteAsset);

const notional = Math.max(minNotional || MIN_NOTIONAL.minNotional, MIN_NOTIONAL.minNotional);
console.log(`notional: ${notional}`);

console.log(`PRICE_FILTER.precision: ${PRICE_FILTER.precision} / LOT_SIZE.precision: ${LOT_SIZE.precision}`);

const ws_market_stream = new WebSocket(`${binance.WEBSOCkET_STREAM_BASE_URL}/ws`);

ws_market_stream.on("error", error => console.error(error.message));
ws_market_stream.on("open", () => {
  ws_market_stream.send(
    JSON.stringify({
      method: "SUBSCRIBE",
      params: [baseAsset.toLowerCase() + quoteAsset.toLowerCase() + "@trade"],
      id: 1,
    })
  );
});
ws_market_stream.on("close", () => { });
ws_market_stream.on("ping", data => ws_market_stream.pong());
ws_market_stream.on("pong", data => { });
ws_market_stream.on("message", data => {
  const currentPrice = JSON.parse(data).p;

  if (currentPrice !== price) {
    price = currentPrice;
    console.log(price);
  };
});

setInterval(async () => {
  if (kill) process.exit(0);

  let baseToBuy;
  let baseAvailable;
  let baseToSell;
  let buyNotional;
  let sellNotional;
  let sellNotionalAvailable;
  let buyPrice;
  let sellPrice;

  // READS BALANCES
  const account = await binance.account();
  console.log(`=======================================`);

  const [makerCommission, takerCommission] = binance.calculateCommissions(account.data);

  const balances = binance.getBalances(account.data.balances);

  const orders = await binance.openOrders(baseAsset, quoteAsset);
  console.log(`There are ${orders.data.length} of ${MAX_NUM_ORDERS.maxNumOrders} orders open.`);

  const lowerPrice = binance.getLowerPrice(price, grid, PRICE_FILTER.precision);
  const higherPrice = binance.getHigherPrice(price, grid, PRICE_FILTER.precision);

  console.log(`lowerPrice: ${lowerPrice} - slot: ${binance.priceToSlot(lowerPrice, grid)}`);
  console.log(`price: ${price} - slot: ${binance.priceToSlot(price, grid)}`);
  console.log(`higherPrice: ${higherPrice} - slot: ${binance.priceToSlot(higherPrice, grid)}`);

  try {
    if (side === "buy") {
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

    } else if (side === "sell") {
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
    }
  } catch (error) {
    console.error(error);
    return;
  }

  const slot1 = binance.priceToSlot(sellPrice, grid);
  const slot2 = binance.priceToSlot(buyPrice, grid);

  const openOrders = binance.getOpenOrders(orders.data, grid);

  if ((side === "buy" && openOrders[slot1] !== undefined) || (side === "sell" && openOrders[slot2] !== undefined)) {
    console.log(`slot1: ${slot1} / slot2: ${slot2}`);
    return;
  }

  try {
    if (side === "buy") {
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
        console.log(sellOrder.data);
      }
    } else if (side === "sell") {
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
    }
  } catch (error) {
    console.error(error.response.data);
    process.exit(0);
  }

}, interval);

process.on("SIGINT", () => {
  kill = true;
});
