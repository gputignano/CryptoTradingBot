import _ from "lodash";
import WebSocket from "ws";
import { baseAsset, quoteAsset, side, grid, earn, interest, minNotional } from "./modules/argv.js";
import * as binance from "./modules/binance.js";

let kill = false;
let price;
let account;
let orders;
let openOrders;
const openTrades = new Set();

const [PRICE_FILTER, LOT_SIZE, ICEBERG_PARTS, MARKET_LOT_SIZE, TRAILING_DELTA, PERCENT_PRICE_BY_SIDE, NOTIONAL, MAX_NUM_ORDERS, MAX_NUM_ALGO_ORDERS,] = await binance.getExchangeInfoFilters(baseAsset, quoteAsset);
const notional = Math.max(minNotional || NOTIONAL.minNotional, NOTIONAL.minNotional);
console.log(`notional: ${notional}`);

console.log(`PRICE_FILTER.precision: ${PRICE_FILTER.precision} / LOT_SIZE.precision: ${LOT_SIZE.precision}`);

const startWsMarketDataStream = () => {
  // WEBSOCKET MARKET DATA STREAM
  let ws_market_data_stream = new WebSocket(`${binance.WS_MARKET_DATA_STREAM}/ws`);

  ws_market_data_stream.on("error", error => console.error(error.message));
  ws_market_data_stream.on("open", async () => {
    price = (await binance.tickerPrice(baseAsset, quoteAsset)).data.price;

    ws_market_data_stream.send(
      JSON.stringify({
        method: "SUBSCRIBE",
        params: [baseAsset.toLowerCase() + quoteAsset.toLowerCase() + "@aggTrade"],
        id: 1,
      })
    );
  });
  ws_market_data_stream.on("close", () => {
    console.log(`Connection closed!`);
    ws_market_data_stream = null;
    setTimeout(startWsMarketDataStream, 5000);
  });
  ws_market_data_stream.on("ping", data => {
    ws_market_data_stream.pong();
  });
  ws_market_data_stream.on("pong", () => {
    //
  });
  ws_market_data_stream.on("message", async data => {
    if (kill) process.exit(0);

    const currentPrice = JSON.parse(data).p || price;

    if (currentPrice !== price) {
      price = currentPrice;
      const slot = binance.priceToSlot(price, grid);

      if (!openTrades.has(slot)) {
        openTrades.add(slot);
        // console.log(`added slot ${slot}`);
        trade(price, slot);
      }
      // else console.log(`has slot: ${slot}`);
    };
  });
};

startWsMarketDataStream();

// WEBSOCKET USER DATA STREAM
const listenKey = (await binance.postApiV3UserDataStream()).data.listenKey;
const ws_user_data_stream = new WebSocket(`${binance.WS_MARKET_DATA_STREAM}/ws/${listenKey}`);

ws_user_data_stream.on("error", error => console.error(error.message));
ws_user_data_stream.on("open", async () => {
  account = (await binance.account(baseAsset, quoteAsset)).data;
  orders = (await binance.openOrders(baseAsset, quoteAsset)).data;
  // console.log(`orders: ${orders.length}`);
  openOrders = binance.getOpenOrders(orders, PRICE_FILTER.precision);

  setInterval(async () => (await binance.putApiV3UserDataStream(listenKey)).data, 30 * 60 * 1000);
});
ws_user_data_stream.on("close", () => console.error(`ws_user_data_stream connection closed`));
ws_user_data_stream.on("message", async data => {
  const payload = JSON.parse(data.toString());
  const dateTime = new Date(payload.E);

  switch (payload.e) {
    case "outboundAccountPosition":
      // Account Update
      // console.log(`${dateTime.toLocaleString()}, e: ${payload.e}, B: ${JSON.stringify(payload.B)}`);

      // UPDATE BALANCES
      payload.B.filter(asset => [baseAsset, quoteAsset].includes(asset.a)).forEach(b => {
        account.balances[b.a].free = b.f;
        account.balances[b.a].locked = b.l;
      });
      // console.log(account.balances);
      break;
    case "balanceUpdate":
      // Balance Update
      // console.log(`${dateTime.toLocaleString()}, e: ${payload.e}, a: ${payload.a}, d: ${payload.d}`);

      if (payload.a === baseAsset || payload.a === quoteAsset) account.balances[payload.a].free += payload.d;
      break;
    case "executionReport":
      // Order Update
      if (payload.s !== (baseAsset + quoteAsset)) return;

      // console.log(`${dateTime.toLocaleString()}, e: ${payload.e}, s: ${payload.s}, S: ${payload.S}, f: ${payload.f}, x: ${payload.x}, X: ${payload.X}`);

      orders = (await binance.openOrders(baseAsset, quoteAsset)).data;
      // console.log(`orders: ${orders.length}`);
      openOrders = binance.getOpenOrders(orders, PRICE_FILTER.precision);

      if (payload.x === "TRADE" && payload.X === "FILLED") openTrades.delete(binance.priceToSlot(payload.p, grid));

      break;
  }
});

