//+------------------------------------------------------------------+
//|                                                      Pusher.mq5  |
//|  MT5 Heartbeat Sender for Quantum API (Improved)                 |
//+------------------------------------------------------------------+
#property strict
#property description "Whitelist ApiUrl in MT5: Tools > Options > Expert Advisors > Allow WebRequest"

input string ApiUrl                 = "http://127.0.0.1:8000/mt5/heartbeat";
input string ApiKey                 = "therng";
input int    PeriodSec              = 30;
input string TerminalId             = "MT5-A1";
input int    RequestTimeoutMs       = 8000;   // Increased default to reduce intermittent failures
input bool   LogSuccess             = false;
input bool   SendDisconnectOnDeinit = true;

// New: heavy stats throttle. 1 = every heartbeat, 5 = every 5th heartbeat, etc.
input int    HeavyStatsEveryN        = 5;

#define MIN_TIMER_PERIOD_SEC        1
#define MIN_TIMEOUT_MS              1000
#define DAY_WINDOW_SEC              (1 * 24 * 60 * 60)
#define WEEK_WINDOW_SEC             (7 * 24 * 60 * 60)
#define MONTH_WINDOW_SEC            (30 * 24 * 60 * 60)

struct PeriodStats
{
   int    trades;
   int    trades_long;
   int    trades_short;
   int    profit_trades;
   int    loss_trades;
   int    active_days;
   double volume;
   double profit;
   double win_rate;
   double loss_rate;
   double trading_activity;
};

struct IdentityCache
{
   long   login;
   string server;
   string account_name;
   string terminal_id;
};

IdentityCache g_identity;
bool          g_identity_ready = false;
int           g_heartbeat_counter = 0;

//+------------------------------------------------------------------+
//| Helpers                                                          |
//+------------------------------------------------------------------+
int ClampMin(const int value, const int min_value)
{
   return (value < min_value ? min_value : value);
}

int ClampMin1(const int value)
{
   return ClampMin(value, 1);
}

string JsonBool(const bool value)
{
   return (value ? "true" : "false");
}

string JsonNumber(const double value, const int digits = 2)
{
   return DoubleToString(value, digits);
}

string EscapeJson(string value)
{
   string out = value;
   StringReplace(out, "\\", "\\\\");
   StringReplace(out, "\"", "\\\"");
   StringReplace(out, "\r", "\\r");
   StringReplace(out, "\n", "\\n");
   StringReplace(out, "\t", "\\t");
   return out;
}

bool IsAlgoEnabled()
{
   bool terminal_trade_allowed = (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED);
   bool mql_trade_allowed      = (bool)MQLInfoInteger(MQL_TRADE_ALLOWED);
   return (terminal_trade_allowed && mql_trade_allowed);
}

void ResetStats(PeriodStats &stats)
{
   stats.trades = 0;
   stats.trades_long = 0;
   stats.trades_short = 0;
   stats.profit_trades = 0;
   stats.loss_trades = 0;
   stats.active_days = 0;
   stats.volume = 0.0;
   stats.profit = 0.0;
   stats.win_rate = 0.0;
   stats.loss_rate = 0.0;
   stats.trading_activity = 0.0;
}

void RefreshIdentityCache()
{
   long current_login = (long)AccountInfoInteger(ACCOUNT_LOGIN);
   if(!g_identity_ready || current_login != g_identity.login)
   {
      g_identity.login        = current_login;
      g_identity.server       = EscapeJson(AccountInfoString(ACCOUNT_SERVER));
      g_identity.account_name = EscapeJson(AccountInfoString(ACCOUNT_NAME));
      g_identity.terminal_id  = EscapeJson(TerminalId);
      g_identity_ready        = true;
   }
}

double CalcDepositLoadPercent(const double balance, const double equity, const double margin)
{
   double base = balance;
   if(base <= 0.0)
      base = equity;
   if(base <= 0.0)
      return 0.0;

   return (margin / base) * 100.0;
}

void CollectOpenPositionStats(int &positions_total, double &floating_pl)
{
   positions_total = PositionsTotal();
   floating_pl = 0.0;

   for(int i = 0; i < positions_total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;

      if(PositionSelectByTicket(ticket))
         floating_pl += PositionGetDouble(POSITION_PROFIT);
   }
}

