<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# VerifEye 👀

VerifEye is a fast, accurate MVP web application designed to validate whether email addresses exist and can receive mail. It uses a multi-layered verification system simulating the techniques of professional email verifiers to check both single emails and bulk lists asynchronously.

## Features

- **Single Email Verification**: Check a single email address and instantly view detailed verification steps.
- **Bulk Email Verification**: Process up to 1,000 emails concurrently. Paste addresses directly or upload a `.csv`/`.txt` file.
- **Layered Validation Engine**:
  - **Syntax Check**: Formats verified against RFC standards.
  - **DNS/MX Check**: Live ping to DNS resolvers to confirm domain health and MX records.
  - **SMTP Handshake**: Simulated SMTP conversations (without sending real mail) via port 25 and 587.
- **Verifalia-style SMTP Parsing**: Intelligently handles major provider anti-harvesting blocks (like Microsoft and Yahoo returning `5.7.x` or `5.1.1` to probes) so valid emails aren't falsely flagged as invalid.
- **Provider Intelligence**: Autodetects domains as Free, Business, Educational, or Disposable based on MX fingerprints.
- **Risk Assessment**: Flags role-based addresses (`admin@`, `support@`) and catch-all domains as `Risky`.
- **Export**: Download full bulk verification results to CSV.

## Classification System

Emails are classified into one of four statuses:
1. **Valid**: Syntax is healthy, DNS/MX exists, and SMTP server positively confirmed the mailbox.
2. **Invalid**: Syntax is bad, domain is dead, or the provider explicitly confirmed the inbox does not exist.
3. **Risky**: Mailbox *might* exist, but it requires caution (e.g., disposable provider, role-based alias, or catch-all server).
4. **Unknown**: The server temporarily deferred or policy-blocked the verification probe (common with free providers like Hotmail).

## Setup & Local Development

This app is built with **Node.js/Express** (backend) and **React/Vite** (frontend). 

### Prerequisites
- Node.js `v18+` or `v20+`

### Installation

1. Copy the environment file and customize if needed:
   ```bash
   cp .env.example .env
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Running Locally

```bash
npm run dev
```
The server will start on `http://localhost:3000`. Changes to both frontend and backend (`server.ts`) will hot-reload automatically.

> **Note on Local Environments:** Residential ISPs and cloud VMs often block outward port 25 (SMTP). If so, VerifEye handles this gracefully by attempting a fallback to port 587 and marking inconclusive results as `Unknown` rather than failing outright.

## Production / VPS Deployment (e.g., Hostinger)

1. Clone your project onto the VPS.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the frontend assets:
   ```bash
   npm run build
   ```
4. Start the production server:
   ```bash
   npm start
   ```

**Tip**: For persistent uptime on a VPS, use a process manager like PM2:
```bash
npm install -g pm2
pm2 start "npm start" --name verifeye
pm2 save
pm2 startup
```
