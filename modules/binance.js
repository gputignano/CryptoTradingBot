import crypto from "crypto";
import axios from "axios";
import path from "path";
import _ from "lodash";
import * as dotenv from "dotenv";

const NODE_ENV = process.env.NODE_ENV || "development";

dotenv.config({
  path: path.resolve(process.cwd(), `.env.${NODE_ENV}`)
});

console.log(`${NODE_ENV} mode.`);

export const { API_BASE_URL, WS_MARKET_DATA_STREAM, API_KEY, API_SECRET } = process.env;

const CONFIGS = {
  headers: {
    "X-MBX-APIKEY": API_KEY,
  },
};

const signature = query_string => crypto.createHmac("sha256", API_SECRET).update(query_string).digest("hex");

export const ping = () => axios.get(`${API_BASE_URL}/api/v3/ping`);

const getExchangeInfo = (baseAsset, quoteAsset) => axios.get(`${API_BASE_URL}/api/v3/exchangeInfo?symbol=${baseAsset}${quoteAsset}`);

export const getExchangeInfoFilters = async (baseAsset, quoteAsset) => {
  const exchangeInfo = await getExchangeInfo(baseAsset, quoteAsset);
  const [
    PRICE_FILTER, // filterType, minPrice, maxPrice, tickSize
    LOT_SIZE, // filterType, minQty, maxQty, stepSize
    ICEBERG_PARTS, // filterType, limit
    MARKET_LOT_SIZE, // filterType, minQty, maxQty, stepSize
    TRAILING_DELTA, // minTrailingAboveDelta, maxTrailingAboveDelta, minTrailingBelowDelta, maxTrailingBelowDelta
    PERCENT_PRICE_BY_SIDE, // bidMultiplierUp, bidMultiplierDown, askMultiplierUp, askMultiplierDown, avgPriceMins
    NOTIONAL, // filterType, minNotional, applyMinToMarket, maxNotional, applyMaxToMarket, avgPriceMins
    MAX_NUM_ORDERS, // filterType, maxNumOrders
    MAX_NUM_ALGO_ORDERS, // filterType, maxNumAlgoOrders
  ] = exchangeInfo.data.symbols[0].filters;

  PRICE_FILTER.precision = Math.round(-Math.log10(PRICE_FILTER.tickSize));
  LOT_SIZE.precision = Math.round(-Math.log10(LOT_SIZE.stepSize));

  return [PRICE_FILTER, LOT_SIZE, ICEBERG_PARTS, MARKET_LOT_SIZE, TRAILING_DELTA, PERCENT_PRICE_BY_SIDE, NOTIONAL, MAX_NUM_ORDERS, MAX_NUM_ALGO_ORDERS];
};

export const account = (baseAsset, quoteAsset) => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ timestamp });
  const query_string = query.toString();
  const instance = axios.create({});

  instance.interceptors.response.use(response => {
    // DIVIDE ACCOUNT MAKER/TAKER COMMISSION BY 10000
    response.data.makerCommission /= 10000;
    response.data.takerCommission /= 10000;

    // FILTER ONLY BALANCES FOR BASE/QUOTE ASSETS
    const filtered = response.data.balances.filter(element => {
      return element.asset === baseAsset || element.asset === quoteAsset;
    });

    // EMPTY BALANCES
    response.data.balances = {};

    // FROM ARRAY TO OBJECT
    filtered.forEach(element => {
      response.data.balances[element.asset] = element;
    });

    return response;
  });

  return instance.get(`${API_BASE_URL}/api/v3/account?${query_string}&signature=${signature(query_string)}`, CONFIGS);
};

export const openOrders = (baseAsset, quoteAsset) => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ symbol: baseAsset + quoteAsset, timestamp });
  const query_string = query.toString();

  return axios.get(`${API_BASE_URL}/api/v3/openOrders?${query_string}&signature=${signature(query_string)}`, CONFIGS);
};

export const tickerPrice = (baseAsset, quoteAsset) => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ symbol: baseAsset + quoteAsset });
  const query_string = query.toString();

  return axios.get(`${API_BASE_URL}/api/v3/ticker/price?${query}`);
};

export const order = params => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp });
  const query_string = query.toString();

  return axios.post(`${API_BASE_URL}/api/v3/order?${query_string}&signature=${signature(query_string)}`, null, CONFIGS);
};

export const cancelOrder = params => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp });
  const query_string = query.toString();

  return axios.delete(`${API_BASE_URL}/api/v3/order?${query_string}&signature=${signature(query_string)}`, CONFIGS);
};

export const priceToSlot = (price, grid) => Math.floor(Math.log10(price) / Math.log10(1 + grid / 100));

const slotToPrice = (slot, grid) => Math.pow(1 + grid / 100, slot);

export const getOpenOrders = (orders, precision) => {
  const openOrders = new Set();

  orders.forEach(order => openOrders.add(_.round(order.price, precision)));

  return openOrders;
};

export const getLowerPrice = (price, grid, precision) => _.ceil(slotToPrice(priceToSlot(price, grid), grid), precision);

export const getHigherPrice = (price, grid, precision) => _.floor(slotToPrice(priceToSlot(price, grid) + 1, grid), precision);

export const postApiV3UserDataStream = async () => {
  const response = await axios.post(`https://api.binance.com/api/v3/userDataStream`, null, CONFIGS);
  // if (response.status === 200) {
  //   console.log(new Date);
  //   console.log(response.data);
  // };
  return response;
};

export const putApiV3UserDataStream = async listenKey => {
  const response = await axios.put(`https://api.binance.com/api/v3/userDataStream?listenKey=${listenKey}`, null, CONFIGS);
  // if (response.status === 200) {
  //   console.log(new Date);
  //   console.log(response.data);
  // };
  return response;
};

export const deleteApiV3UserDataStream = async () => (await axios.delete(`https://api.binance.com/api/v3/userDataStream?listenKey=${listenKey}`, CONFIGS));
