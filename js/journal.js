// ===== ORBITUM JOURNAL CORE =====

// Safe Supabase init (fallback если CDN не загрузился)
let supabase = null;

try {
  if (window.supabase) {
    supabase = window.supabase.createClient(
      "https://YOUR_PROJECT.supabase.co",
      "YOUR_PUBLIC_ANON_KEY"
    );
  }
} catch (e) {
  console.warn("Supabase not loaded, fallback mode");
}

// ===== STATE =====
let trades = JSON.parse(localStorage.getItem("trades") || "[]");

// ===== DOM =====
const tradesContainer = document.getElementById("trades");
const tradeForm = document.getElementById("tradeForm");

// ===== RENDER =====
function renderTrades() {
  if (!tradesContainer) return;

  tradesContainer.innerHTML = "";

  const reversed = [...trades].reverse();

  reversed.forEach((trade, index) => {
    const el = document.createElement("div");
    el.className = "trade";

    const pnlColor = trade.pnl >= 0 ? "#4caf50" : "#ff4d4d";

    el.innerHTML = `
      <div class="trade-left">
        <div class="trade-pair">${trade.pair}</div>
        <div class="trade-date">${trade.date}</div>
      </div>
      <div class="trade-right" style="color:${pnlColor}">
        ${trade.pnl}$
      </div>
    `;

    tradesContainer.appendChild(el);
  });
}

// ===== ADD TRADE =====
if (tradeForm) {
  tradeForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const pair = tradeForm.pair.value.trim();
    const pnl = parseFloat(tradeForm.pnl.value);

    if (!pair || isNaN(pnl)) return;

    const newTrade = {
      pair,
      pnl,
      date: new Date().toLocaleDateString(),
      timestamp: Date.now(),
    };

    trades.push(newTrade);
    saveTrades();

    tradeForm.reset();
    renderTrades();
  });
}

// ===== STORAGE =====
function saveTrades() {
  localStorage.setItem("trades", JSON.stringify(trades));
}

// ===== DELETE TRADE (optional future) =====
function deleteTrade(index) {
  trades.splice(index, 1);
  saveTrades();
  renderTrades();
}

// ===== BASIC ANALYTICS =====
function calculateStats() {
  if (!trades.length) return null;

  let wins = 0;
  let losses = 0;
  let totalPnL = 0;

  trades.forEach((t) => {
    totalPnL += t.pnl;
    if (t.pnl >= 0) wins++;
    else losses++;
  });

  const winRate = ((wins / trades.length) * 100).toFixed(1);

  return {
    total: trades.length,
    wins,
    losses,
    winRate,
    totalPnL: totalPnL.toFixed(2),
  };
}

// ===== UPDATE UI STATS =====
function renderStats() {
  const stats = calculateStats();
  if (!stats) return;

  const el = document.getElementById("stats");

  if (!el) return;

  el.innerHTML = `
    <div class="stat">
      <span>Total</span>
      <b>${stats.total}</b>
    </div>
    <div class="stat">
      <span>Winrate</span>
      <b>${stats.winRate}%</b>
    </div>
    <div class="stat">
      <span>PnL</span>
      <b style="color:${stats.totalPnL >= 0 ? "#4caf50" : "#ff4d4d"}">
        ${stats.totalPnL}$
      </b>
    </div>
  `;
}

// ===== INIT =====
function init() {
  renderTrades();
  renderStats();
}

init();

// ===== DEBUG =====
console.log("Journal loaded:", trades.length, "trades");
