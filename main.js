import { watchFile, readFileSync } from "fs";
import _ from "lodash";
import WebSocket from "ws";
import * as binance from "./modules/binance.js";

const CONFIG_FILE_NAME = "config.json";
let account;
let openOrders;
let exchangeInfo;
const openTradesMap = new Map();
let ws_api, ws_stream, ws_user_data_stream, ws_bookTicker;
let configDataJSON, configDataMap;
let list_subscriptions;

try {
  configDataJSON = JSON.parse(readFileSync(CONFIG_FILE_NAME, "utf8"));
  configDataMap = Map.groupBy(configDataJSON.symbols, ({ name }) => name);
} catch (error) {
  console.error("File not found or empty!");
}

watchFile(CONFIG_FILE_NAME, {
  // Passing the options parameter
  bigint: false,
  persistent: true,
  interval: 1000,
}, (curr, prev) => {
  try {
    configDataJSON = JSON.parse(readFileSync(CONFIG_FILE_NAME, "utf8"));
    configDataMap = Map.groupBy(configDataJSON.symbols, ({ name }) => name);

    ws_stream.send(
      JSON.stringify({
        method: "UNSUBSCRIBE",
        params: list_subscriptions,
        id: "UNSUBSCRIBE"
      })
    );

    ws_stream.send(
      JSON.stringify({
        method: "SUBSCRIBE",
        params: configDataJSON.symbols.filter(symbol => symbol.active === true).map(symbol => `${symbol.name.toLowerCase()}@aggTrade`),
        id: "SUBSCRIBE",
      })
    );
  } catch (error) {
    console.error("File not found or empty!");
  }
});

const start_ws_api = () => {
  ws_api ??= new WebSocket(binance.WEBSOCKET_API);

  ws_api.on("error", error => console.error(error.message));

  ws_api.on("open", () => {
    console.log(`ws_api => open`);

    binance.getExchangeInfo(ws_api);
    binance.sessionLogon(ws_api);
  });

  ws_api.on("close", () => {
    console.log(`ws_api => close`);
    ws_api = null;
    setTimeout(start_ws_api, 5000);
  });

  ws_api.on("ping", data => {
    ws_api.pong(data);
  });

  ws_api.on("message", data => {
    data = JSON.parse(data);
    let listenKey;

    switch (data.id) {
      case "userDataStream_start":
        listenKey = data.result.listenKey;
        start_ws_user_data_stream(listenKey);

        setInterval(() => {
          ws_api.send(JSON.stringify({
            id: "userDataStream_ping",
            method: "userDataStream.ping",
            params: {
              listenKey: listenKey,
              apiKey: binance.API_KEY
            }
          }));
        }, 30 * 60 * 1000);

        break;
      case "userDataStream_ping":
        //
        break;
      case "userDataStream_stop":
        ws_api.terminate();
        break;
      case 'account_status':
        account = data;
        break;
      case 'openOrders_status':
        openOrders = { ...data };
        break;
      case 'exchangeInfo':
        exchangeInfo = data;
        binance.getAccount(ws_api);
        binance.getOpenOrders(ws_api);
        start_ws_stream();
        binance.startUserDataStream(ws_api);

        break;
    }
  });
};

start_ws_api();

const start_ws_stream = () => {
  // WEBSOCKET MARKET DATA STREAM
  ws_stream ??= new WebSocket(`${binance.WEBSOCKET_STREAM}/ws`);

  ws_stream.on("error", error => console.error(error.message));

  ws_stream.on("open", () => {
    console.log(`ws_stream => open`);

    if (configDataJSON.symbols.length > 0)
      ws_stream.send(
        JSON.stringify({
          method: "SUBSCRIBE",
          params: configDataJSON.symbols.filter(symbol => symbol.active === true).map(symbol => `${symbol.name.toLowerCase()}@aggTrade`),
          id: "SUBSCRIBE",
        })
      );
  });

  ws_stream.on("close", () => {
    console.log(`ws_stream => close`);

    ws_stream = null;
    setTimeout(start_ws_stream, 5000);
  });

  ws_stream.on("ping", data => {
    ws_stream.pong(data);
  });

  ws_stream.on("message", async data => {
    data = JSON.parse(data);

    switch (data.id) {
      case "SUBSCRIBE": // Subscribe to a stream
        console.log(data);

        ws_stream.send(JSON.stringify({
          "method": "LIST_SUBSCRIPTIONS",
          "id": "UPDATE_LIST_SUBSCRIPTIONS"
        }));
        break;
      case "UNSUBSCRIBE": // Unsubscribe to a stream
        console.log(data);
        break;
      case "UNSUBSCRIBE_AND_EXIT":
        console.log(data);
        process.exit(0);
        break;
      case "UPDATE_LIST_SUBSCRIPTIONS": // List subscriptions
        console.log(data);
        list_subscriptions = data.result;
        break;
    }

    switch (data.e) {
      case "aggTrade":
        const slot = binance.priceToSlot(data.p, configDataMap.get(data.s)[0].grid);

        if (!openTradesMap.has(data.s)) openTradesMap.set(data.s, new Set());

        if (!openTradesMap.get(data.s).has(slot)) {
          openTradesMap.get(data.s).add(slot);
          openTradesMap.get(data.s).delete(await trade(data, configDataMap.get(data.s)[0], slot));
        }

        break;
    }
  });
};

