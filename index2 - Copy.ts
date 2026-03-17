import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getDomainKey, NameRegistryState } from "@bonfida/spl-name-service";
import * as dotenv from "dotenv";
import https from "node:https"; // <--- Standard Node.js HTTPS module

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

// 3. Initialize Server
const server = new Server(
  { name: "hivegram-web3-bridge", version: "1.6.0" },
  { capabilities: { tools: {} } }
);

// Helper function to make bulletproof HTTPS requests
function secureRequest(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("Failed to parse Jupiter response")); }
      });
    }).on('error', (err) => reject(err));
  });
}

// 4. Register the Tools (Keep these exactly as they were)
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
  
  // (Portfolio, Metadata, Audit, Domain code stays exactly same as before...)
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

  // --- FINAL V1.6.2: 2026 PUBLIC ENDPOINT UPGRADE ---
  if (request.params.name === "simulate_transaction") {
    try {
      const outputMint = request.params.arguments?.outputMint as string;
      const inputAmount = request.params.arguments?.inputAmount as number;
      const inputMint = request.params.arguments?.inputMint as string || SOL_MINT;

      const rawAmount = Math.floor(inputAmount * Math.pow(10, 9));
      
      // 2026 Public community endpoint for keyless use
      const hostname = 'public.jupiterapi.com';
      const path = `/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${rawAmount}&slippageBps=50`;
      
      return new Promise((resolve) => {
        const options = {
          hostname: hostname,
          path: path,
          method: 'GET',
          headers: {
            'User-Agent': 'Hivegram-Bridge/1.6.2',
            'Accept': 'application/json'
          }
        };

        const req = https.get(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const quote = JSON.parse(data);
              
              if (!quote.outAmount) {
                resolve({ 
                  content: [{ type: "text", text: `Jupiter: ${quote.message || "No liquid route found for this amount."}` }], 
                  isError: true 
                });
                return;
              }

              resolve({
                content: [{ 
                  type: "text", 
                  text: JSON.stringify({
                    spend: `${inputAmount} SOL`,
                    receive_raw: quote.outAmount,
                    price_impact: quote.priceImpactPct ? `${parseFloat(quote.priceImpactPct) * 100}%` : "0.00%",
                    route: quote.routePlan ? quote.routePlan.map((s: any) => s.swapInfo.label).join(" -> ") : "Direct Route"
                  }, null, 2) 
                }]
              });
            } catch (e) {
              resolve({ content: [{ type: "text", text: "Error parsing the Public Jupiter response." }], isError: true });
            }
          });
        });

        req.on('error', (error) => {
          resolve({ content: [{ type: "text", text: `Network Error: ${error.message}` }], isError: true });
        });
      });

    } catch (error: any) {
      return { content: [{ type: "text", text: `Simulation Error: ${error.message}` }], isError: true };
    }
  }

  throw new Error("Tool not found");
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Hivegram V1.6 Live - Secure Network Stack Deployed.");
}

main().catch(console.error);