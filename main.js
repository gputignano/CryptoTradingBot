import _ from "lodash";
import WebSocket from "ws";
import { symbol, side, grid, earn, interest, minNotional } from "./modules/argv.js";
import * as binance from "./modules/binance.js";

let account;
let openOrders;
let exchangeInfo;
let bookTicker;
const openTradesMap = new Map();
let ws_api, ws_stream, ws_user_data_stream, ws_bookTicker;

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
        openOrders.hasPrice = (symbol, price) => openOrders.result.findIndex(openOrder => openOrder.symbol === symbol && parseFloat(openOrder.price) === price);
        openOrders.result.forEach(openOrder => openOrder.slot = binance.priceToSlot(openOrder.price, grid));
        break;
      case 'exchangeInfo':
        exchangeInfo = data;
        binance.getAccount(ws_api);
        binance.getOpenOrders(ws_api);
        start_ws_stream();
        start_ws_bookTicker();
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

    ws_stream.send(
      JSON.stringify({
        method: "SUBSCRIBE",
        params: [symbol.toLowerCase() + "@aggTrade"],
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
        break;
      case "UNSUBSCRIBE": // Unsubscribe to a stream
        console.log(data);

        setTimeout(() => process.exit(0), 5000);
        break;
      case "LIST_SUBSCRIPTIONS": // List subscriptions
        console.log(data);

        if (data.result.length > 0)
          ws_stream.send(JSON.stringify({
            method: "UNSUBSCRIBE",
            params: data.result,
            id: "UNSUBSCRIBE"
          }));
        break;
    }

    switch (data.e) {
      case "aggTrade":
        const slot = binance.priceToSlot(data.p, grid);

        if (!openTradesMap.has(data.s)) openTradesMap.set(data.s, new Set());

        if (!openTradesMap.get(data.s).has(slot)) {
          openTradesMap.get(data.s).add(slot);
          openTradesMap.get(data.s).delete(await trade(data, slot));
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

        const index = openOrders.result.findIndex(openOrder => (openOrder.orderId === data.i) && (data.X === "FILLED"));
        if (index > -1) openOrders.result.splice(index, 1);
        break;
    }
  });
};

const start_ws_bookTicker = () => {
  // WEBSOCKET BOOKTICKER DATA STREAM
  ws_bookTicker ??= new WebSocket(`${binance.WEBSOCKET_STREAM}/ws`);

  ws_bookTicker.on("error", error => console.error(error.message));

  ws_bookTicker.on("open", () => {
    console.log(`ws_bookTicker => open`);

    ws_bookTicker.send(
      JSON.stringify({
        method: "SUBSCRIBE",
        params: [symbol.toLowerCase() + "@bookTicker"],
        id: "SUBSCRIBE",
      })
    );
  });

  ws_bookTicker.on("close", () => {
    console.log(`ws_bookTicker => close`);
    ws_bookTicker = null;
    setTimeout(start_ws_bookTicker, 5000);
  });

  ws_bookTicker.on("ping", data => {
    ws_bookTicker.pong(data);
  });

  ws_bookTicker.on("message", async data => {
    data = JSON.parse(data);

    bookTicker = data;
  });
};

