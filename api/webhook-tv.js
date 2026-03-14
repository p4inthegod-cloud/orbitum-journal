export default async function handler(req, res) {

  // принимаем только POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {

    // проверка секрета (если используешь)
    const secret = req.query.secret;

    if (process.env.TV_WEBHOOK_SECRET) {
      if (secret !== process.env.TV_WEBHOOK_SECRET) {
        return res.status(403).json({ error: "Invalid secret" });
      }
    }

    // payload из TradingView
    const data = req.body;

    const action = data.action;
    const ticker = data.ticker;
    const price = data.close || data.price;
    const interval = data.interval;

    console.log("TradingView webhook received:");

    console.log({
      action,
      ticker,
      price,
      interval,
      raw: data
    });

    // тут потом можно добавить:
    // - AI анализ
    // - загрузку свечей
    // - отправку в Telegram
    // - запись в журнал

    return res.status(200).json({
      success: true,
      message: "Webhook received",
      data
    });

  } catch (error) {

    console.error("Webhook error:", error);

    return res.status(500).json({
      error: "Internal server error"
    });

  }
}
