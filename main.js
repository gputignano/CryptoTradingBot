import _ from "lodash";
import WebSocket from "ws";
import { baseAsset, quoteAsset, side, grid, earn, interest, minNotional } from "./modules/argv.js";
import * as binance from "./modules/binance.js";

let kill = false;
let account = (await binance.account(baseAsset, quoteAsset));
let openOrders = (await binance.openOrders(baseAsset, quoteAsset));
const openTrades = new Set();
let slot;
let lowerPrice, higherPrice;

const [PRICE_FILTER, LOT_SIZE, ICEBERG_PARTS, MARKET_LOT_SIZE, TRAILING_DELTA, PERCENT_PRICE_BY_SIDE, NOTIONAL, MAX_NUM_ORDERS, MAX_NUM_ALGO_ORDERS,] = (await binance.exchangeInfo(baseAsset, quoteAsset)).data.symbols[0].filters;
PRICE_FILTER.precision = Math.round(-Math.log10(PRICE_FILTER.tickSize));
LOT_SIZE.precision = Math.round(-Math.log10(LOT_SIZE.stepSize));

const notional = Math.max(minNotional || NOTIONAL.minNotional, NOTIONAL.minNotional);
console.log(`notional: ${notional}`);

console.log(`PRICE_FILTER.precision: ${PRICE_FILTER.precision} / LOT_SIZE.precision: ${LOT_SIZE.precision}`);

const startWsMarketDataStream = () => {
  // WEBSOCKET MARKET DATA STREAM
  let ws = new WebSocket(`${binance.WS_STREAM_ENDPOINT}/ws`);

  ws.on("error", error => console.error(error.message));
  ws.on("open", async () => {
    console.log(`ws_stream => open`);

    ws.send(
      JSON.stringify({
        method: "SUBSCRIBE",
        params: [baseAsset.toLowerCase() + quoteAsset.toLowerCase() + "@aggTrade"],
        id: 1,
      })
    );
  });
  ws.on("close", () => {
    console.log(`ws_stream => close`);
    ws = null;
    setImmediate(startWsMarketDataStream);
  });
  ws.on("ping", data => {
    ws.pong();
  });
  ws.on("pong", () => {
    //
  });
  ws.on("message", async data => {
    if (kill) process.exit(0);

    data = JSON.parse(data);

    if (data.result === null) return;

    switch (data.e) {
      case "aggTrade":
        const currentPrice = data.p;
        slot = binance.priceToSlot(currentPrice, grid);
        lowerPrice = binance.getLowerPrice(currentPrice, grid, PRICE_FILTER.precision);
        higherPrice = binance.getHigherPrice(currentPrice, grid, PRICE_FILTER.precision);

        if (!openTrades.has(slot)) {
          openTrades.add(slot);
          trade(currentPrice, slot, lowerPrice, higherPrice);
        }
        break;
      default:
        console.log(data);
    }
  });
};

startWsMarketDataStream();

const startWsUserDataStream = async () => {
  // WEBSOCKET USER DATA STREAM
  const listenKey = (await binance.postApiV3UserDataStream()).data.listenKey;
  let ws = new WebSocket(`${binance.WS_STREAM_ENDPOINT}/ws/${listenKey}`);

  ws.on("error", error => console.error(error.message));
  ws.on("open", async () => {
    console.log(`ws_user_data_stream => open`);

    setInterval(async () => (await binance.putApiV3UserDataStream(listenKey)).data, 30 * 60 * 1000);
  });
  ws.on("close", () => {
    console.log(`ws_user_data_stream => close`);

    ws = null;
    setImmediate(startWsUserDataStream);
  });
  ws.on("message", async data => {
    const payload = JSON.parse(data.toString());

    switch (payload.e) {
      case "outboundAccountPosition":
        // Account Update

        account = (await binance.account(baseAsset, quoteAsset));

        // payload.B.filter(asset => [baseAsset, quoteAsset].includes(asset.a)).forEach(b => {
        //   account.data.balances[b.a].free = b.f;
        //   account.data.balances[b.a].locked = b.l;
        // });
        break;
      case "balanceUpdate":
        // Balance Update

        account = (await binance.account(baseAsset, quoteAsset));

        // if (payload.a === baseAsset || payload.a === quoteAsset) account.data.balances[payload.a].free += payload.d;
        break;
      case "executionReport":
        // Order Update

        if (payload.s !== (baseAsset + quoteAsset)) return;

        // openOrders = (await binance.openOrders(baseAsset, quoteAsset));

        break;
    }
  });
};

