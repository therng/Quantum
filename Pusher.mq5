//+------------------------------------------------------------------+
//|                                                  MT5_Monitor.mq5 |
//+------------------------------------------------------------------+
input string API_URL = "http://127.0.0.1:8000/mt5/heartbeat";
input string API_KEY = "therng";
input int HEARTBEAT_INTERVAL = 20; // seconds
input int HTTP_TIMEOUT = 200; // milliseconds (Keep very low to avoid locking up OnTick)

//--- WinAPI for CPU Load Calculation
#import "kernel32.dll"
int GetSystemTimes(ulong &lpIdleTime, ulong &lpKernelTime, ulong &lpUserTime);
int GetProcessTimes(long hProcess, ulong &lpCreationTime, ulong &lpExitTime, ulong &lpKernelTime, ulong &lpUserTime);
#import

//--- Globals
datetime g_lastHeartbeat = 0;
string   g_headers;
ulong    g_prevIdleTime = 0;
ulong    g_prevKernelTime = 0;
ulong    g_prevUserTime = 0;
ulong    g_prevAppKernelTime = 0;
ulong    g_prevAppUserTime = 0;

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   g_headers = "Content-Type: application/json\r\n"
               "x-api-key: " + API_KEY + "\r\n";
               
   // Initialize CPU times
   GetSystemTimes(g_prevIdleTime, g_prevKernelTime, g_prevUserTime);
   ulong cTime, eTime;
   GetProcessTimes((long)-1, cTime, eTime, g_prevAppKernelTime, g_prevAppUserTime);
               
   EventSetTimer(HEARTBEAT_INTERVAL);
   SendStatus("alive", "connected"); 
   
   long account = AccountInfoInteger(ACCOUNT_LOGIN);
   PrintFormat("MT5 Monitor EA initialized for account %I64d. Interval: %ds", account, HEARTBEAT_INTERVAL);
   
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   SendStatus("disconnect", GetDeinitReason(reason)); 
   long account = AccountInfoInteger(ACCOUNT_LOGIN);
   PrintFormat("MT5 Monitor EA stopped for account %I64d. Reason: %s", account, GetDeinitReason(reason));
}

//+------------------------------------------------------------------+
//| Expert timer function                                            |
//+------------------------------------------------------------------+
void OnTimer()
{
   if(!TerminalInfoInteger(TERMINAL_CONNECTED))
   {
      SendStatus("disconnect", "terminal_disconnected");
      return;
   }
   
   SendStatus("alive", "running");
}

//+------------------------------------------------------------------+
//| Calculate current System & App CPU Load % using WinAPI           |
//+------------------------------------------------------------------+
void GetCPULoads(double &sysCpuLoad, double &appCpuLoad)
{
   sysCpuLoad = 0.0;
   appCpuLoad = 0.0;
   
   ulong idleTime, kernelTime, userTime;
   ulong cTime, eTime, appKernelTime, appUserTime;
   
   if(GetSystemTimes(idleTime, kernelTime, userTime) == 0) 
      return;
      
   GetProcessTimes((long)-1, cTime, eTime, appKernelTime, appUserTime);

   ulong usrDiff = userTime - g_prevUserTime;
   ulong kerDiff = kernelTime - g_prevKernelTime;
   ulong idlDiff = idleTime - g_prevIdleTime;

   ulong appUsrDiff = appUserTime - g_prevAppUserTime;
   ulong appKerDiff = appKernelTime - g_prevAppKernelTime;

   ulong sysTotal = usrDiff + kerDiff;

   if(sysTotal > 0)
   {
      sysCpuLoad = (double)(sysTotal - idlDiff) / sysTotal * 100.0;
      appCpuLoad = (double)(appUsrDiff + appKerDiff) / sysTotal * 100.0;
   }

   g_prevIdleTime = idleTime;
   g_prevKernelTime = kernelTime;
   g_prevUserTime = userTime;
   g_prevAppKernelTime = appKernelTime;
   g_prevAppUserTime = appUserTime;
}

