const { fetchToken, createCoupon } = require("../../services/api");
const { getPayload, removePayload, log } = require("../../utils/helpers");

async function handleTalon(bot, chatId, key) {
  const token = await fetchToken();
  const { payload } = getPayload(key);
  const newCoupon = await createCoupon(payload, token);

  removePayload(key);

  await bot.sendMessage(
    chatId,
    `✅ Талон создан.\nНомер: ${newCoupon.name}\nhttps://petapps.org/coupon/${newCoupon.couponId}`,
  );
  log(`Талон создан для ${payload.visitor}`);
}

module.exports = handleTalon;