const trade = async ({ s: symbol, p: price }, slot) => {
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
  const notional = Math.max(minNotional, NOTIONAL.minNotional);

  const baseBalance = account.result.balances.find(element => element.asset === baseAsset);
  const quoteBalance = account.result.balances.find(element => element.asset === quoteAsset);

  if (side === "buy") {
    buyPrice = binance.getHigherPrice(price, grid, pricePrecision);
    if (buyPrice < bookTicker.a) return slot;
    sellPrice = _.floor(buyPrice * (1 + interest), pricePrecision);

    if (openOrders.hasPrice(symbol, sellPrice) > -1) return slot;

    if (price > buyPrice) {
      console.log("price > buyPrice");
      return slot;
    }

    if (buyPrice === sellPrice) {
      console.error("buyPrice === sellPrice");
      return slot;
    }

    baseToBuy = _.ceil(notional / buyPrice, lotSizePrecision);
    baseAvailable = baseToBuy * (1 - account.result.commissionRates.taker);

    buyNotional = buyPrice * baseToBuy;

    if (quoteBalance && quoteBalance.free < buyNotional) {
      console.error("No BUY balance to trade.");
      return slot;
    }

    if (earn === "base") {
      baseToSell = _.ceil(buyNotional / sellPrice / (1 - account.result.commissionRates.maker), lotSizePrecision);
    } else if (earn === "quote") {
      baseToSell = _.floor(baseAvailable, lotSizePrecision);
    }

    if (baseAvailable - baseToSell < 0) {
      console.error("baseAvailable - baseToSell < 0");
      return slot;
    }

    sellNotional = sellPrice * baseToSell;
    sellNotionalAvailable = sellNotional * (1 - account.result.commissionRates.maker);

    if (sellNotionalAvailable - buyNotional < 0) {
      console.error("sellNotionalAvailable - buyNotional < 0");
      return slot;
    }

    // BUY ORDER
    const buyOrder = await binance.order({
      symbol: symbol,
      side: "BUY",
      type: "LIMIT",
      timeInForce: "FOK",
      quantity: baseToBuy,
      price: buyPrice,
    });

    if (buyOrder.data.status === "EXPIRED") {
      binance.printExecutedOrder(buyOrder.data);
      return slot;
    };

    binance.printExecutedOrder(buyOrder.data);

    // SELL ORDER
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
      binance.printExecutedOrder(sellOrder.data);
      return slot;
    };

  }

  if (side === "sell") {
    sellPrice = binance.getLowerPrice(price, grid, pricePrecision);
    if (sellPrice > bookTicker.b) return slot;
    buyPrice = _.ceil(sellPrice / (1 + interest), pricePrecision);

    if (openOrders.hasPrice(symbol, buyPrice) > -1) return slot;

    if (price < sellPrice) {
      console.log("price < sellPrice");
      return slot;
    }

    if (buyPrice === sellPrice) {
      console.error("buyPrice === sellPrice");
      return slot;
    }

    baseToSell = _.ceil(notional / sellPrice / (1 - interest) / (1 - account.result.commissionRates.taker), lotSizePrecision);

    sellNotional = sellPrice * baseToSell;

    if (baseBalance && baseBalance.free * sellPrice < sellNotional) {
      console.error("No SELL balance to trade.");
      return slot;
    }

    sellNotionalAvailable = sellNotional * (1 - account.result.commissionRates.taker);

    if (earn === "base") {
      baseToBuy = _.floor(sellNotionalAvailable / buyPrice, lotSizePrecision);
    } else if (earn === "quote") {
      baseToBuy = _.ceil(baseToSell / (1 - account.result.commissionRates.maker), lotSizePrecision);
    }

    baseAvailable = baseToBuy * (1 - account.result.commissionRates.maker);

    if (baseAvailable - baseToSell < 0) {
      console.error("baseAvailable - baseToSell < 0");
      return slot;
    }

    buyNotional = buyPrice * baseToBuy;

    if (sellNotionalAvailable - buyNotional < 0) {
      console.error("sellNotionalAvailable - buyNotional < 0");
      return slot;
    }

    // SELL ORDER
    const sellOrder = await binance.order({
      symbol: symbol,
      side: "SELL",
      type: "LIMIT",
      timeInForce: "FOK",
      quantity: baseToSell,
      price: sellPrice,
    });

    if (sellOrder.data.status === "EXPIRED") {
      binance.printExecutedOrder(sellOrder.data);
      return slot;
    };

    binance.printExecutedOrder(sellOrder.data);

    // BUY ORDER
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
      binance.printExecutedOrder(buyOrder.data);
      return slot;
    };

  }
};

process.on("SIGINT", () => {
  if (!ws_stream) process.exit(0);

  ws_stream.send(JSON.stringify({
    method: "LIST_SUBSCRIPTIONS",
    id: "LIST_SUBSCRIPTIONS"
  }));

  ws_bookTicker.send(
    JSON.stringify({
      method: "UNSUBSCRIBE",
      params: [symbol.toLowerCase() + "@bookTicker"],
      id: "UNSUBSCRIBE",
    })
  );
});

process.setUncaughtExceptionCaptureCallback(e => {
  console.error("Uncaught exception:", e);
});
