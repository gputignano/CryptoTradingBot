import crypto from "crypto";
import fs from "fs";
import axios from "axios";
import path from "path";
import _ from "lodash";
import * as dotenv from "dotenv";

const NODE_ENV = process.env.NODE_ENV || "development";

dotenv.config({
  path: path.resolve(process.cwd(), `.env.${NODE_ENV}`)
});

console.log(`${NODE_ENV} mode.`);

export const { API_ENDPOINT, WEBSOCKET_STREAM, WEBSOCKET_API, API_KEY } = process.env;

const CONFIGS = {
  headers: {
    "X-MBX-APIKEY": API_KEY,
  },
};

const PRIVATE_KEY = fs.readFileSync(`./${NODE_ENV}_private_key.pem`, { encoding: "utf8" });

export const signature = query_string => crypto.sign(null, Buffer.from(query_string), {
  key: PRIVATE_KEY,
  padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
  saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
}).toString('base64');

export const order = params => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp });
  const query_string = query.toString();

  return axios.post(`${API_ENDPOINT}/v3/order?${query_string}&signature=${signature(query_string)}`, null, CONFIGS);
};

export const orderListOto = params => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp });
  const query_string = query.toString();

  return axios.post(`${API_ENDPOINT}/v3/orderList/oto?${query_string}&signature=${signature(query_string)}`, null, CONFIGS);
};

export const cancelOrder = params => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp });
  const query_string = query.toString();

  return axios.delete(`${API_ENDPOINT}/v3/order?${query_string}&signature=${signature(query_string)}`, CONFIGS);
};

export const priceToSlot = (price, grid) => Math.floor(Math.log10(price) / Math.log10(1 + grid / 100));

const slotToPrice = (slot, grid) => Math.pow(1 + grid / 100, slot);

export const getLowerPrice = (price, grid, precision) => _.ceil(slotToPrice(priceToSlot(price, grid), grid), precision);

export const getHigherPrice = (price, grid, precision) => _.floor(slotToPrice(priceToSlot(price, grid) + 1, grid), precision);

export const printExecutedOrder = order => console.log(`${new Date(order.E).toLocaleString()} ${order.s} ${order.X} ${order.o} ${order.f} ${order.S} ${order.q} at ${order.p}`);

export const getAccount = ws => {
  const params = {
    timestamp: Date.now()
  };
  const searchParams = new URLSearchParams({ ...params });
  searchParams.sort();

  ws.send(JSON.stringify({
    id: "account_status",
    method: "account.status",
    params: Object.fromEntries(searchParams)
  }));
};

export const getOpenOrders = ws => {
  const params = {
    timestamp: Date.now()
  };
  const searchParams = new URLSearchParams({ ...params });
  searchParams.sort();

  ws.send(JSON.stringify({
    id: "openOrders_status",
    method: "openOrders.status",
    params: Object.fromEntries(searchParams)
  }));
};

export const getExchangeInfo = ws => {
  const params = {};
  const searchParams = new URLSearchParams({ ...params });
  searchParams.sort();

  ws.send(JSON.stringify({
    id: "exchangeInfo",
    method: "exchangeInfo",
    params: Object.fromEntries(searchParams)
  }));
};

export const startUserDataStream = ws => {
  const params = {
    apiKey: API_KEY
  };
  const searchParams = new URLSearchParams({ ...params });
  searchParams.sort();

  ws.send(JSON.stringify({
    id: "userDataStream_start",
    method: "userDataStream.start",
    params: Object.fromEntries(searchParams)
  }));
};

export const sessionLogon = ws => {
  const params = {
    apiKey: API_KEY,
    timestamp: Date.now()
  };
  const searchParams = new URLSearchParams({ ...params });
  searchParams.sort();
  searchParams.append("signature", signature(searchParams.toString()));

  ws.send(JSON.stringify({
    id: "session_logon",
    method: "session.logon",
    params: Object.fromEntries(searchParams)
  }));
};

export const hasPrice = (openOrders, symbol, price) => openOrders.result.findIndex(openOrder => openOrder.symbol === symbol && parseFloat(openOrder.price) === price);