//+------------------------------------------------------------------+
//| Build JSON and send WebRequest                                   |
//+------------------------------------------------------------------+
void SendStatus(string status, string algoStatus)
{
   long account = AccountInfoInteger(ACCOUNT_LOGIN);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   int positions = PositionsTotal();
   
   // Get metrics
   double cpu_load = 0.0, app_cpu_load = 0.0;
   GetCPULoads(cpu_load, app_cpu_load);
   
   long ping = TerminalInfoInteger(TERMINAL_PING_LAST);
   long mem_phys = TerminalInfoInteger(TERMINAL_MEMORY_PHYSICAL);
   long mem_avail = TerminalInfoInteger(TERMINAL_MEMORY_AVAILABLE);
   long term_mem_used = TerminalInfoInteger(TERMINAL_MEMORY_USED);
   
   double mem_avail_perc = (mem_phys > 0) ? (double)mem_avail / mem_phys * 100.0 : 0.0;
   if(mem_avail_perc > 100.0) mem_avail_perc = 100.0;
   
   double app_mem_perc = (mem_phys > 0) ? (double)term_mem_used / mem_phys * 100.0 : 0.0;
   if(app_mem_perc > 100.0) app_mem_perc = 100.0;
   
   string json = StringFormat(
      "{"
      "\"account\":%I64d,"
      "\"equity\":%.2f,"
      "\"balance\":%.2f,"
      "\"status\":\"%s\","
      "\"algo\":\"%s\","
      "\"open_positions\":%d,"
      "\"timestamp\":\"%s\","
      "\"cpu_load_percent\":%.2f,"
      "\"app_cpu_percent\":%.2f,"
      "\"terminal_ping_last\":%I64d,"
      "\"terminal_memory_available_percent\":%.2f,"
      "\"app_memory_percent\":%.2f"
      "}",
      account, equity, balance, status, algoStatus, positions,
      TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS),
      cpu_load, app_cpu_load, ping, mem_avail_perc, app_mem_perc
   );
   
   uchar post[];
   int json_len = StringLen(json);
   ArrayResize(post, json_len);
   StringToCharArray(json, post, 0, json_len, CP_UTF8);
   ArrayResize(post, json_len);
   
   uchar result[];
   string result_headers;
   
   // Use custom low timeout to prevent locking up the main EA thread
   int res = WebRequest("POST", API_URL, g_headers, HTTP_TIMEOUT, post, result, result_headers);
   
   if(res == -1)
   {
      int error = GetLastError();
      // Error 5203 is HTTP request timeout, which is expected with very low timeout values. We can ignore it for heartbeats.
      if(error != 5203) 
      {
         PrintFormat("[Account %I64d] WebRequest failed. Error: %d", account, error);
         if(error == 4060) PrintFormat("[Account %I64d] Please add URL to: Tools -> Options -> Expert Advisors -> Allow WebRequest", account);
         if(error == 4014) PrintFormat("[Account %I64d] Please check 'Allow DLL imports' for CPU tracking.", account);
      }
      return;
   }
   
   if(res >= 200 && res < 300)
   {
      g_lastHeartbeat = TimeCurrent();
   }
   else
   {
      PrintFormat("[Account %I64d] HTTP Error %d: %s", account, res, CharArrayToString(result));
   }
}

//+------------------------------------------------------------------+
//| Convert Deinit Reason to String                                  |
//+------------------------------------------------------------------+
string GetDeinitReason(int reason)
{
   switch(reason)
   {
      case REASON_PROGRAM:     return "expert_removed";
      case REASON_REMOVE:      return "expert_removed_manually";
      case REASON_RECOMPILE:   return "recompiled";
      case REASON_CHARTCHANGE: return "chart_changed";
      case REASON_CHARTCLOSE:  return "chart_closed";
      case REASON_PARAMETERS:  return "parameters_changed";
      case REASON_ACCOUNT:     return "account_changed";
      case REASON_TEMPLATE:    return "template_changed";
      case REASON_INITFAILED:  return "init_failed";
      case REASON_CLOSE:       return "terminal_closed";
      default:                 return "unknown";
   }
}