void AddDealToStats(PeriodStats &stats, const long deal_type, const double deal_volume, const double net_profit)
{
   stats.trades++;
   stats.volume += deal_volume;
   stats.profit += net_profit;

   // For close deals: SELL usually closes long, BUY usually closes short.
   if(deal_type == DEAL_TYPE_SELL)
      stats.trades_long++;
   else if(deal_type == DEAL_TYPE_BUY)
      stats.trades_short++;

   if(net_profit > 0.0)
      stats.profit_trades++;
   else if(net_profit < 0.0)
      stats.loss_trades++;
}

void FinalizeStats(PeriodStats &stats, const int period_days, const uchar &activity[])
{
   if(stats.trades > 0)
   {
      stats.win_rate = 100.0 * (double)stats.profit_trades / (double)stats.trades;
      stats.loss_rate = 100.0 * (double)stats.loss_trades / (double)stats.trades;
   }

   int active = 0;
   int n = ArraySize(activity);
   for(int i = 0; i < n; i++)
   {
      if(activity[i] != 0)
         active++;
   }

   stats.active_days = active;
   stats.trading_activity = 100.0 * (double)active / (double)period_days;
}

void CalcRecentStats(PeriodStats &day_stats, PeriodStats &week_stats, PeriodStats &month_stats, const datetime now_server)
{
   ResetStats(day_stats);
   ResetStats(week_stats);
   ResetStats(month_stats);

   uchar day_activity[];
   uchar week_activity[];
   uchar month_activity[];
   ArrayResize(day_activity, 1);
   ArrayResize(week_activity, 7);
   ArrayResize(month_activity, 30);
   ArrayInitialize(day_activity, 0);
   ArrayInitialize(week_activity, 0);
   ArrayInitialize(month_activity, 0);

   datetime from_month = now_server - MONTH_WINDOW_SEC;
   if(!HistorySelect(from_month, now_server))
   {
      FinalizeStats(day_stats, 1, day_activity);
      FinalizeStats(week_stats, 7, week_activity);
      FinalizeStats(month_stats, 30, month_activity);
      return;
   }

   int deals = HistoryDealsTotal();
   for(int i = 0; i < deals; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0)
         continue;

      long entry = HistoryDealGetInteger(ticket, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY && entry != DEAL_ENTRY_INOUT)
         continue;

      datetime deal_time = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      if(deal_time < from_month || deal_time > now_server)
         continue;

      int day_index = (int)((now_server - deal_time) / DAY_WINDOW_SEC);
      if(day_index < 0 || day_index >= 30)
         continue;

      double deal_volume = HistoryDealGetDouble(ticket, DEAL_VOLUME);
      double deal_profit = HistoryDealGetDouble(ticket, DEAL_PROFIT);
      double commission  = HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      double swap        = HistoryDealGetDouble(ticket, DEAL_SWAP);
      double net_profit  = deal_profit + commission + swap;
      long deal_type     = HistoryDealGetInteger(ticket, DEAL_TYPE);

      AddDealToStats(month_stats, deal_type, deal_volume, net_profit);
      month_activity[day_index] = 1;

      if(day_index < 7)
      {
         AddDealToStats(week_stats, deal_type, deal_volume, net_profit);
         week_activity[day_index] = 1;
      }

      if(day_index == 0)
      {
         AddDealToStats(day_stats, deal_type, deal_volume, net_profit);
         day_activity[0] = 1;
      }
   }

   FinalizeStats(day_stats, 1, day_activity);
   FinalizeStats(week_stats, 7, week_activity);
   FinalizeStats(month_stats, 30, month_activity);
}

string BuildRequestHeaders()
{
   // Key changes:
   // - Connection: close (avoid flaky keep-alive / reuse behavior)
   // - Keep headers minimal and deterministic
   return "Content-Type: application/json\r\n" +
          "X-API-Key: " + ApiKey + "\r\n" +
          "Connection: close\r\n";
}

