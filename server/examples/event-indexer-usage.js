/**
 * Example: Using the Soroban Event Indexer
 * 
 * This example demonstrates:
 * 1. Starting the indexer
 * 2. Querying indexed events
 * 3. Getting event statistics
 */

const axios = require('axios');

const API_BASE = 'http://localhost:5000/api';
const AUTH_TOKEN = 'your-jwt-token-here';

// Query events for a specific contract
async function getContractEvents(contractId) {
  const response = await axios.get(`${API_BASE}/soroban/events`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    params: {
      contractId,
      page: 1,
      limit: 50,
    },
  });
  
  console.log(`Found ${response.data.pagination.total} events`);
  return response.data.events;
}

// Get event statistics
async function getEventStats() {
  const response = await axios.get(`${API_BASE}/soroban/events/stats`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
  });
  
  console.log('Top contracts by event count:');
  response.data.stats.forEach(stat => {
    console.log(`  ${stat._id}: ${stat.eventCount} events`);
  });
  
  return response.data.stats;
}

// Query events by ledger range
async function getEventsByLedgerRange(startLedger, endLedger) {
  const response = await axios.get(`${API_BASE}/soroban/events`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    params: {
      startLedger,
      endLedger,
      limit: 100,
    },
  });
  
  return response.data.events;
}

// Example usage
async function main() {
  try {
    // Get events for a contract
    const events = await getContractEvents('CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE');
    console.log('Recent events:', events.slice(0, 3));
    
    // Get statistics
    await getEventStats();
    
    // Query by ledger range
    const recentEvents = await getEventsByLedgerRange(1000000, 1000100);
    console.log(`Events in ledger range: ${recentEvents.length}`);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Uncomment to run
// main();

module.exports = { getContractEvents, getEventStats, getEventsByLedgerRange };