const start_ws_user_data_stream = listenKey => {
  // WEBSOCKET USER DATA STREAM
  ws_user_data_stream ??= new WebSocket(`${binance.WEBSOCKET_STREAM}/ws/${listenKey}`);

  ws_user_data_stream.on("error", error => console.error(error.message));

  ws_user_data_stream.on("open", () => {
    console.log(`ws_user_data_stream => open`);
  });

  ws_user_data_stream.on("close", () => {
    console.log(`ws_user_data_stream => close`);

    ws_user_data_stream = null;
    setTimeout(start_ws_user_data_stream, 5000, listenKey);
  });

  ws_user_data_stream.on("ping", data => {
    ws_user_data_stream.pong(data);
  });

  ws_user_data_stream.on("message", data => {
    data = JSON.parse(data);

    switch (data.e) {
      case "outboundAccountPosition":
        // Account Update

        data.B.forEach(element => {
          const balance = account.result.balances.find(balance => balance.asset === element.a);

          if (!balance) return;

          balance.free = element.f;
          balance.locked = element.l;
        });

        break;
      case "balanceUpdate":
        // Balance Update

        break;
      case "executionReport":
        // Order Update
        binance.printExecutedOrder(data);

        const index = openOrders.result.findIndex(openOrder => (openOrder.orderId === data.i) && (data.X === "FILLED"));
        if (index > -1) openOrders.result.splice(index, 1);
        break;
    }
  });
};

