"use client";

import { motion } from "framer-motion";
import { LayoutDashboard, Coins, History, Settings, Plus, ArrowUpRight, Search, Wallet } from "lucide-react";
import { useState } from "react";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="flex min-h-[calc(100vh-80px)]">
      {/* Sidebar */}
      <aside className="w-64 hidden md:flex flex-col border-r border-white/5 glass bg-black/40 p-4">
        <div className="mb-8 px-4">
          <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-600/20 border border-blue-500/20 mb-2">
            <p className="text-xs text-gray-400 mb-1">Connected Wallet</p>
            <p className="text-sm font-mono text-white flex items-center justify-between">
              GDFR...X9LM <Wallet className="w-3 h-3 text-blue-400" />
            </p>
          </div>
        </div>

        <nav className="flex-1 space-y-2">
          {[
            { id: "overview", icon: LayoutDashboard, label: "Overview" },
            { id: "assets", icon: Coins, label: "My Assets" },
            { id: "activity", icon: History, label: "Mint Activity" },
            { id: "settings", icon: Settings, label: "Settings" },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === item.id 
                  ? "bg-blue-600/20 text-blue-400 border border-blue-500/20" 
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-8">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-white">Dashboard Overview</h1>
              <p className="text-gray-400 text-sm mt-1">Manage your Soroban assets and track minting activity.</p>
            </div>
            <button className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-full font-medium flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 transition-all">
              <Plus className="w-4 h-4" />
              Mint New Asset
            </button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { label: "Total Assets Minted", value: "24", change: "+3 this week" },
              { label: "Total Volume (XLM)", value: "1,250", change: "+12.5% this week" },
              { label: "Active Collections", value: "3", change: "1 pending deploy" },
            ].map((stat, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="p-6 rounded-2xl glass-card border border-white/5"
              >
                <p className="text-gray-400 text-sm font-medium mb-2">{stat.label}</p>
                <h3 className="text-3xl font-bold text-white mb-2">{stat.value}</h3>
                <div className="flex items-center gap-1 text-xs text-green-400">
                  <ArrowUpRight className="w-3 h-3" />
                  {stat.change}
                </div>
              </motion.div>
            ))}
          </div>

          {/* Activity Table */}
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="rounded-2xl glass-card border border-white/5 overflow-hidden"
          >
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Recent Mint Activity</h3>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input 
                  type="text" 
                  placeholder="Search assets..." 
                  className="bg-white/5 border border-white/10 rounded-full pl-9 pr-4 py-1.5 text-sm focus:outline-none focus:border-blue-500/50 text-white w-48 md:w-64 transition-all"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/5 text-gray-400 text-xs uppercase tracking-wider">
                    <th className="p-4 font-medium">Asset Name</th>
                    <th className="p-4 font-medium">Type</th>
                    <th className="p-4 font-medium">Date</th>
                    <th className="p-4 font-medium">Status</th>
                    <th className="p-4 font-medium">Tx Hash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-sm text-gray-300">
                  {[
                    { name: "Galactic Pass #042", type: "NFT", date: "2 mins ago", status: "Success", hash: "a1b2...9f0" },
                    { name: "SoroToken (SRT)", type: "Token", date: "5 hours ago", status: "Success", hash: "c3d4...8e1" },
                    { name: "Stellar Builders", type: "Collection", date: "1 day ago", status: "Pending", hash: "e5f6...7d2" },
                    { name: "Testnet Faucet", type: "Token", date: "2 days ago", status: "Success", hash: "g7h8...6c3" },
                  ].map((row, i) => (
                    <tr key={i} className="hover:bg-white/5 transition-colors">
                      <td className="p-4 flex items-center gap-3 font-medium text-white">
                        <div className="w-8 h-8 rounded bg-gradient-to-br from-blue-500/40 to-purple-500/40 border border-white/10"></div>
                        {row.name}
                      </td>
                      <td className="p-4">{row.type}</td>
                      <td className="p-4 text-gray-400">{row.date}</td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium border ${
                          row.status === 'Success' 
                            ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                            : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                        }`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="p-4 text-blue-400 font-mono hover:underline cursor-pointer">{row.hash}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
