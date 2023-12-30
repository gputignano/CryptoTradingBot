import _ from "lodash";
import WebSocket from "ws";
import { symbol, side, grid, earn, interest, minNotional } from "./modules/argv.js";
import * as binance from "./modules/binance.js";

let account;
let openOrders;
let exchangeInfo, exchangeInfoMap = new Map();
const openTrades = new Set();
let ws_api, ws_stream, ws_user_data_stream;

const start_ws_api = (() => {
  ws_api ??= new WebSocket(binance.WEBSOCKET_API);

  ws_api.on("error", error => console.error(error.message));

  ws_api.on("open", () => {
    console.log(`ws_api => open`);

    getExchangeInfo();
  });

  ws_api.on("close", () => {
    console.log(`ws_api => close`);
    ws_api = null;
    setImmediate(start_ws_api);
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
        account = { ...data };
        const balancesMap = new Map();
        account.result.balances.forEach(balance => {
          balancesMap.set(balance.asset, balance);
        });
        account.result.balances = balancesMap;
        break;
      case 'openOrders_status':
        openOrders = { ...data };
        openOrders.hasPrice = (symbol, price) => openOrders.result.findIndex(openOrder => openOrder.symbol === symbol && parseFloat(openOrder.price) === price);
        openOrders.result.forEach(openOrder => openOrder.slot = binance.priceToSlot(openOrder.price, grid));
        break;
      case 'exchangeInfo':
        exchangeInfo = { ...data };

        exchangeInfoMap = binance.getExchangeInfoMap(data);

        getAccount();
        getOpenOrders();
        start_ws_stream();
        startUserDataStream();

        break;
    }
  });
})();

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
        id: 1,
      })
    );
  });

  ws_stream.on("close", () => {
    console.log(`ws_stream => close`);
    ws_stream = null;
    setImmediate(start_ws_stream);
  });

  ws_stream.on("ping", data => {
    ws_stream.pong(data);
  });

  ws_stream.on("message", async data => {
    data = JSON.parse(data);

    switch (data.id) {
      case 1: // Subscribe to a stream
        console.log(data);
        break;
      case 2: // Unsubscribe to a stream
        console.log(data);

        setTimeout(() => process.exit(0), 5000);
        break;
      case 3: // List subscriptions
        console.log(data);

        ws_stream.send(JSON.stringify({
          method: "UNSUBSCRIBE",
          params: data.result,
          id: 2
        }));
        break;
    }

    switch (data.e) {
      case "aggTrade":
        const slot = binance.priceToSlot(data.p, grid);

        if (!openTrades.has(slot)) {
          openTrades.add(slot);
          openTrades.delete(await trade(data, slot));
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
    setImmediate(start_ws_user_data_stream);
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
          if (!account.result.balances.has(element.a)) return;

          account.result.balances.set(element.a, {
            free: element.f,
            locked: element.l
          });
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

const trade = async ({ s: symbol, p: price }, slot) => {
  let baseToBuy;
  let baseAvailable;
  let baseToSell;
  let buyNotional;
  let sellNotional;
  let sellNotionalAvailable;
  let buyPrice;
  let sellPrice;

  const index = exchangeInfo.result.symbols.findIndex(s => s.symbol === symbol);

  const { baseAsset, quoteAsset } = exchangeInfo.result.symbols[index];

  const pricePrecision = exchangeInfoMap.get(symbol).get("filters").get("PRICE_FILTER").precision;

  const lotSizePrecision = exchangeInfoMap.get(symbol).get("filters").get("LOT_SIZE").precision;

  const notional = Math.max(minNotional || exchangeInfoMap.get(symbol).get("filters").get("NOTIONAL").minNotional, exchangeInfoMap.get(symbol).get("filters").get("NOTIONAL").minNotional);

  if (side === "buy") {
    buyPrice = binance.getHigherPrice(price, grid, pricePrecision);;
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

    if (!account.result.balances.has(quoteAsset) || account.result.balances.get(quoteAsset).free < buyNotional) {
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
    sellPrice = binance.getLowerPrice(price, grid, pricePrecision);;
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

    if (!account.result.balances.has(baseAsset) || account.result.balances.get(baseAsset).free * sellPrice < sellNotional) {
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

const getAccount = () => {
  const params = {
    apiKey: binance.API_KEY,
    timestamp: Date.now()
  };
  const searchParams = new URLSearchParams({ ...params });
  searchParams.sort();
  const signature = binance.signature(searchParams.toString());
  searchParams.append("signature", signature);

  ws_api.send(JSON.stringify({
    id: "account_status",
    method: "account.status",
    params: Object.fromEntries(searchParams)
  }));
};

const getOpenOrders = () => {
  const params = {
    apiKey: binance.API_KEY,
    timestamp: Date.now()
  };
  const searchParams = new URLSearchParams({ ...params });
  searchParams.sort();
  const signature = binance.signature(searchParams.toString());
  searchParams.append("signature", signature);

  ws_api.send(JSON.stringify({
    id: "openOrders_status",
    method: "openOrders.status",
    params: Object.fromEntries(searchParams)
  }));
};

const getExchangeInfo = () => {
  const params = {};
  const searchParams = new URLSearchParams({ ...params });
  searchParams.sort();

  ws_api.send(JSON.stringify({
    id: "exchangeInfo",
    method: "exchangeInfo",
    params: Object.fromEntries(searchParams)
  }));
};

const startUserDataStream = () => {
  const params = {
    apiKey: binance.API_KEY
  };
  const searchParams = new URLSearchParams({ ...params });
  searchParams.sort();

  ws_api.send(JSON.stringify({
    id: "userDataStream_start",
    method: "userDataStream.start",
    params: Object.fromEntries(searchParams)
  }));
};

process.on("SIGINT", () => {
  ws_stream.send(JSON.stringify({
    method: "LIST_SUBSCRIPTIONS",
    id: 3
  }));
});
