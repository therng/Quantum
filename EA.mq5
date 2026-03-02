//+------------------------------------------------------------------+
//|                                                      EA.mq5      |
//|  MT5 Heartbeat Sender (Refactored)                               |
//+------------------------------------------------------------------+
#property strict
#property description "Whitelist ApiUrl in MT5: Tools > Options > Expert Advisors > Allow WebRequest"

input string ApiUrl            = "http://127.0.0.1:3000/mt5/heartbeat";
input string ApiKey            = "therng";
input int    PeriodSec         = 30;
input string TerminalId        = "MT5-A1";
input int    RequestTimeoutMs  = 3000;
input bool   LogSuccess        = false;

#define MIN_TIMER_PERIOD_SEC   1
#define MIN_TIMEOUT_MS         1000
#define LAST3D_WINDOW_SEC      (3 * 24 * 60 * 60)
#define LAST7D_WINDOW_SEC      (7 * 24 * 60 * 60)

struct Last3DaysStats
{
   int    trades;
   double volume;
   double profit;
};

struct IdentityCache
{
   long   login;
   long   build;
   string server;
   string account_name;
   string terminal_id;
};

IdentityCache g_identity_cache;
bool g_identity_cache_ready = false;

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

bool IsAlgoEnabled()
{
   bool terminal_trade_allowed = (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED);
   bool mql_trade_allowed      = (bool)MQLInfoInteger(MQL_TRADE_ALLOWED);
   return (terminal_trade_allowed && mql_trade_allowed);
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

void ResetStats(Last3DaysStats &stats)
{
   stats.trades = 0;
   stats.volume = 0.0;
   stats.profit = 0.0;
}

void RefreshIdentityCache()
{
   long current_login = (long)AccountInfoInteger(ACCOUNT_LOGIN);
   if(!g_identity_cache_ready || current_login != g_identity_cache.login)
   {
      g_identity_cache.login        = current_login;
      g_identity_cache.server       = EscapeJson(AccountInfoString(ACCOUNT_SERVER));
      g_identity_cache.account_name = EscapeJson(AccountInfoString(ACCOUNT_NAME));
      g_identity_cache.terminal_id  = EscapeJson(TerminalId);
      g_identity_cache.build        = (long)TerminalInfoInteger(TERMINAL_BUILD);
      g_identity_cache_ready        = true;
   }
}

void CalcRecentStats(Last3DaysStats &stats_3d, Last3DaysStats &stats_7d, const datetime now)
{
   ResetStats(stats_3d);
   ResetStats(stats_7d);

   datetime from_3d = now - LAST3D_WINDOW_SEC;
   datetime from_7d = now - LAST7D_WINDOW_SEC;

   if(!HistorySelect(from_7d, now))
      return;

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
      double deal_volume = HistoryDealGetDouble(ticket, DEAL_VOLUME);
      double deal_profit = HistoryDealGetDouble(ticket, DEAL_PROFIT);
      double commission  = HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      double swap        = HistoryDealGetDouble(ticket, DEAL_SWAP);
      double net_profit  = deal_profit + commission + swap;

      stats_7d.trades++;
      stats_7d.volume += deal_volume;
      stats_7d.profit += net_profit;

      if(deal_time >= from_3d)
      {
         stats_3d.trades++;
         stats_3d.volume += deal_volume;
         stats_3d.profit += net_profit;
      }
   }
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

string BuildPayload()
{
   datetime now       = TimeCurrent();
   long ts            = (long)now;
   int latency_ms     = (int)TerminalInfoInteger(TERMINAL_PING_LAST);
   int last_error     = (int)GetLastError();

   RefreshIdentityCache();

   bool terminal_active = true;
   bool algo_active     = IsAlgoEnabled();
   bool connected       = (bool)TerminalInfoInteger(TERMINAL_CONNECTED);

   double balance       = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity        = AccountInfoDouble(ACCOUNT_EQUITY);
   double margin        = AccountInfoDouble(ACCOUNT_MARGIN);
   double free_m        = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double mlevel        = AccountInfoDouble(ACCOUNT_MARGIN_LEVEL);

   int pos_total        = 0;
   int ord_total        = OrdersTotal();
   double float_pl      = 0.0;
   CollectOpenPositionStats(pos_total, float_pl);

   Last3DaysStats stats;
   Last3DaysStats week_stats;
   CalcRecentStats(stats, week_stats, now);

   string body =
      "{"
      + "\"login\":" + (string)g_identity_cache.login + ","
      + "\"server\":\"" + g_identity_cache.server + "\","
      + "\"terminal_id\":\"" + g_identity_cache.terminal_id + "\","
      + "\"terminal_active\":" + JsonBool(terminal_active) + ","
      + "\"algo_active\":" + JsonBool(algo_active) + ","
      + "\"ts\":" + (string)ts + ","
      + "\"account_name\":\"" + g_identity_cache.account_name + "\","
      + "\"latency_ms\":" + (string)latency_ms + ","
      + "\"trades_last_3d\":" + (string)stats.trades + ","
      + "\"volume_last_3d\":" + JsonNumber(stats.volume) + ","
      + "\"profit_last_3d\":" + JsonNumber(stats.profit) + ","
      + "\"trades_last_7d\":" + (string)week_stats.trades + ","
      + "\"volume_last_7d\":" + JsonNumber(week_stats.volume) + ","
      + "\"profit_last_7d\":" + JsonNumber(week_stats.profit) + ","
      + "\"connected\":" + JsonBool(connected) + ","
      + "\"build\":" + (string)g_identity_cache.build + ","
      + "\"balance\":" + JsonNumber(balance) + ","
      + "\"equity\":" + JsonNumber(equity) + ","
      + "\"margin\":" + JsonNumber(margin) + ","
      + "\"free_margin\":" + JsonNumber(free_m) + ","
      + "\"margin_level\":" + JsonNumber(mlevel) + ","
      + "\"positions_total\":" + (string)pos_total + ","
      + "\"orders_total\":" + (string)ord_total + ","
      + "\"floating_pl\":" + JsonNumber(float_pl) + ","
      + "\"last_error\":" + (string)last_error
      + "}";

   return body;
}

void SendHeartbeat()
{
   string body = BuildPayload();

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
      PrintFormat("Heartbeat failed. error=%d", GetLastError());
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
//| Init / Deinit                                                    |
//+------------------------------------------------------------------+
int OnInit()
{
   int timer_period = ClampMin(PeriodSec, MIN_TIMER_PERIOD_SEC);
   RefreshIdentityCache();
   EventSetTimer(timer_period);

   PrintFormat("Heartbeat EA started. interval=%d sec, url=%s, terminal_id=%s",
               timer_period, ApiUrl, TerminalId);
   Print("Remember to whitelist URL in MT5: Tools > Options > Expert Advisors > Allow WebRequest.");

   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   PrintFormat("Heartbeat EA stopped. reason=%d", reason);
}

//+------------------------------------------------------------------+
//| Heartbeat                                                        |
//+------------------------------------------------------------------+
void OnTimer()
{
   SendHeartbeat();
}