bool BuildPostData(const string body, char &post[])
{
   int bytes_written = StringToCharArray(body, post, 0, WHOLE_ARRAY, CP_UTF8);
   if(bytes_written <= 0)
      return false;

   // Remove trailing null terminator before WebRequest.
   ArrayResize(post, bytes_written - 1);
   return true;
}

string BuildPayload(
   const bool terminal_active,
   const bool algo_active,
   const bool connected,
   const int last_error_code,
   const bool include_heavy_stats
)
{
   datetime now_server = TimeCurrent();
   datetime now_utc    = TimeGMT();
   long ts             = (long)now_utc;

   RefreshIdentityCache();

   int latency_ms      = (int)TerminalInfoInteger(TERMINAL_PING_LAST);
   double balance      = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity       = AccountInfoDouble(ACCOUNT_EQUITY);
   double margin       = AccountInfoDouble(ACCOUNT_MARGIN);
   double free_margin  = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double margin_level = AccountInfoDouble(ACCOUNT_MARGIN_LEVEL);
   double deposit_load = CalcDepositLoadPercent(balance, equity, margin);

   int positions_total = 0;
   int orders_total    = OrdersTotal();
   double floating_pl  = 0.0;
   CollectOpenPositionStats(positions_total, floating_pl);

   PeriodStats day_stats;
   PeriodStats week_stats;
   PeriodStats month_stats;

   if(include_heavy_stats)
      CalcRecentStats(day_stats, week_stats, month_stats, now_server);
   else
   {
      ResetStats(day_stats);
      ResetStats(week_stats);
      ResetStats(month_stats);
   }

   string payload = "{"
      "\"login\":" + (string)g_identity.login + ","
      "\"server\":\"" + g_identity.server + "\","
      "\"terminal_id\":\"" + g_identity.terminal_id + "\","
      "\"terminal_active\":" + JsonBool(terminal_active) + ","
      "\"algo_active\":" + JsonBool(algo_active) + ","
      "\"ts\":" + (string)ts + ","
      "\"account_name\":\"" + g_identity.account_name + "\","
      "\"latency_ms\":" + (string)latency_ms + ","
      "\"connected\":" + JsonBool(connected) + ","
      "\"balance\":" + JsonNumber(balance) + ","
      "\"equity\":" + JsonNumber(equity) + ","
      "\"margin\":" + JsonNumber(margin) + ","
      "\"free_margin\":" + JsonNumber(free_margin) + ","
      "\"margin_level\":" + JsonNumber(margin_level) + ","
      "\"deposit_load\":" + JsonNumber(deposit_load) + ","
      "\"positions_total\":" + (string)positions_total + ","
      "\"orders_total\":" + (string)orders_total + ","
      "\"floating_pl\":" + JsonNumber(floating_pl) + ",";

   // Light vs heavy stats: include a flag so backend can understand sparsity.
   payload += "\"stats_included\":" + JsonBool(include_heavy_stats) + ",";

   payload += "\"day_trades\":" + (string)day_stats.trades + ","
      "\"day_trades_long\":" + (string)day_stats.trades_long + ","
      "\"day_trades_short\":" + (string)day_stats.trades_short + ","
      "\"day_profit_total\":" + JsonNumber(day_stats.profit) + ","
      "\"day_volume_lot\":" + JsonNumber(day_stats.volume) + ","
      "\"day_profit_trades\":" + (string)day_stats.profit_trades + ","
      "\"day_profit_trade_rate\":" + JsonNumber(day_stats.win_rate) + ","
      "\"day_loss_trades\":" + (string)day_stats.loss_trades + ","
      "\"day_loss_trade_rate\":" + JsonNumber(day_stats.loss_rate) + ","
      "\"day_trading_activity\":" + JsonNumber(day_stats.trading_activity) + ","
      "\"week_trades\":" + (string)week_stats.trades + ","
      "\"week_trades_long\":" + (string)week_stats.trades_long + ","
      "\"week_trades_short\":" + (string)week_stats.trades_short + ","
      "\"week_profit_total\":" + JsonNumber(week_stats.profit) + ","
      "\"week_volume_lot\":" + JsonNumber(week_stats.volume) + ","
      "\"week_profit_trades\":" + (string)week_stats.profit_trades + ","
      "\"week_profit_trade_rate\":" + JsonNumber(week_stats.win_rate) + ","
      "\"week_loss_trades\":" + (string)week_stats.loss_trades + ","
      "\"week_loss_trade_rate\":" + JsonNumber(week_stats.loss_rate) + ","
      "\"week_trading_activity\":" + JsonNumber(week_stats.trading_activity) + ","
      "\"month_trades\":" + (string)month_stats.trades + ","
      "\"month_trades_long\":" + (string)month_stats.trades_long + ","
      "\"month_trades_short\":" + (string)month_stats.trades_short + ","
      "\"month_profit_total\":" + JsonNumber(month_stats.profit) + ","
      "\"month_volume_lot\":" + JsonNumber(month_stats.volume) + ","
      "\"month_profit_trades\":" + (string)month_stats.profit_trades + ","
      "\"month_profit_trade_rate\":" + JsonNumber(month_stats.win_rate) + ","
      "\"month_loss_trades\":" + (string)month_stats.loss_trades + ","
      "\"month_loss_trade_rate\":" + JsonNumber(month_stats.loss_rate) + ","
      "\"month_trading_activity\":" + JsonNumber(month_stats.trading_activity) + ","
      "\"last_error\":" + (string)last_error_code
      "}";

   return payload;
}

