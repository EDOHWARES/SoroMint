"use client";

import { motion } from "framer-motion";
import { ArrowRight, Zap, Shield, Wallet, Layers, BarChart, Rocket } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

export default function Home() {
  return (
    <div className="flex flex-col gap-24 pb-20">
      {/* Hero Section */}
      <section className="relative pt-20 pb-12 px-6 lg:pt-32 lg:pb-24 max-w-7xl mx-auto w-full flex flex-col items-center text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-medium mb-8">
            <span className="flex h-2 w-2 rounded-full bg-blue-500 animate-pulse"></span>
            Soroban Smart Contracts Now Live
          </div>
          
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 max-w-4xl mx-auto">
            Mint Digital Assets on <span className="text-gradient">Stellar</span>
          </h1>
          
          <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
            SoroMint is the fastest, most cost-effective platform for creating, managing, and launching digital assets using Soroban.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/dashboard" className="w-full sm:w-auto px-8 py-4 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/25">
              Launch App
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link href="/docs" className="w-full sm:w-auto px-8 py-4 rounded-full glass hover:bg-white/10 text-white font-semibold transition-all border border-white/10">
              View Documentation
            </Link>
          </div>
        </motion.div>
        
        {/* Mock Dashboard Preview */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="mt-20 w-full max-w-5xl rounded-2xl glass-card overflow-hidden border border-white/10 shadow-2xl relative"
        >
          <div className="h-8 bg-black/40 border-b border-white/10 flex items-center px-4 gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
            <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
          </div>
          <div className="p-2 sm:p-8 relative h-[300px] sm:h-[500px] flex items-center justify-center bg-gradient-to-br from-gray-900 to-black">
            {/* Abstract dashboard representation */}
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
            <div className="w-full h-full flex flex-col gap-4">
              <div className="flex gap-4">
                <div className="h-32 flex-1 rounded-xl glass border-white/5 animate-pulse-slow bg-white/5"></div>
                <div className="h-32 flex-1 rounded-xl glass border-white/5 animate-pulse-slow bg-white/5" style={{ animationDelay: '0.5s' }}></div>
                <div className="h-32 flex-1 rounded-xl glass border-white/5 animate-pulse-slow bg-white/5 hidden sm:block" style={{ animationDelay: '1s' }}></div>
              </div>
              <div className="flex-1 rounded-xl glass border-white/5 flex items-center justify-center">
                <div className="w-3/4 h-3/4 border-b border-l border-white/10 relative">
                  <svg className="w-full h-full text-blue-500" viewBox="0 0 100 100" preserveAspectRatio="none">
                    <path d="M0,100 C20,80 40,90 60,40 C80,10 90,20 100,0 L100,100 Z" fill="url(#gradient)" opacity="0.2" />
                    <path d="M0,100 C20,80 40,90 60,40 C80,10 90,20 100,0" fill="none" stroke="currentColor" strokeWidth="2" />
                    <defs>
                      <linearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="currentColor" />
                        <stop offset="100%" stopColor="transparent" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Features Section */}
      <section className="px-6 max-w-7xl mx-auto w-full">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold mb-4">Why Build on SoroMint?</h2>
          <p className="text-gray-400 max-w-2xl mx-auto">Leverage the power of the Stellar network with developer-friendly tools and Soroban smart contracts.</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            { icon: Zap, title: "Fast Asset Minting", desc: "Create new tokens in seconds with our optimized Soroban contracts and intuitive UI." },
            { icon: Layers, title: "Soroban Smart Contracts", desc: "Deploy Turing-complete smart contracts to manage your digital assets with custom logic." },
            { icon: Rocket, title: "Low Transaction Costs", desc: "Benefit from Stellar's fraction-of-a-cent transaction fees for all minting and transfers." },
            { icon: BarChart, title: "On-chain Asset Tracking", desc: "Monitor your collection's performance and holder statistics in real-time." },
            { icon: Shield, title: "Secure Authentication", desc: "Seamlessly integrate with Freighter and other popular Stellar wallets securely." },
            { icon: Wallet, title: "Collection Management", desc: "Manage metadata, royalties, and permissions for your entire token collection." }
          ].map((feature, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="p-6 rounded-2xl glass hover:bg-white/5 transition-all border border-white/5"
            >
              <div className="w-12 h-12 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center mb-4">
                <feature.icon className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">{feature.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{feature.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 max-w-7xl mx-auto w-full py-12">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold mb-4">How It Works</h2>
          <p className="text-gray-400 max-w-2xl mx-auto">From idea to live on-chain asset in four simple steps.</p>
        </div>
        
        <div className="relative">
          <div className="absolute top-1/2 left-0 w-full h-1 bg-gradient-to-r from-blue-600/20 via-purple-600/20 to-blue-600/20 -translate-y-1/2 hidden md:block rounded-full"></div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 relative z-10">
            {[
              { step: "01", title: "Connect Wallet", desc: "Authenticate with your preferred Stellar wallet" },
              { step: "02", title: "Create Metadata", desc: "Define your asset properties and upload media" },
              { step: "03", title: "Mint on Stellar", desc: "Sign the transaction to deploy via Soroban" },
              { step: "04", title: "Manage Assets", desc: "Track performance and manage your collection" }
            ].map((item, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.2 }}
                className="flex flex-col items-center text-center"
              >
                <div className="w-16 h-16 rounded-full bg-gray-900 border-4 border-black text-blue-400 font-bold text-xl flex items-center justify-center mb-6 shadow-[0_0_20px_rgba(59,130,246,0.3)]">
                  {item.step}
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">{item.title}</h3>
                <p className="text-gray-400 text-sm">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Ecosystem Section */}
      <section className="px-6 max-w-5xl mx-auto w-full text-center">
        <div className="p-12 rounded-3xl glass-card relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-purple-500/10 opacity-50"></div>
          <div className="relative z-10">
            <h2 className="text-3xl font-bold mb-8">Built for the Stellar Ecosystem</h2>
            <div className="flex flex-wrap justify-center gap-6">
              <div className="px-6 py-3 rounded-full bg-white/5 border border-white/10 text-white font-medium flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400"></span> Stellar Network
              </div>
              <div className="px-6 py-3 rounded-full bg-white/5 border border-white/10 text-white font-medium flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-400"></span> Soroban
              </div>
              <div className="px-6 py-3 rounded-full bg-white/5 border border-white/10 text-white font-medium flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400"></span> Web3 Creators
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