const trade = async ({ s: symbol, p: price }, symbolData, slot) => {
  let baseToBuy;
  let baseAvailable;
  let baseToSell;
  let buyNotional;
  let sellNotional;
  let sellNotionalAvailable;
  let buyPrice;
  let sellPrice;

  const exchangeInfoSymbol = exchangeInfo.result.symbols.find(element => element.symbol === symbol);

  const baseAsset = exchangeInfoSymbol.baseAsset;
  const quoteAsset = exchangeInfoSymbol.quoteAsset;

  const filters = exchangeInfoSymbol.filters;

  const PRICE_FILTER = filters.find(filter => filter.filterType === "PRICE_FILTER");
  const LOT_SIZE = filters.find(filter => filter.filterType === "LOT_SIZE");
  const NOTIONAL = filters.find(filter => filter.filterType === "NOTIONAL");

  const pricePrecision = Math.round(-Math.log10(PRICE_FILTER.tickSize));
  const lotSizePrecision = Math.round(-Math.log10(LOT_SIZE.stepSize));
  const notional = Math.max(symbolData.notional, NOTIONAL.minNotional);

  const baseBalance = account.result.balances.find(element => element.asset === baseAsset);
  const quoteBalance = account.result.balances.find(element => element.asset === quoteAsset);

  if (symbolData.side === "buy") {
    buyPrice = binance.getHigherPrice(price, configDataMap.get(symbol)[0].grid, pricePrecision);
    sellPrice = _.floor(buyPrice * (1 + symbolData.interest), pricePrecision);

    if (binance.hasPrice(openOrders, symbol, sellPrice) > -1) return slot;

    if (price > buyPrice) {
      console.log(`${new Date().toLocaleString()} - ${symbol}: price > buyPrice`);
      return slot;
    }

    if (buyPrice === sellPrice) {
      console.error(`${new Date().toLocaleString()} - ${symbol}: buyPrice === sellPrice`);
      return slot;
    }

    baseToBuy = _.ceil(notional / buyPrice, lotSizePrecision);
    baseAvailable = baseToBuy * (1 - account.result.commissionRates.taker);

    buyNotional = buyPrice * baseToBuy;

    if (quoteBalance && quoteBalance.free < buyNotional) {
      console.error(`${new Date().toLocaleString()} - ${symbol}: No BUY balance to trade.`);
      return slot;
    }

    if (symbolData.earn === "base") {
      baseToSell = _.ceil(buyNotional / sellPrice / (1 - account.result.commissionRates.maker), lotSizePrecision);
    } else if (symbolData.earn === "quote") {
      baseToSell = _.floor(baseAvailable, lotSizePrecision);
    }

    if (baseAvailable - baseToSell < 0) {
      console.error(`${new Date().toLocaleString()} - ${symbol}: baseAvailable - baseToSell < 0`);
      return slot;
    }

    sellNotional = sellPrice * baseToSell;
    sellNotionalAvailable = sellNotional * (1 - account.result.commissionRates.maker);

    if (sellNotionalAvailable - buyNotional < 0) {
      console.error(`${new Date().toLocaleString()} - ${symbol}: sellNotionalAvailable - buyNotional < 0`);
      return slot;
    }

    // BUY ORDER
    try {
      const buyOrder = await binance.order({
        symbol: symbol,
        side: "BUY",
        type: "LIMIT",
        timeInForce: "FOK",
        quantity: baseToBuy,
        price: buyPrice,
      });

      if (buyOrder.data.status === "EXPIRED") {
        return slot;
      };

      // SELL ORDER
      if (buyOrder.data.status === "FILLED") {

        const sellOrder = await binance.order({
          symbol: symbol,
          side: "SELL",
          type: "LIMIT",
          timeInForce: "GTC",
          quantity: baseToSell,
          price: sellPrice,
        });

        if (sellOrder.data.status === "NEW") {
          openOrders.result.push(sellOrder.data);
          return slot;
        };
      }
    } catch (error) {
      console.error(error.response.data);
    }
  }

  if (symbolData.side === "sell") {
    sellPrice = binance.getLowerPrice(price, configDataMap.get(symbol)[0].grid, pricePrecision);
    buyPrice = _.ceil(sellPrice / (1 + symbolData.interest), pricePrecision);

    if (binance.hasPrice(openOrders, symbol, buyPrice) > -1) return slot;

    if (price < sellPrice) {
      console.log(`${new Date().toLocaleString()} - ${symbol}: price < sellPrice`);
      return slot;
    }

    if (buyPrice === sellPrice) {
      console.error(`${new Date().toLocaleString()} - ${symbol}: buyPrice === sellPrice`);
      return slot;
    }

    baseToSell = _.ceil(notional / sellPrice / (1 - symbolData.interest) / (1 - account.result.commissionRates.taker), lotSizePrecision);

    sellNotional = sellPrice * baseToSell;

    if (baseBalance && baseBalance.free * sellPrice < sellNotional) {
      console.error(`${new Date().toLocaleString()} - ${symbol}: No SELL balance to trade.`);
      return slot;
    }

    sellNotionalAvailable = sellNotional * (1 - account.result.commissionRates.taker);

    if (symbolData.earn === "base") {
      baseToBuy = _.floor(sellNotionalAvailable / buyPrice, lotSizePrecision);
    } else if (symbolData.earn === "quote") {
      baseToBuy = _.ceil(baseToSell / (1 - account.result.commissionRates.maker), lotSizePrecision);
    }

    baseAvailable = baseToBuy * (1 - account.result.commissionRates.maker);

    if (baseAvailable - baseToSell < 0) {
      console.error(`${new Date().toLocaleString()} - ${symbol}: baseAvailable - baseToSell < 0`);
      return slot;
    }

    buyNotional = buyPrice * baseToBuy;

    if (sellNotionalAvailable - buyNotional < 0) {
      console.error(`${new Date().toLocaleString()} - ${symbol}: sellNotionalAvailable - buyNotional < 0`);
      return slot;
    }

    // SELL ORDER
    try {
      const sellOrder = await binance.order({
        symbol: symbol,
        side: "SELL",
        type: "LIMIT",
        timeInForce: "FOK",
        quantity: baseToSell,
        price: sellPrice,
      });

      if (sellOrder.data.status === "EXPIRED") {
        return slot;
      };

      // BUY ORDER
      if (sellOrder.data.status === "FILLED") {

        const buyOrder = await binance.order({
          symbol: symbol,
          side: "BUY",
          type: "LIMIT",
          timeInForce: "GTC",
          quantity: baseToBuy,
          price: buyPrice,
        });

        if (buyOrder.data.status === "NEW") {
          openOrders.result.push(buyOrder.data);
          return slot;
        };
      }
    } catch (error) {
      console.error(error.response.data);
    }

  }
};

process.on("SIGINT", () => {
  ws_stream.send(
    JSON.stringify({
      method: "UNSUBSCRIBE",
      params: configDataJSON.symbols.filter(symbol => symbol.active === true).map(symbol => `${symbol.name.toLowerCase()}@aggTrade`),
      id: "UNSUBSCRIBE_AND_EXIT"
    }));
});

process.setUncaughtExceptionCaptureCallback(e => {
  console.error("Uncaught exception:", e);
});