void SendHeartbeat(const bool terminal_active, const bool algo_active)
{
   g_heartbeat_counter++;

   bool connected = (bool)TerminalInfoInteger(TERMINAL_CONNECTED);
   int last_error_snapshot = (int)GetLastError();

   int n = ClampMin1(HeavyStatsEveryN);
   bool include_heavy_stats = (n == 1 || (g_heartbeat_counter % n) == 0);

   string body = BuildPayload(terminal_active, algo_active, connected, last_error_snapshot, include_heavy_stats);

   char post[];
   if(!BuildPostData(body, post))
   {
      Print("Heartbeat build failed: payload conversion error.");
      return;
   }

   char result[];
   string request_headers  = BuildRequestHeaders();
   string response_headers = "";
   int timeout             = ClampMin(RequestTimeoutMs, MIN_TIMEOUT_MS);

   ResetLastError();
   int http_code = WebRequest(
      "POST",
      ApiUrl,
      request_headers,
      timeout,
      post,
      result,
      response_headers
   );

   // Always capture last error for debugging (even when http_code isn't -1).
   int last_error = GetLastError();

   string response_text = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);

   // -1 is the documented transport-failure return; however we also see "impl codes"
   // like 1003 in the field. Treat anything outside HTTP range as non-HTTP.
   bool is_http_range = (http_code >= 100 && http_code <= 599);

   if(http_code == -1 || !is_http_range)
   {
      PrintFormat("Heartbeat transport/impl error. code=%d lastError=%d body=%s",
                  http_code, last_error, response_text);

      if(last_error == 4060)
         Print("Add ApiUrl to MT5 WebRequest whitelist: Tools > Options > Expert Advisors.");
      return;
   }

   if(http_code < 200 || http_code >= 300)
   {
      PrintFormat("Heartbeat HTTP error. code=%d lastError=%d body=%s",
                  http_code, last_error, response_text);
      return;
   }

   if(LogSuccess)
      PrintFormat("Heartbeat OK. code=%d body=%s", http_code, response_text);
}

//+------------------------------------------------------------------+
//| Lifecycle                                                        |
//+------------------------------------------------------------------+
int OnInit()
{
   int timer_period = ClampMin(PeriodSec, MIN_TIMER_PERIOD_SEC);
   RefreshIdentityCache();
   EventSetTimer(timer_period);

   PrintFormat("Pusher started. interval=%d sec, url=%s, terminal_id=%s",
               timer_period, ApiUrl, TerminalId);
   Print("Remember to whitelist URL in MT5: Tools > Options > Expert Advisors > Allow WebRequest.");

   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   if(SendDisconnectOnDeinit)
      SendHeartbeat(false, false);

   PrintFormat("Pusher stopped. reason=%d", reason);
}

void OnTimer()
{
   SendHeartbeat(true, IsAlgoEnabled());
}
