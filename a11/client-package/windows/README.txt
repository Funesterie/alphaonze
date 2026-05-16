Kaen44 client package for Windows

This lightweight client installs Kaen44 as a searchable Windows app.
It opens the configured Kaen44 service in a dedicated browser app window.
A11 remains a remote service and is not installed locally on client machines.

Install:
1. Right click Install-A11-Client.ps1
2. Choose "Run with PowerShell"

Default URL is written in manifest.json.

What it installs:
- App shortcut on the Desktop
- App shortcut in the Start Menu
- Optional search aliases, usually only K44
- CLI commands: kaen44 and k44
- A dedicated browser profile in %LOCALAPPDATA%\<InstallSlug>\BrowserProfile
- App registration in Windows installed apps
- Secure local token storage using Windows DPAPI

Client tools:
- Essential: browser, Drive/OneDrive when needed, PDF/OCR tools for invoices
- Recommended: Office/LibreOffice, PDF24, Audacity/ffmpeg, GIMP/Paint.NET/Canva, SQLite Browser
- Advanced: Git, Node.js, Python, PostgreSQL, Neo4j, Docker Desktop

Kaen44 should recommend only the simplest useful tool for each client project.

CLI:
- kaen44 open
- kaen44 status
- kaen44 guard status
- kaen44 guard enable
- kaen44 guard disable
- kaen44 token set openai
- kaen44 token list
- kaen44 token show openai
- kaen44 token remove openai

Tokens are encrypted for the current Windows user. They are not written in clear text.

Usage guard:
- Default mode is transparent_limit
- Heavy or abusive usage can trigger Kaen44 Plus at 5 EUR
- Technical/quota/guard events should notify cellaurojeffrey@gmail.com
- Kaen44 must not fake an error; it should display a clear limitation message

Uninstall:
Run the Uninstall-A11-Client.ps1 copied inside the app install directory.
