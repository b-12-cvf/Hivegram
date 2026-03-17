import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getDomainKey, NameRegistryState } from "@bonfida/spl-name-service";
import * as dotenv from "dotenv";
import https from "node:https";
import express from "express";
import cors from "cors";

// 1. Load API Keys
dotenv.config();
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
if (!HELIUS_API_KEY) {
  console.error("Fatal error: HELIUS_API_KEY is not set in the .env file.");
  process.exit(1);
}

// 2. Initialize Solana Connection & Constants
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const solanaConnection = new Connection(RPC_URL);
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const SOL_MINT = "So11111111111111111111111111111111111111112";

// 3. Initialize MCP Server
const server = new Server(
  { name: "hivegram-web3-bridge", version: "2.0.0-cloud" },
  { capabilities: { tools: {} } }
);

// 4. Register the Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_portfolio_balances",
        description: "Get the native SOL balance AND all SPL token balances of a specific Solana wallet address.",
        inputSchema: { type: "object", properties: { walletAddress: { type: "string" } }, required: ["walletAddress"] },
      },
      {
        name: "fetch_asset_metadata",
        description: "Get metadata for a token.",
        inputSchema: { type: "object", properties: { mintAddress: { type: "string" } }, required: ["mintAddress"] },
      },
      {
        name: "analyze_token_metrics",
        description: "Audit a token for rug-pull risks.",
        inputSchema: { type: "object", properties: { mintAddress: { type: "string" } }, required: ["mintAddress"] },
      },
      {
        name: "resolve_web3_domain",
        description: "Translate .sol domain to wallet address.",
        inputSchema: { type: "object", properties: { domain: { type: "string" } }, required: ["domain"] },
      },
      {
        name: "simulate_transaction",
        description: "Simulate a token swap on Jupiter.",
        inputSchema: {
          type: "object",
          properties: {
            outputMint: { type: "string" },
            inputAmount: { type: "number" },
            inputMint: { type: "string" },
          },
          required: ["outputMint", "inputAmount"],
        },
      }
    ],
  };
});

// 5. Tool Execution Logic
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  
  if (request.params.name === "get_portfolio_balances") {
    const walletAddress = request.params.arguments?.walletAddress as string;
    const pubKey = new PublicKey(walletAddress);
    const rawBalance = await solanaConnection.getBalance(pubKey);
    const solBalance = rawBalance / LAMPORTS_PER_SOL;
    const standardTokens = await solanaConnection.getParsedTokenAccountsByOwner(pubKey, { programId: TOKEN_PROGRAM_ID });
    const token2022 = await solanaConnection.getParsedTokenAccountsByOwner(pubKey, { programId: TOKEN_2022_PROGRAM_ID });
    const allTokens = [...standardTokens.value, ...token2022.value];
    const formattedTokens = allTokens.map((accountInfo) => {
        const parsedInfo = accountInfo.account.data.parsed.info;
        return { mint_address: parsedInfo.mint, balance: parsedInfo.tokenAmount.uiAmount };
      }).filter((token) => token.balance > 0);
    return { content: [{ type: "text", text: JSON.stringify({ wallet: walletAddress, sol_balance: solBalance, tokens: formattedTokens }, null, 2) }] };
  }

  if (request.params.name === "fetch_asset_metadata") {
    const mintAddress = request.params.arguments?.mintAddress as string;
    const response = await fetch(RPC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'getAsset', params: { id: mintAddress } }) });
    const data: any = await response.json();
    return { content: [{ type: "text", text: JSON.stringify(data.result, null, 2) }] };
  }

  if (request.params.name === "analyze_token_metrics") {
    const mintAddress = request.params.arguments?.mintAddress as string;
    const accountInfo = await solanaConnection.getParsedAccountInfo(new PublicKey(mintAddress));
    const parsedInfo = (accountInfo.value?.data as any).parsed.info;
    return { content: [{ type: "text", text: JSON.stringify({ mint: mintAddress, mint_authority: parsedInfo.mintAuthority, freeze_authority: parsedInfo.freezeAuthority }, null, 2) }] };
  }

  if (request.params.name === "resolve_web3_domain") {
    let domain = (request.params.arguments?.domain as string).replace(".sol", "");
    const { pubkey } = await getDomainKey(domain);
    const registry = await NameRegistryState.retrieve(solanaConnection, pubkey);
    return { content: [{ type: "text", text: JSON.stringify({ domain: `${domain}.sol`, wallet: registry.registry.owner.toBase58() }, null, 2) }] };
  }

  if (request.params.name === "simulate_transaction") {
    try {
      const outputMint = request.params.arguments?.outputMint as string;
      const inputAmount = request.params.arguments?.inputAmount as number;
      const inputMint = request.params.arguments?.inputMint as string || SOL_MINT;

      const rawAmount = Math.floor(inputAmount * Math.pow(10, 9));
      const hostname = 'public.jupiterapi.com';
      const path = `/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${rawAmount}&slippageBps=50`;
      
      return new Promise((resolve) => {
        const options = { hostname, path, method: 'GET', headers: { 'User-Agent': 'Hivegram-Bridge/2.0', 'Accept': 'application/json' }};
        const req = https.get(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const quote = JSON.parse(data);
              if (!quote.outAmount) { resolve({ content: [{ type: "text", text: `Jupiter: ${quote.message || "No liquid route."}` }], isError: true }); return; }
              resolve({ content: [{ type: "text", text: JSON.stringify({ spend: `${inputAmount} SOL`, receive_raw: quote.outAmount, price_impact: quote.priceImpactPct ? `${parseFloat(quote.priceImpactPct) * 100}%` : "0.00%", route: quote.routePlan ? quote.routePlan.map((s: any) => s.swapInfo.label).join(" -> ") : "Direct" }, null, 2) }]});
            } catch (e) { resolve({ content: [{ type: "text", text: "Parse error." }], isError: true }); }
          });
        });
        req.on('error', (error) => resolve({ content: [{ type: "text", text: `Network Error: ${error.message}` }], isError: true }));
      });
    } catch (error: any) { return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true }; }
  }

  throw new Error("Tool not found");
});

// 6. Start the Express Web Server (Cloud & Render Ready)
const app = express();
app.use(cors()); // Security: allows AI agents from any URL to connect to this server

let transport: SSEServerTransport;

// Endpoint 1: The AI connects here to establish a live stream
app.get("/sse", async (req, res) => {
  transport = new SSEServerTransport("/message", res);
  await server.connect(transport);
});

// Endpoint 2: The AI posts its tool requests here
app.post("/message", express.json(), async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(500).send("Server connection not established.");
  }
});

// Use the dynamic port provided by the hosting service, or 3000 locally
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Hivegram Web3 Bridge is LIVE on port ${PORT}`);
  console.log(`🔌 SSE Endpoint ready at: http://localhost:${PORT}/sse`);
});