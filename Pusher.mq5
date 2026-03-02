//+------------------------------------------------------------------+
//|                                                      Pusher.mq5  |
//|  MT5 Heartbeat Sender for Quantum API                            |
//+------------------------------------------------------------------+
#property strict
#property description "Whitelist ApiUrl in MT5: Tools > Options > Expert Advisors > Allow WebRequest"

input string ApiUrl                 = "http://127.0.0.1:8000/mt5/heartbeat";
input string ApiKey                 = "therng";
input int    PeriodSec              = 30;
input string TerminalId             = "MT5-A1";
input int    RequestTimeoutMs       = 3000;
input bool   LogSuccess             = false;
input bool   SendDisconnectOnDeinit = true;

#define MIN_TIMER_PERIOD_SEC        1
#define MIN_TIMEOUT_MS              1000
#define DAY_WINDOW_SEC              (1 * 24 * 60 * 60)
#define WEEK_WINDOW_SEC             (7 * 24 * 60 * 60)
#define MONTH_WINDOW_SEC            (30 * 24 * 60 * 60)
#define MAX_PERIOD_DAYS             30

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
   double max_deposit_load;
   double maximum_drawdown;
   double maximum_drawdown_pct;
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

//+------------------------------------------------------------------+
//| Helpers                                                          |
//+------------------------------------------------------------------+
int ClampMin(const int value, const int min_value)
{
   return (value < min_value ? min_value : value);
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
   stats.max_deposit_load = 0.0;
   stats.maximum_drawdown = 0.0;
   stats.maximum_drawdown_pct = 0.0;
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

void CalcPeriodStats(
   PeriodStats &stats,
   const datetime from_time,
   const datetime now_server,
   const int period_days,
   const double deposit_load_percent
)
{
   ResetStats(stats);
   stats.max_deposit_load = deposit_load_percent;

   if(!HistorySelect(from_time, now_server))
      return;

   int tracked_days = period_days;
   if(tracked_days < 1)
      tracked_days = 1;
   if(tracked_days > MAX_PERIOD_DAYS)
      tracked_days = MAX_PERIOD_DAYS;

   uchar activity_days[];
   ArrayResize(activity_days, tracked_days);
   ArrayInitialize(activity_days, 0);

   double running_profit = 0.0;
   double peak_profit = 0.0;
   double max_drawdown = 0.0;

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
      if(deal_time < from_time || deal_time > now_server)
         continue;

      double deal_volume = HistoryDealGetDouble(ticket, DEAL_VOLUME);
      double deal_profit = HistoryDealGetDouble(ticket, DEAL_PROFIT);
      double commission  = HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      double swap        = HistoryDealGetDouble(ticket, DEAL_SWAP);
      double net_profit  = deal_profit + commission + swap;
      long deal_type     = HistoryDealGetInteger(ticket, DEAL_TYPE);

      stats.trades++;
      stats.volume += deal_volume;
      stats.profit += net_profit;

      // Exit SELL usually closes long; exit BUY usually closes short.
      if(deal_type == DEAL_TYPE_SELL)
         stats.trades_long++;
      else if(deal_type == DEAL_TYPE_BUY)
         stats.trades_short++;

      if(net_profit > 0.0)
         stats.profit_trades++;
      else if(net_profit < 0.0)
         stats.loss_trades++;

      int day_index = (int)((now_server - deal_time) / DAY_WINDOW_SEC);
      if(day_index >= 0 && day_index < tracked_days)
         activity_days[day_index] = 1;

      running_profit += net_profit;
      if(running_profit > peak_profit)
         peak_profit = running_profit;

      double drawdown = peak_profit - running_profit;
      if(drawdown > max_drawdown)
         max_drawdown = drawdown;
   }

   if(stats.trades > 0)
   {
      stats.win_rate = 100.0 * (double)stats.profit_trades / (double)stats.trades;
      stats.loss_rate = 100.0 * (double)stats.loss_trades / (double)stats.trades;
   }

   int active_count = 0;
   for(int d = 0; d < tracked_days; d++)
      if(activity_days[d] != 0)
         active_count++;

   stats.active_days = active_count;
   stats.trading_activity = 100.0 * (double)active_count / (double)tracked_days;
   stats.maximum_drawdown = max_drawdown;

   double estimated_start_balance = AccountInfoDouble(ACCOUNT_BALANCE) - stats.profit;
   if(estimated_start_balance <= 0.0)
      estimated_start_balance = AccountInfoDouble(ACCOUNT_BALANCE);

   if(estimated_start_balance > 0.0)
      stats.maximum_drawdown_pct = 100.0 * max_drawdown / estimated_start_balance;
}