const trade = async (tradingPrice, slot) => {
  // console.log(`Trading at ${tradingPrice}`);

  let baseToBuy;
  let baseAvailable;
  let baseToSell;
  let buyNotional;
  let sellNotional;
  let sellNotionalAvailable;
  let buyPrice;
  let sellPrice;

  const lowerPrice = binance.getLowerPrice(tradingPrice, grid, PRICE_FILTER.precision);
  const higherPrice = binance.getHigherPrice(tradingPrice, grid, PRICE_FILTER.precision);

  if (side === "buy") {
    buyPrice = higherPrice;
    sellPrice = _.floor(buyPrice * (1 + interest), PRICE_FILTER.precision);

    if (price > buyPrice) {
      openTrades.delete(slot);
      return;
    };

    if (openOrders.has(sellPrice)) {
      // console.log(`Open order at sellPrice: ${sellPrice}`);
      openTrades.delete(slot);
      return;
    } else {
      // console.log(`No open order at sellPrice: ${sellPrice}`);
    }

    if (buyPrice === sellPrice) {
      console.error("buyPrice === sellPrice");
      openTrades.delete(slot);
      return;
    }

    baseToBuy = _.ceil(notional / buyPrice, LOT_SIZE.precision);
    baseAvailable = baseToBuy * (1 - account.takerCommission);

    buyNotional = buyPrice * baseToBuy;

    if (account.balances[quoteAsset] === undefined || account.balances[quoteAsset].free < buyNotional) {
      console.error("No BUY balance to trade.");
      openTrades.delete(slot);
      return;
    }

    if (earn === "base") {
      baseToSell = _.ceil(buyNotional / sellPrice / (1 - account.makerCommission), LOT_SIZE.precision);
    } else if (earn === "quote") {
      baseToSell = _.floor(baseAvailable, LOT_SIZE.precision);
    }

    if (baseAvailable - baseToSell < 0) {
      console.error("baseAvailable - baseToSell < 0");
      openTrades.delete(slot);
      return;
    }

    sellNotional = sellPrice * baseToSell;
    sellNotionalAvailable = sellNotional * (1 - account.makerCommission);

    if (sellNotionalAvailable - buyNotional < 0) {
      console.error("sellNotionalAvailable - buyNotional < 0");
      openTrades.delete(slot);
      return;
    }

  } else if (side === "sell") {
    sellPrice = lowerPrice;
    buyPrice = _.ceil(sellPrice / (1 + interest), PRICE_FILTER.precision);

    if (price < sellPrice) {
      openTrades.delete(slot);
      return;
    };

    if (openOrders.has(buyPrice)) {
      // console.log(`Open order at buyPrice: ${buyPrice}`);
      openTrades.delete(slot);
      return;
    } else {
      // console.log(`No open order at sellPrice: ${sellPrice}`);
    }

    if (buyPrice === sellPrice) {
      console.error("buyPrice === sellPrice");
      openTrades.delete(slot);
      return;
    }

    baseToSell = _.ceil(notional / sellPrice / (1 - interest) / (1 - account.takerCommission), LOT_SIZE.precision);

    sellNotional = sellPrice * baseToSell;

    if (account.balances[baseAsset] === undefined || account.balances[baseAsset].free * sellPrice < sellNotional) {
      console.error("No SELL balance to trade.");
      openTrades.delete(slot);
      return;
    }

    sellNotionalAvailable = sellNotional * (1 - account.takerCommission);

    if (earn === "base") {
      baseToBuy = _.floor(sellNotionalAvailable / buyPrice, LOT_SIZE.precision);
    } else if (earn === "quote") {
      baseToBuy = _.ceil(baseToSell / (1 - account.makerCommission), LOT_SIZE.precision);
    }

    baseAvailable = baseToBuy * (1 - account.makerCommission);

    if (baseAvailable - baseToSell < 0) {
      console.error("baseAvailable - baseToSell < 0");
      openTrades.delete(slot);
      return;
    }

    buyNotional = buyPrice * baseToBuy;

    if (sellNotionalAvailable - buyNotional < 0) {
      console.error("sellNotionalAvailable - buyNotional < 0");
      openTrades.delete(slot);
      return;
    }
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

      } else if (buyOrder.data.status === "EXPIRED") setTimeout(trade, 250, tradingPrice, slot);
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

      } else if (sellOrder.data.status === "EXPIRED") setTimeout(trade, 250, tradingPrice, slot);
    }
  } catch (error) {
    console.error(error.response.data || error);
    openTrades.delete(slot);
    process.exit(0);
  }
};

process.on("SIGINT", () => {
  kill = true;
});
