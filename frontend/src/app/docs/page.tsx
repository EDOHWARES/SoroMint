"use client";

import { useState } from "react";
import { Book, Code, Terminal, Zap, FileText, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("overview");

  const sections = [
    { id: "overview", icon: Book, label: "Project Overview" },
    { id: "architecture", icon: Zap, label: "Architecture" },
    { id: "contracts", icon: Code, label: "Smart Contracts" },
    { id: "setup", icon: Terminal, label: "Setup Instructions" },
    { id: "api", icon: FileText, label: "API & SDK" },
  ];

  return (
    <div className="flex min-h-[calc(100vh-80px)]">
      {/* Docs Sidebar */}
      <aside className="w-64 hidden md:block border-r border-white/5 glass bg-black/40 pt-8 pb-4">
        <div className="px-6 mb-4">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Documentation</h2>
        </div>
        <nav className="space-y-1 px-3">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-sm ${
                activeSection === section.id 
                  ? "bg-white/10 text-white font-medium" 
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <section.icon className={`w-4 h-4 ${activeSection === section.id ? "text-blue-400" : ""}`} />
              {section.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Docs Content */}
      <main className="flex-1 p-6 md:p-12 max-w-4xl">
        <motion.div
          key={activeSection}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="prose prose-invert prose-blue max-w-none"
        >
          {activeSection === "overview" && (
            <div>
              <div className="flex items-center gap-2 text-sm text-blue-400 font-medium mb-4">
                <Book className="w-4 h-4" /> Overview
              </div>
              <h1 className="text-4xl font-bold text-white mb-6">Introduction to SoroMint</h1>
              <p className="text-gray-300 text-lg leading-relaxed mb-8">
                SoroMint is a comprehensive platform built on the Stellar blockchain, utilizing Soroban smart contracts to enable seamless minting, management, and distribution of digital assets.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-8">
                <div className="p-5 rounded-xl border border-white/10 bg-white/5">
                  <h3 className="text-lg font-semibold text-white mb-2">For Creators</h3>
                  <p className="text-gray-400 text-sm">Launch collections without writing a single line of code through our intuitive dashboard.</p>
                </div>
                <div className="p-5 rounded-xl border border-white/10 bg-white/5">
                  <h3 className="text-lg font-semibold text-white mb-2">For Developers</h3>
                  <p className="text-gray-400 text-sm">Integrate our Soroban contracts directly into your own applications via the SoroMint SDK.</p>
                </div>
              </div>
              
              <h2 className="text-2xl font-semibold text-white mt-10 mb-4">Key Capabilities</h2>
              <ul className="space-y-3 text-gray-300">
                <li className="flex items-start gap-2"><ChevronRight className="w-5 h-5 text-blue-400 shrink-0" /> Turnkey NFT and Token minting on Stellar</li>
                <li className="flex items-start gap-2"><ChevronRight className="w-5 h-5 text-blue-400 shrink-0" /> Native Soroban contract integration for custom logic</li>
                <li className="flex items-start gap-2"><ChevronRight className="w-5 h-5 text-blue-400 shrink-0" /> Batch minting and collection management</li>
                <li className="flex items-start gap-2"><ChevronRight className="w-5 h-5 text-blue-400 shrink-0" /> Decentralized metadata storage solutions</li>
              </ul>
            </div>
          )}

          {activeSection === "architecture" && (
            <div>
              <div className="flex items-center gap-2 text-sm text-purple-400 font-medium mb-4">
                <Zap className="w-4 h-4" /> Architecture
              </div>
              <h1 className="text-4xl font-bold text-white mb-6">System Architecture</h1>
              <p className="text-gray-300 text-lg leading-relaxed mb-8">
                SoroMint uses a modern Web3 stack designed for high throughput, low latency, and absolute security.
              </p>
              
              <div className="p-6 rounded-xl border border-white/10 bg-black/40 mb-8 font-mono text-sm overflow-x-auto text-gray-300">
                <pre>{`[ Frontend (Next.js) ] <---> [ Freighter Wallet ]
        |
        v
[ SoroMint Backend ] <---> [ IPFS / Arweave ]
        |
        v
[ Soroban RPC Node ]
        |
        v
[ Stellar Network (Core) ]`}</pre>
              </div>

              <h3 className="text-xl font-semibold text-white mb-3">Components</h3>
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-white/5 border border-white/5">
                  <h4 className="font-medium text-white">1. Frontend Application</h4>
                  <p className="text-sm text-gray-400 mt-1">Next.js 15 app router for SSR and optimized performance. Uses Tailwind CSS for styling.</p>
                </div>
                <div className="p-4 rounded-lg bg-white/5 border border-white/5">
                  <h4 className="font-medium text-white">2. Smart Contracts (Soroban)</h4>
                  <p className="text-sm text-gray-400 mt-1">Rust-based contracts deployed to the Stellar network implementing SAC (Stellar Asset Contract) interfaces.</p>
                </div>
              </div>
            </div>
          )}

          {activeSection === "contracts" && (
            <div>
              <h1 className="text-4xl font-bold text-white mb-6">Smart Contracts</h1>
              <p className="text-gray-300 mb-6">
                Our Soroban contracts are written in Rust and optimized for low resource consumption.
              </p>
              
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-white mb-2">AssetMintContract</h3>
                <div className="bg-[#1e1e1e] p-4 rounded-xl overflow-x-auto">
                  <pre className="text-sm text-green-400"><code>{`#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, String, Address};

#[contract]
pub struct AssetMintContract;

#[contractimpl]
impl AssetMintContract {
    pub fn initialize(env: Env, admin: Address, name: String, symbol: String) {
        admin.require_auth();
        // Initialization logic
    }
    
    pub fn mint(env: Env, to: Address, amount: i128) {
        // Minting logic integrating with Stellar Asset Contract
    }
}`}</code></pre>
                </div>
              </div>
            </div>
          )}

          {activeSection === "setup" && (
            <div>
              <h1 className="text-4xl font-bold text-white mb-6">Local Setup</h1>
              <p className="text-gray-300 mb-6">Get SoroMint running on your local machine for development.</p>
              
              <ol className="space-y-6 text-gray-300 list-decimal pl-5 marker:text-blue-500">
                <li>
                  <strong className="text-white block mb-2">Clone the repository</strong>
                  <div className="bg-[#1e1e1e] p-3 rounded-lg font-mono text-sm mt-1 text-gray-300">
                    git clone https://github.com/soromint/soromint.git<br/>
                    cd soromint/frontend
                  </div>
                </li>
                <li>
                  <strong className="text-white block mb-2">Install dependencies</strong>
                  <div className="bg-[#1e1e1e] p-3 rounded-lg font-mono text-sm mt-1 text-gray-300">
                    npm install
                  </div>
                </li>
                <li>
                  <strong className="text-white block mb-2">Configure Environment</strong>
                  <p className="text-sm mt-1 mb-2">Create a <code>.env.local</code> file in the frontend directory:</p>
                  <div className="bg-[#1e1e1e] p-3 rounded-lg font-mono text-sm text-gray-300">
                    NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org<br/>
                    NEXT_PUBLIC_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
                  </div>
                </li>
                <li>
                  <strong className="text-white block mb-2">Run the development server</strong>
                  <div className="bg-[#1e1e1e] p-3 rounded-lg font-mono text-sm mt-1 text-gray-300">
                    npm run dev
                  </div>
                </li>
              </ol>
            </div>
          )}

          {activeSection === "api" && (
            <div>
              <h1 className="text-4xl font-bold text-white mb-6">API & SDK</h1>
              <div className="p-6 border border-yellow-500/20 bg-yellow-500/10 rounded-xl mb-8 flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center shrink-0">
                  <span className="text-yellow-500 text-sm font-bold">!</span>
                </div>
                <div>
                  <h3 className="text-yellow-500 font-medium mb-1">Under Construction</h3>
                  <p className="text-sm text-yellow-500/80">The SoroMint TypeScript SDK is currently in Alpha. APIs may change before the stable v1.0 release.</p>
                </div>
              </div>
              
              <h3 className="text-xl font-semibold text-white mb-4">REST Endpoints Placeholder</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-4 p-3 rounded-lg bg-white/5 border border-white/5">
                  <span className="px-2 py-1 rounded bg-blue-500/20 text-blue-400 text-xs font-mono font-bold">GET</span>
                  <span className="font-mono text-sm text-gray-300">/api/v1/collections</span>
                </div>
                <div className="flex items-center gap-4 p-3 rounded-lg bg-white/5 border border-white/5">
                  <span className="px-2 py-1 rounded bg-green-500/20 text-green-400 text-xs font-mono font-bold">POST</span>
                  <span className="font-mono text-sm text-gray-300">/api/v1/mint</span>
                </div>
                <div className="flex items-center gap-4 p-3 rounded-lg bg-white/5 border border-white/5">
                  <span className="px-2 py-1 rounded bg-blue-500/20 text-blue-400 text-xs font-mono font-bold">GET</span>
                  <span className="font-mono text-sm text-gray-300">/api/v1/assets/:id</span>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
}