string BuildRequestHeaders()
{
   return "Content-Type: application/json\r\n" +
          "X-API-Key: " + ApiKey + "\r\n";
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
   const int last_error_code
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

   CalcPeriodStats(day_stats, now_server - DAY_WINDOW_SEC, now_server, 1, deposit_load);
   CalcPeriodStats(week_stats, now_server - WEEK_WINDOW_SEC, now_server, 7, deposit_load);
   CalcPeriodStats(month_stats, now_server - MONTH_WINDOW_SEC, now_server, 30, deposit_load);

   return "{"
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
      "\"positions_total\":" + (string)positions_total + ","
      "\"orders_total\":" + (string)orders_total + ","
      "\"floating_pl\":" + JsonNumber(floating_pl) + ","
      "\"day_trades\":" + (string)day_stats.trades + ","
      "\"day_trades_long\":" + (string)day_stats.trades_long + ","
      "\"day_trades_short\":" + (string)day_stats.trades_short + ","
      "\"day_profit_total\":" + JsonNumber(day_stats.profit) + ","
      "\"day_volume_lot\":" + JsonNumber(day_stats.volume) + ","
      "\"day_profit_trades\":" + (string)day_stats.profit_trades + ","
      "\"day_profit_trade_rate\":" + JsonNumber(day_stats.win_rate) + ","
      "\"day_loss_trades\":" + (string)day_stats.loss_trades + ","
      "\"day_loss_trade_rate\":" + JsonNumber(day_stats.loss_rate) + ","
      "\"day_trading_activity\":" + JsonNumber(day_stats.trading_activity) + ","
      "\"day_max_deposit_load\":" + JsonNumber(day_stats.max_deposit_load) + ","
      "\"day_maximum_drawdown\":" + JsonNumber(day_stats.maximum_drawdown) + ","
      "\"day_maximum_drawdown_pct\":" + JsonNumber(day_stats.maximum_drawdown_pct) + ","
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
      "\"week_max_deposit_load\":" + JsonNumber(week_stats.max_deposit_load) + ","
      "\"week_maximum_drawdown\":" + JsonNumber(week_stats.maximum_drawdown) + ","
      "\"week_maximum_drawdown_pct\":" + JsonNumber(week_stats.maximum_drawdown_pct) + ","
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
      "\"month_max_deposit_load\":" + JsonNumber(month_stats.max_deposit_load) + ","
      "\"month_maximum_drawdown\":" + JsonNumber(month_stats.maximum_drawdown) + ","
      "\"month_maximum_drawdown_pct\":" + JsonNumber(month_stats.maximum_drawdown_pct) + ","
      "\"last_error\":" + (string)last_error_code
      "}";
}

void SendHeartbeat(const bool terminal_active, const bool algo_active)
{
   bool connected = (bool)TerminalInfoInteger(TERMINAL_CONNECTED);
   int last_error_snapshot = (int)GetLastError();
   string body = BuildPayload(terminal_active, algo_active, connected, last_error_snapshot);

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

   if(http_code == -1)
   {
      int error = GetLastError();
      PrintFormat("Heartbeat failed. error=%d", error);
      if(error == 4060)
         Print("Add ApiUrl to MT5 WebRequest whitelist: Tools > Options > Expert Advisors.");
      return;
   }

   string response_text = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(http_code < 200 || http_code >= 300)
   {
      PrintFormat("Heartbeat HTTP error. code=%d body=%s", http_code, response_text);
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
