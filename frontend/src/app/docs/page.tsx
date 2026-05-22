"use client";

import { useState } from "react";
import { 
  Book, Code, Terminal, Zap, FileText, ChevronRight, 
  Rocket, Wallet, PlayCircle, Cloud, Map, CheckCircle
} from "lucide-react";
import { motion } from "framer-motion";

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("getting-started");

  const sections = [
    { id: "getting-started", icon: Rocket, label: "Getting Started" },
    { id: "overview", icon: Book, label: "Overview" },
    { id: "architecture", icon: Zap, label: "Architecture" },
    { id: "contracts", icon: Code, label: "Smart Contracts" },
    { id: "wallet", icon: Wallet, label: "Wallet Integration" },
    { id: "api", icon: FileText, label: "API / SDK Layer" },
    { id: "usage", icon: PlayCircle, label: "Usage Guide" },
    { id: "deployment", icon: Cloud, label: "Deployment" },
    { id: "roadmap", icon: Map, label: "Roadmap" },
  ];

  return (
    <div className="flex min-h-[calc(100vh-80px)] bg-[#09090b]">
      {/* Docs Sidebar */}
      <aside className="w-72 hidden md:block border-r border-white/5 glass bg-black/40 pt-8 pb-4 overflow-y-auto">
        <div className="px-6 mb-6">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Documentation</h2>
          <p className="text-gray-400 text-sm mt-1">SoroMint Platform v1.0</p>
        </div>
        <nav className="space-y-1.5 px-3">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm font-medium ${
                activeSection === section.id 
                  ? "bg-blue-600/20 text-blue-400 border border-blue-500/20 shadow-sm" 
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <section.icon className={`w-4 h-4 ${activeSection === section.id ? "text-blue-400" : "text-gray-500"}`} />
              {section.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Docs Content */}
      <main className="flex-1 p-6 md:p-12 lg:p-16 max-w-5xl mx-auto overflow-y-auto">
        <motion.div
          key={activeSection}
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="prose prose-invert prose-blue max-w-none prose-pre:bg-[#1e1e1e] prose-pre:border prose-pre:border-white/10"
        >
          {activeSection === "getting-started" && (
            <div>
              <div className="flex items-center gap-2 text-sm text-blue-400 font-bold mb-4 uppercase tracking-wider">
                <Rocket className="w-4 h-4" /> Getting Started
              </div>
              <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-6 tracking-tight">Project Setup & Installation</h1>
              <p className="text-gray-300 text-lg leading-relaxed mb-8">
                Welcome to SoroMint. This guide will walk you through setting up the project locally so you can start building, testing, and deploying assets on the Stellar network using Soroban.
              </p>

              <h2 className="text-2xl font-bold text-white mt-10 mb-4 border-b border-white/10 pb-2">1. Prerequisites</h2>
              <ul className="space-y-3 text-gray-300 list-disc pl-6 mb-8">
                <li>Node.js (v18+ recommended)</li>
                <li>Rust toolchain (for smart contracts)</li>
                <li>Soroban CLI installed</li>
                <li>A Stellar Freighter wallet extension installed in your browser</li>
              </ul>

              <h2 className="text-2xl font-bold text-white mt-10 mb-4 border-b border-white/10 pb-2">2. Installation Steps</h2>
              <div className="bg-[#1e1e1e] p-4 rounded-xl font-mono text-sm mt-1 text-gray-300 border border-white/10 mb-8 shadow-lg">
                <span className="text-gray-500"># Clone the repository</span><br/>
                git clone https://github.com/soromint/soromint.git<br/>
                cd soromint<br/><br/>
                <span className="text-gray-500"># Install frontend dependencies</span><br/>
                cd frontend<br/>
                npm install
              </div>

              <h2 className="text-2xl font-bold text-white mt-10 mb-4 border-b border-white/10 pb-2">3. Environment Variables</h2>
              <p className="text-gray-300 mb-4">Create a <code>.env.local</code> file in the <code>frontend</code> directory with the following configuration:</p>
              <div className="bg-[#1e1e1e] p-4 rounded-xl font-mono text-sm text-gray-300 border border-white/10 mb-8 shadow-lg">
                NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org<br/>
                NEXT_PUBLIC_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"<br/>
                NEXT_PUBLIC_FACTORY_CONTRACT_ID=C...
              </div>

              <h2 className="text-2xl font-bold text-white mt-10 mb-4 border-b border-white/10 pb-2">4. Running Locally</h2>
              <div className="bg-[#1e1e1e] p-4 rounded-xl font-mono text-sm mt-1 text-gray-300 border border-white/10 shadow-lg">
                npm run dev
              </div>
              <p className="text-gray-300 mt-4">
                The application will be available at <a href="http://localhost:3000" className="text-blue-400 hover:underline">http://localhost:3000</a>.
              </p>
            </div>
          )}

          {activeSection === "overview" && (
            <div>
              <div className="flex items-center gap-2 text-sm text-blue-400 font-bold mb-4 uppercase tracking-wider">
                <Book className="w-4 h-4" /> Overview
              </div>
              <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-6 tracking-tight">Introduction to SoroMint</h1>
              <p className="text-gray-300 text-lg leading-relaxed mb-8">
                SoroMint is a production-grade Web3 platform designed for the Stellar ecosystem. It leverages Soroban smart contracts to enable seamless minting, management, and distribution of digital assets with unprecedented speed and low transaction costs.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-10">
                <div className="p-6 rounded-2xl border border-white/10 glass hover:bg-white/5 transition-all shadow-lg">
                  <h3 className="text-xl font-bold text-white mb-3">For Creators</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">Launch collections without writing a single line of code through our intuitive dashboard. Manage metadata, track analytics, and handle royalties effortlessly.</p>
                </div>
                <div className="p-6 rounded-2xl border border-white/10 glass hover:bg-white/5 transition-all shadow-lg">
                  <h3 className="text-xl font-bold text-white mb-3">For Developers</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">Integrate our Soroban contracts directly into your own applications via the SoroMint SDK. Built on open standards for maximum interoperability.</p>
                </div>
              </div>
              
              <h2 className="text-2xl font-bold text-white mt-12 mb-6 border-b border-white/10 pb-2">Core Concepts</h2>
              <ul className="space-y-4 text-gray-300">
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-400 shrink-0 mt-0.5" /> 
                  <div>
                    <strong className="text-white block mb-1">Asset Tokenization</strong>
                    <span className="text-gray-400 text-sm">Represent physical or digital goods as Soroban-native tokens on the Stellar network.</span>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-400 shrink-0 mt-0.5" /> 
                  <div>
                    <strong className="text-white block mb-1">Factory Pattern</strong>
                    <span className="text-gray-400 text-sm">A centralized contract spawns individual asset contracts, ensuring standardized logic and security.</span>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-400 shrink-0 mt-0.5" /> 
                  <div>
                    <strong className="text-white block mb-1">Decentralized Storage</strong>
                    <span className="text-gray-400 text-sm">Asset metadata is pinned to IPFS/Arweave, mapping a deterministic URI inside the smart contract.</span>
                  </div>
                </li>
              </ul>
            </div>
          )}

          {activeSection === "architecture" && (
            <div>
              <div className="flex items-center gap-2 text-sm text-purple-400 font-bold mb-4 uppercase tracking-wider">
                <Zap className="w-4 h-4" /> Architecture
              </div>
              <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-6 tracking-tight">System Architecture</h1>
              <p className="text-gray-300 text-lg leading-relaxed mb-8">
                SoroMint utilizes a modern, modular Web3 stack optimized for high throughput, minimal latency, and robust security.
              </p>
              
              <div className="p-8 rounded-2xl border border-white/10 bg-black/50 mb-10 overflow-x-auto shadow-2xl relative">
                <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5 pointer-events-none"></div>
                <pre className="text-gray-300 font-mono text-sm leading-loose">
{`  [ Next.js Frontend ] <======= (Freighter / WalletConnect) =======> [ User Wallet ]
         |
         |  (RPC / API)
         v
  [ SoroMint Backend ] <===========================================> [ IPFS / Arweave ]
         |                                                               (Metadata)
         |
         v
[ Soroban RPC Node ]
         |
         v
[ Stellar Core Network ] <--- [ Factory Contract ] ---> [ Asset Contract A, B, C ]`}
                </pre>
              </div>

              <h3 className="text-2xl font-bold text-white mb-6 border-b border-white/10 pb-2">Frontend Structure</h3>
              <div className="space-y-4 mb-10">
                <div className="p-5 rounded-xl bg-white/5 border border-white/5">
                  <h4 className="font-bold text-white flex items-center gap-2"><Code className="w-4 h-4 text-blue-400"/> Next.js App Router</h4>
                  <p className="text-sm text-gray-400 mt-2">Server-side rendering where applicable, optimizing SEO for the landing page while preserving client-side interactivity for the dashboard.</p>
                </div>
                <div className="p-5 rounded-xl bg-white/5 border border-white/5">
                  <h4 className="font-bold text-white flex items-center gap-2"><Terminal className="w-4 h-4 text-blue-400"/> State Management</h4>
                  <p className="text-sm text-gray-400 mt-2">Utilizing React Context and Zustand for global state (e.g., wallet connection status, active network).</p>
                </div>
                <div className="p-5 rounded-xl bg-white/5 border border-white/5">
                  <h4 className="font-bold text-white flex items-center gap-2"><FileText className="w-4 h-4 text-blue-400"/> Folder Structure</h4>
                  <p className="text-sm text-gray-400 mt-2 font-mono text-xs mt-3">
                    /src<br/>
                    &nbsp;&nbsp;├── app/          # App Router pages<br/>
                    &nbsp;&nbsp;├── components/   # Reusable UI components<br/>
                    &nbsp;&nbsp;├── lib/          # Utilities and SDK wrappers<br/>
                    &nbsp;&nbsp;└── hooks/        # Custom React hooks
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeSection === "contracts" && (
            <div>
              <div className="flex items-center gap-2 text-sm text-green-400 font-bold mb-4 uppercase tracking-wider">
                <Code className="w-4 h-4" /> Smart Contracts
              </div>
              <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-6 tracking-tight">Smart Contract Layer</h1>
              <p className="text-gray-300 text-lg leading-relaxed mb-8">
                Our Soroban contracts are written in Rust, adhering strictly to the Stellar Asset Contract (SAC) interfaces to ensure out-of-the-box compatibility with Stellar wallets and DEXs.
              </p>
              
              <h3 className="text-2xl font-bold text-white mb-4 border-b border-white/10 pb-2">Structure & Interactions</h3>
              <p className="text-gray-300 mb-6">
                The architecture relies on a Factory pattern. The frontend interacts directly with the Factory contract to deploy new instances of the Asset contract.
              </p>

              <div className="mb-8 shadow-2xl rounded-xl overflow-hidden border border-white/10">
                <div className="bg-black/80 px-4 py-2 border-b border-white/10 flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <span className="text-xs text-gray-400 ml-2 font-mono">src/asset_contract.rs</span>
                </div>
                <div className="bg-[#1e1e1e] p-6 overflow-x-auto">
                  <pre className="text-sm text-green-400/90 font-mono"><code>{`#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, String, Address};

#[contract]
pub struct AssetMintContract;

#[contractimpl]
impl AssetMintContract {
    /// Initializes the asset with admin, name, and symbol.
    pub fn initialize(env: Env, admin: Address, name: String, symbol: String) {
        admin.require_auth();
        // Storage initialization logic...
    }
    
    /// Mints a specified amount to a target address.
    pub fn mint(env: Env, to: Address, amount: i128) {
        // Enforce admin auth
        // Update total supply
        // Minting logic integrating with SAC
    }
}`}</code></pre>
                </div>
              </div>

              <h3 className="text-2xl font-bold text-white mb-4 border-b border-white/10 pb-2">Network Abstraction</h3>
              <p className="text-gray-300">
                The frontend dynamically resolves the correct contract addresses based on the connected wallet's network (Testnet vs Mainnet) using environment variable mappings.
              </p>
            </div>
          )}

          {activeSection === "wallet" && (
            <div>
              <div className="flex items-center gap-2 text-sm text-orange-400 font-bold mb-4 uppercase tracking-wider">
                <Wallet className="w-4 h-4" /> Wallet Integration
              </div>
              <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-6 tracking-tight">Wallet Connection</h1>
              <p className="text-gray-300 text-lg leading-relaxed mb-8">
                SoroMint supports seamless connection with the Freighter wallet. The integration manages session states, network switching, and transaction signing.
              </p>

              <h3 className="text-2xl font-bold text-white mb-4 border-b border-white/10 pb-2">Authentication Lifecycle</h3>
              <ol className="space-y-6 text-gray-300 list-decimal pl-5 marker:text-orange-500">
                <li className="pl-2">
                  <strong className="text-white">Connection Request:</strong> User clicks "Connect Wallet". The app triggers `@stellar/freighter-api` to request access.
                </li>
                <li className="pl-2">
                  <strong className="text-white">Network Validation:</strong> The app checks if the user is on the required network (e.g., Testnet). If not, it prompts a network switch.
                </li>
                <li className="pl-2">
                  <strong className="text-white">Session State:</strong> The public key is stored in a React Context, making it available globally across the application.
                </li>
                <li className="pl-2">
                  <strong className="text-white">Transaction Signing:</strong> When an action (like minting) occurs, an XDR transaction is built, simulated, and passed to Freighter for signature.
                </li>
              </ol>
            </div>
          )}

          {activeSection === "api" && (
            <div>
              <div className="flex items-center gap-2 text-sm text-yellow-400 font-bold mb-4 uppercase tracking-wider">
                <FileText className="w-4 h-4" /> API / SDK Layer
              </div>
              <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-6 tracking-tight">API & SDK</h1>
              <p className="text-gray-300 text-lg leading-relaxed mb-6">
                Interact with SoroMint programmatically using our REST endpoints or TypeScript SDK.
              </p>
              
              <div className="p-6 border border-yellow-500/30 bg-yellow-500/5 rounded-xl mb-10 flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center shrink-0">
                  <span className="text-yellow-500 text-lg font-bold">!</span>
                </div>
                <div>
                  <h3 className="text-yellow-500 font-bold mb-1">Alpha Notice</h3>
                  <p className="text-sm text-yellow-500/80 leading-relaxed">The API and SDK are currently in Alpha. Response schemas and endpoints are subject to change prior to the stable v1.0 release.</p>
                </div>
              </div>
              
              <h3 className="text-2xl font-bold text-white mb-6 border-b border-white/10 pb-2">REST Endpoints Placeholder</h3>
              <div className="space-y-4">
                <div className="p-5 rounded-xl bg-[#121214] border border-white/5 flex flex-col md:flex-row md:items-center gap-4 shadow-md">
                  <span className="px-3 py-1.5 rounded-md bg-blue-500/20 text-blue-400 text-xs font-mono font-bold w-fit">GET</span>
                  <span className="font-mono text-sm text-gray-200 flex-1">/api/v1/collections</span>
                  <span className="text-xs text-gray-500">Retrieves all public collections.</span>
                </div>
                <div className="p-5 rounded-xl bg-[#121214] border border-white/5 flex flex-col md:flex-row md:items-center gap-4 shadow-md">
                  <span className="px-3 py-1.5 rounded-md bg-green-500/20 text-green-400 text-xs font-mono font-bold w-fit">POST</span>
                  <span className="font-mono text-sm text-gray-200 flex-1">/api/v1/mint</span>
                  <span className="text-xs text-gray-500">Initiates an off-chain mint request.</span>
                </div>
                <div className="p-5 rounded-xl bg-[#121214] border border-white/5 flex flex-col md:flex-row md:items-center gap-4 shadow-md">
                  <span className="px-3 py-1.5 rounded-md bg-blue-500/20 text-blue-400 text-xs font-mono font-bold w-fit">GET</span>
                  <span className="font-mono text-sm text-gray-200 flex-1">/api/v1/assets/:id</span>
                  <span className="text-xs text-gray-500">Fetches metadata for a specific asset.</span>
                </div>
              </div>
            </div>
          )}

          {activeSection === "usage" && (
            <div>
              <div className="flex items-center gap-2 text-sm text-teal-400 font-bold mb-4 uppercase tracking-wider">
                <PlayCircle className="w-4 h-4" /> Usage Guide
              </div>
              <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-6 tracking-tight">Step-by-Step User Flows</h1>
              
              <h3 className="text-2xl font-bold text-white mt-10 mb-4 border-b border-white/10 pb-2">1. Create an Asset</h3>
              <p className="text-gray-300 mb-4">Initialize a new token or NFT collection.</p>
              <ul className="list-disc pl-5 space-y-2 text-gray-400 mb-8">
                <li>Navigate to the Dashboard.</li>
                <li>Click <strong>"Mint New Asset"</strong>.</li>
                <li>Fill out the metadata: Name, Symbol, and Description.</li>
                <li>Confirm the transaction in your wallet. This deploys a new contract instance.</li>
              </ul>

              <h3 className="text-2xl font-bold text-white mt-10 mb-4 border-b border-white/10 pb-2">2. Mint Assets</h3>
              <p className="text-gray-300 mb-4">Mint supply into your newly created collection.</p>
              <ul className="list-disc pl-5 space-y-2 text-gray-400 mb-8">
                <li>Select the collection from your Dashboard.</li>
                <li>Click <strong>"Mint Supply"</strong>.</li>
                <li>Enter the recipient address and amount.</li>
                <li>Sign the transaction.</li>
              </ul>

              <h3 className="text-2xl font-bold text-white mt-10 mb-4 border-b border-white/10 pb-2">3. Manage Assets</h3>
              <p className="text-gray-300 mb-4">View and track your assets on-chain.</p>
              <ul className="list-disc pl-5 space-y-2 text-gray-400">
                <li>Use the Activity Table in the Dashboard to monitor statuses (Pending, Success).</li>
                <li>Click on the Tx Hash to view the transaction on a Stellar Explorer.</li>
              </ul>
            </div>
          )}

          {activeSection === "deployment" && (
            <div>
              <div className="flex items-center gap-2 text-sm text-cyan-400 font-bold mb-4 uppercase tracking-wider">
                <Cloud className="w-4 h-4" /> Deployment
              </div>
              <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-6 tracking-tight">Production Deployment</h1>
              
              <h3 className="text-2xl font-bold text-white mt-10 mb-4 border-b border-white/10 pb-2">Frontend Deployment</h3>
              <p className="text-gray-300 mb-4">The Next.js frontend is optimized for deployment on Vercel.</p>
              <div className="bg-[#1e1e1e] p-4 rounded-xl font-mono text-sm text-gray-300 border border-white/10 mb-8">
                npx vercel --prod
              </div>
              <p className="text-gray-300 text-sm">Ensure you set all <code>NEXT_PUBLIC_</code> environment variables in the Vercel dashboard.</p>

              <h3 className="text-2xl font-bold text-white mt-10 mb-4 border-b border-white/10 pb-2">Contract Deployment</h3>
              <p className="text-gray-300 mb-4">Deploying Soroban contracts to Mainnet requires the Soroban CLI.</p>
              <div className="bg-[#1e1e1e] p-4 rounded-xl font-mono text-sm text-gray-300 border border-white/10 mb-8">
                soroban contract deploy \<br/>
                &nbsp;&nbsp;--wasm target/wasm32-unknown-unknown/release/asset_contract.wasm \<br/>
                &nbsp;&nbsp;--source admin_identity \<br/>
                &nbsp;&nbsp;--network mainnet
              </div>
            </div>
          )}

          {activeSection === "roadmap" && (
            <div>
              <div className="flex items-center gap-2 text-sm text-pink-400 font-bold mb-4 uppercase tracking-wider">
                <Map className="w-4 h-4" /> Roadmap
              </div>
              <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-6 tracking-tight">Product Roadmap</h1>
              <p className="text-gray-300 text-lg leading-relaxed mb-10">
                Our vision is to become the defacto standard for asset issuance on Stellar. Here is our planned trajectory.
              </p>

              <div className="relative border-l border-white/10 pl-8 space-y-12 pb-12">
                <div className="relative">
                  <div className="absolute -left-[41px] top-1 w-5 h-5 rounded-full bg-blue-500 border-4 border-[#09090b]"></div>
                  <h3 className="text-xl font-bold text-white mb-2">Q3 2026: The Foundation (Current)</h3>
                  <p className="text-gray-400">Launch of the Core Platform on Testnet. Basic NFT and Token minting capabilities, Freighter integration, and comprehensive documentation.</p>
                </div>
                
                <div className="relative">
                  <div className="absolute -left-[41px] top-1 w-5 h-5 rounded-full bg-gray-600 border-4 border-[#09090b]"></div>
                  <h3 className="text-xl font-bold text-white mb-2">Q4 2026: Advanced Tooling</h3>
                  <p className="text-gray-400">Mainnet launch. Introduction of the TypeScript SDK, programmatic API endpoints, and batch minting for enterprise use-cases.</p>
                </div>

                <div className="relative">
                  <div className="absolute -left-[41px] top-1 w-5 h-5 rounded-full bg-gray-600 border-4 border-[#09090b]"></div>
                  <h3 className="text-xl font-bold text-white mb-2">Q1 2027: Ecosystem Expansion</h3>
                  <p className="text-gray-400">Cross-chain bridging capabilities, advanced analytics dashboard, and decentralized metadata pinning service.</p>
                </div>
              </div>
            </div>
          )}

        </motion.div>
      </main>
    </div>
  );
}
