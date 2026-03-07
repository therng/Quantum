//+------------------------------------------------------------------+
//|                                                      Quantum.mq5 |
//|  Minimal heartbeat + daily SendFTP uploader                      |
//+------------------------------------------------------------------+
#property strict
#property description "Whitelist ApiAliveUrl in MT5. ReportLocalFile must already exist in MQL5\\Files."

input string ApiAliveUrl      = "https://impotently-mazelike-delta.ngrok-free.dev/alive";
input string ApiKey           = "therng";
input string TerminalId       = "Arisa";
input int    HeartbeatSec     = 30;
input int    RequestTimeoutMs = 8000;
input string ReportLocalFile  = "Arisa.html";
input string FtpRemoteFile    = "Arisa.html";
input bool   UploadOnInit     = true;
input bool   LogSuccess       = true;

#define MIN_TIMER_SEC 1
#define MIN_TIMEOUT_MS 1000

datetime g_algo_start_time = 0;
datetime g_last_ftp_day = 0;

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

bool BuildPostData(const string body, char &post[])
{
   int bytes_written = StringToCharArray(body, post, 0, WHOLE_ARRAY, CP_UTF8);
   if(bytes_written <= 0)
      return false;

   ArrayResize(post, bytes_written - 1);
   return true;
}

datetime NormalizeServerDay(const datetime value)
{
   if(value <= 0)
      return 0;

   MqlDateTime parts;
   TimeToStruct(value, parts);
   parts.hour = 0;
   parts.min = 0;
   parts.sec = 0;
   return StructToTime(parts);
}

int GetLatencyMs()
{
   long ping_us = TerminalInfoInteger(TERMINAL_PING_LAST);
   if(ping_us <= 0)
      return 0;

   return (int)((ping_us + 500) / 1000);
}

int GetAlgoUptimeSec()
{
   datetime now_server = TimeCurrent();
   if(g_algo_start_time <= 0 || now_server <= g_algo_start_time)
      return 0;

   return (int)(now_server - g_algo_start_time);
}

bool IsTradeAllowed()
{
   return (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED);
}

bool IsAlgoAllowed()
{
   return (bool)MQLInfoInteger(MQL_TRADE_ALLOWED);
}

string BuildAliveHeaders()
{
   string headers = "Content-Type: application/json\r\nConnection: close\r\n";
   if(StringLen(ApiKey) > 0)
      headers += "X-API-Key: " + ApiKey + "\r\n";
   return headers;
}

string BuildAlivePayload()
{
   string payload = "{";
   payload += "\"tid\":\"" + EscapeJson(TerminalId) + "\",";
   payload += "\"trade_allow\":" + JsonBool(IsTradeAllowed()) + ",";
   payload += "\"algo_allow\":" + JsonBool(IsAlgoAllowed()) + ",";
   payload += "\"uptime_algo\":" + (string)GetAlgoUptimeSec() + ",";
   payload += "\"latency_ms\":" + (string)GetLatencyMs();
   payload += "}";
   return payload;
}

string ResolveRemoteReportFile()
{
   if(StringLen(FtpRemoteFile) > 0)
      return FtpRemoteFile;

   return TerminalId + ".html";
}

void SendAlive()
{
   char post[];
   string body = BuildAlivePayload();
   if(!BuildPostData(body, post))
   {
      Print("Alive payload build failed.");
      return;
   }

   char result[];
   string response_headers = "";

   ResetLastError();
   int http_code = WebRequest(
      "POST",
      ApiAliveUrl,
      BuildAliveHeaders(),
      ClampMin(RequestTimeoutMs, MIN_TIMEOUT_MS),
      post,
      result,
      response_headers
   );

   int last_error = GetLastError();
   string response_text = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   bool is_http_range = (http_code >= 100 && http_code <= 599);

   if(http_code == -1 || !is_http_range)
   {
      PrintFormat("Alive transport error. code=%d lastError=%d body=%s", http_code, last_error, response_text);
      if(last_error == 4060)
         Print("Add ApiAliveUrl to MT5 WebRequest whitelist: Tools > Options > Expert Advisors.");
      return;
   }

   if(http_code < 200 || http_code >= 300)
   {
      PrintFormat("Alive HTTP error. code=%d lastError=%d body=%s", http_code, last_error, response_text);
      return;
   }

   if(LogSuccess)
      PrintFormat("Alive OK. code=%d body=%s", http_code, response_text);
}

bool SendDailyReportFtp()
{
   string local_file = ReportLocalFile;
   string remote_file = ResolveRemoteReportFile();

   ResetLastError();
   bool ok = SendFTP(local_file, remote_file);
   int last_error = GetLastError();

   if(!ok)
   {
      PrintFormat("SendFTP failed. local=%s remote=%s error=%d",
                  local_file,
                  remote_file,
                  last_error);
      return false;
   }

   if(LogSuccess)
      PrintFormat("SendFTP OK. local=%s remote=%s", local_file, remote_file);

   return true;
}

void MaybeSendDailyReportFtp()
{
   datetime current_day = NormalizeServerDay(TimeCurrent());
   if(current_day <= 0)
      return;

   if(current_day == g_last_ftp_day)
      return;

   if(SendDailyReportFtp())
      g_last_ftp_day = current_day;
}

//+------------------------------------------------------------------+
//| Lifecycle                                                        |
//+------------------------------------------------------------------+
int OnInit()
{
   g_algo_start_time = TimeCurrent();
   EventSetTimer(ClampMin(HeartbeatSec, MIN_TIMER_SEC));

   if(UploadOnInit)
      MaybeSendDailyReportFtp();

   PrintFormat("Quantum api started. timer=%d url=%s tid=%s report=%s ftp=%s",
               ClampMin(HeartbeatSec, MIN_TIMER_SEC),
               ApiAliveUrl,
               TerminalId,
               ReportLocalFile,
               ResolveRemoteReportFile());
   Print("Whitelist ApiAliveUrl in MT5 and configure FTP in MT5 terminal settings.");

   return(INIT_SUCCEEDED);
}

void OnTimer()
{
   SendAlive();
   MaybeSendDailyReportFtp();
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   PrintFormat("Quantum api stopped. reason=%d", reason);
}
