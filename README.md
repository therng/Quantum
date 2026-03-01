# Quantum

MT5 heartbeat receiver API built with FastAPI.

## Run as a service on Windows Server 2022

1. Copy this project to the server, for example `C:\Quantum`.
2. Install Python 3.11+.
3. Install NSSM (Non-Sucking Service Manager) and ensure `nssm.exe` is in `PATH`.
4. Open PowerShell as Administrator and run:

```powershell
cd C:\Quantum
powershell -ExecutionPolicy Bypass -File .\scripts\windows\setup.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\windows\install_service.ps1 -ApiKey "replace-with-strong-secret" -Port 8000
```

5. Verify service status:

```powershell
Get-Service MT5HeartbeatApi
```

6. Verify API:

```powershell
Invoke-WebRequest http://127.0.0.1:8000/health
```

### Service scripts

- Install or reinstall service: `scripts/windows/install_service.ps1`
- Remove service: `scripts/windows/remove_service.ps1`
- Bootstrap venv and dependencies: `scripts/windows/setup.ps1`

### MT5 EA settings

- `ApiUrl`: `http://<server-ip>:8000/mt5/heartbeat`
- `ApiKey`: same value passed to `-ApiKey` in install script

## Expose API with ngrok on Windows Server 2022

1. Install `ngrok` and authenticate your account once:

```powershell
ngrok config add-authtoken <your-ngrok-authtoken>
```

2. Install ngrok as a Windows service (Admin PowerShell):

```powershell
cd C:\Quantum
powershell -ExecutionPolicy Bypass -File .\scripts\windows\install_ngrok_service.ps1 -NgrokAuthtoken "<your-ngrok-authtoken>" -LocalPort 8000
```

Optional flags:
- `-ReservedDomain "your-subdomain.ngrok.app"` if you have a reserved domain
- `-BasicAuth "user:strongpass"` to require basic auth at ngrok edge

3. Verify service:

```powershell
Get-Service MT5HeartbeatNgrok
```

4. Get public URL:

```powershell
ngrok api tunnels list
```

5. Set MT5 EA `ApiUrl` to:

```text
https://<your-ngrok-domain>/mt5/heartbeat
```

6. Remove ngrok service when needed:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\remove_ngrok_service.ps1
```
