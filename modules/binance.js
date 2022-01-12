const crypto = require("crypto");
const axios = require("axios");
const _ = require("lodash");

const url = process.env.SPOT_API_URL;
// const query = `symbol=${global.baseAsset}${global.quoteAsset}&timestamp=${Date.now()}`;
// module.exports.url = `${url}${endPoint}?${query}&signature=${signature(query)}`;

let headers = {
  headers: {
    "X-MBX-APIKEY": process.env.API_KEY,
  },
};

signature = query_string => {
  return crypto.createHmac("sha256", process.env.API_SECRET).update(query_string).digest("hex");
};

module.exports.ping = () => {
  return axios.get(`${url}api/v3/ping`);
};

module.exports.exchangeInfo = (baseAsset, quoteAsset) => {
  return axios.get(`${url}api/v3/exchangeInfo?symbol=${baseAsset}${quoteAsset}`);
};

module.exports.account = () => {
  const query = `timestamp=${Date.now()}`;

  return axios.get(`${url}api/v3/account?${query}&signature=${signature(query)}`, headers);
};

module.exports.openOrders = (baseAsset, quoteAsset) => {
  const query = `symbol=${baseAsset}${quoteAsset}&timestamp=${Date.now()}`;

  return axios.get(`${url}api/v3/openOrders?${query}&signature=${signature(query)}`, headers);
};

module.exports.tickerPrice = (baseAsset, quoteAsset) => {
  const query = `symbol=${baseAsset}${quoteAsset}`;

  return axios.get(`${url}api/v3/ticker/price?${query}`);
};

module.exports.order = params => {
  const query = `${new URLSearchParams(params).toString()}&timestamp=${Date.now()}`;

  return axios.post(`${url}api/v3/order?${query}&signature=${signature(query)}`, "", headers);
};

module.exports.cancelOrder = params => {
  const query = `${new URLSearchParams(params).toString()}&timestamp=${Date.now()}`;

  return axios.delete(`${url}api/v3/order?${query}&signature=${signature(query)}`, headers);
};

module.exports.getBalances = arrayBalances => {
  let objectBalances = {};

  arrayBalances.forEach(balance => {
    objectBalances[balance.asset] = {
      free: balance.free,
      locked: balance.locked,
    };
  });

  return objectBalances;
};
