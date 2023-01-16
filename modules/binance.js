const crypto = require("crypto");
const axios = require("axios");
const _ = require("lodash");

const url = process.env.SPOT_API_URL;

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
    if (balance.free == 0 && balance.locked == 0) return;
    objectBalances[balance.asset] = {
      free: balance.free,
      locked: balance.locked,
    };
  });

  console.table(objectBalances);

  return objectBalances;
};

module.exports.priceToSlot = (price, grid) => Math.floor(Math.log10(price) / Math.log10(1 + grid / 100));
module.exports.slotToPrice = (slot, grid) => Math.pow(1 + grid / 100, slot);

// module.exports.reduceFills = data => {
//   let fills = data.reduce(
//     (prev, curr) => {
//       prev.total += Number(curr.price * (curr.qty - curr.commission));
//       prev.qty += Number(curr.qty);
//       prev.commission += Number(curr.commission);
//       return prev;
//     },
//     {
//       total: 0,
//       qty: 0,
//       commission: 0,
//     }
//   );

//   console.log(fills);

//   return fills;
// };

module.exports.getOpenOrders = (orders, grid) => {
  let openOrders = {};

  orders.forEach(order => {
    openOrders[this.priceToSlot(order.price, grid)] = true;
  });

  return openOrders;
};

module.exports.calculateCommissions = data => {
  [makerCommission, takerCommission] = [data.makerCommission / 10000, data.takerCommission / 10000];

  console.log(`makerCommission: ${makerCommission} / takerCommission: ${takerCommission}`);

  return [makerCommission, takerCommission];
};

module.exports.getLowerPrice = (price, grid, precision) => {
  return _.ceil(this.slotToPrice(this.priceToSlot(price, grid), grid), precision);
};

module.exports.getHigherPrice = (price, grid, precision) => {
  return _.floor(this.slotToPrice(this.priceToSlot(price, grid) + 1, grid), precision);
};