startWsUserDataStream();

const trade = async (currentPrice, slot, lowerPrice, higherPrice) => {
  let baseToBuy;
  let baseAvailable;
  let baseToSell;
  let buyNotional;
  let sellNotional;
  let sellNotionalAvailable;
  let buyPrice;
  let sellPrice;

  if (side === "buy") {
    buyPrice = higherPrice;
    sellPrice = _.floor(buyPrice * (1 + interest), PRICE_FILTER.precision);

    if (currentPrice > buyPrice) {
      openTrades.delete(slot);
      return;
    }

    if (openOrders.hasPrice(sellPrice)) {
      openTrades.delete(slot);
      return;
    }

    if (buyPrice === sellPrice) {
      console.error("buyPrice === sellPrice");
      openTrades.delete(slot);
      return;
    }

    baseToBuy = _.ceil(notional / buyPrice, LOT_SIZE.precision);
    baseAvailable = baseToBuy * (1 - account.data.commissionRates.taker);

    buyNotional = buyPrice * baseToBuy;

    if (account.data.balances[quoteAsset] === undefined || account.data.balances[quoteAsset].free < buyNotional) {
      console.error("No BUY balance to trade.");
      openTrades.delete(slot);
      return;
    }

    if (earn === "base") {
      baseToSell = _.ceil(buyNotional / sellPrice / (1 - account.data.commissionRates.maker), LOT_SIZE.precision);
    } else if (earn === "quote") {
      baseToSell = _.floor(baseAvailable, LOT_SIZE.precision);
    }

    if (baseAvailable - baseToSell < 0) {
      console.error("baseAvailable - baseToSell < 0");
      openTrades.delete(slot);
      return;
    }

    sellNotional = sellPrice * baseToSell;
    sellNotionalAvailable = sellNotional * (1 - account.data.commissionRates.maker);

    if (sellNotionalAvailable - buyNotional < 0) {
      console.error("sellNotionalAvailable - buyNotional < 0");
      openTrades.delete(slot);
      return;
    }

  } else if (side === "sell") {
    sellPrice = lowerPrice;
    buyPrice = _.ceil(sellPrice / (1 + interest), PRICE_FILTER.precision);

    if (currentPrice < sellPrice) {
      openTrades.delete(slot);
      return;
    }

    if (openOrders.hasPrice(buyPrice)) {
      openTrades.delete(slot);
      return;
    }

    if (buyPrice === sellPrice) {
      console.error("buyPrice === sellPrice");
      openTrades.delete(slot);
      return;
    }

    baseToSell = _.ceil(notional / sellPrice / (1 - interest) / (1 - account.data.commissionRates.taker), LOT_SIZE.precision);

    sellNotional = sellPrice * baseToSell;

    if (account.data.balances[baseAsset] === undefined || account.data.balances[baseAsset].free * sellPrice < sellNotional) {
      console.error("No SELL balance to trade.");
      openTrades.delete(slot);
      return;
    }

    sellNotionalAvailable = sellNotional * (1 - account.data.commissionRates.taker);

    if (earn === "base") {
      baseToBuy = _.floor(sellNotionalAvailable / buyPrice, LOT_SIZE.precision);
    } else if (earn === "quote") {
      baseToBuy = _.ceil(baseToSell / (1 - account.data.commissionRates.maker), LOT_SIZE.precision);
    }

    baseAvailable = baseToBuy * (1 - account.data.commissionRates.maker);

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
      if (openOrders.hasPrice(sellPrice)) {
        openTrades.delete(slot);
        return;
      }

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

        if (sellOrder.data.status === "NEW") {
          openOrders = (await binance.openOrders(baseAsset, quoteAsset));
          openTrades.delete(slot);
        };


      } else if (buyOrder.data.status === "EXPIRED") openTrades.delete(slot);
    } else if (side === "sell") {
      if (openOrders.hasPrice(buyPrice)) {
        openTrades.delete(slot);
        return;
      }

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

        if (buyOrder.data.status === "NEW") {
          openOrders = (await binance.openOrders(baseAsset, quoteAsset));
          openTrades.delete(slot);
        }

      } else if (sellOrder.data.status === "EXPIRED") openTrades.delete(slot);
    }
  } catch (error) {
    console.error(error.response.data || error);
    process.exit(0);
  }
};

process.on("SIGINT", () => {
  kill = true;
});
