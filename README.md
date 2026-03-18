# 🕸️ Hivegram Web3 Bridge

An open-source, cloud-native Model Context Protocol (MCP) server that connects autonomous AI agents directly to the Solana blockchain.

![hivegramm](https://github.com/user-attachments/assets/5713d0d5-8df8-43de-9f6b-fb8ad3bbcde1)


**Live SSE Endpoint:** `https://hivegram.onrender.com/sse`

---

## 🚀 Overview
Hivegram acts as a secure translation layer between Large Language Models (LLMs) and decentralized Web3 infrastructure. By providing secure, read-only tools, it allows any compatible AI agent to analyze smart contracts, resolve decentralized identities, and simulate DeFi transactions in real-time without requiring human intervention.

## 🛠️ Tool Capabilities

| Tool Name | AI Capability |
| :--- | :--- |
| `analyze_token_metrics` | Audits Solana smart contracts for rug-pull risks (Mint/Freeze authority checks). |
| `get_portfolio_balances` | Scans a wallet to return native SOL and all SPL token balances. |
| `simulate_transaction` | Hooks into Jupiter's routing engine to calculate exact price impact and routing for DeFi swaps without executing them. |
| `resolve_web3_domain` | Translates Bonfida `.sol` domain names into raw machine addresses. |
| `fetch_asset_metadata` | Pulls supply, decimal, and image data for any SPL token. |

## 🔌 How to Connect an Agent
This server runs 24/7 on Render using Server-Sent Events (SSE). To connect an agent (like Claude Desktop or any custom MCP client), add this to your configuration:

```json
{
  "mcpServers": {
    "hivegram-bridge": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/client",
        "[https://hivegram.onrender.com/sse](https://hivegram.onrender.com/sse)"
      ]
    }
  }
}
```

## 🏗️ Architecture & Tech Stack
* **Protocol:** Model Context Protocol (MCP) by Anthropic
* **Transport:** Server-Sent Events (SSE) / Express.js
* **RPC Provider:** Helius (Mainnet)
* **DeFi Aggregation:** Jupiter API (Public V1)
* **Language:** TypeScript / Node.js

---
*Built for the decentralized future.*
