/**
 * DAO Voting System - Example Usage
 * 
 * This script demonstrates the complete workflow of the DAO voting system
 * for token metadata updates.
 */

const axios = require('axios');

const API_BASE = 'http://localhost:5000/api';
const JWT_TOKEN = 'YOUR_JWT_TOKEN_HERE'; // Replace with actual JWT token

const headers = {
  'Authorization': `Bearer ${JWT_TOKEN}`,
  'Content-Type': 'application/json'
};

/**
 * Example 1: Create a Proposal
 */
async function createProposal() {
  try {
    const response = await axios.post(`${API_BASE}/dao/proposals`, {
      tokenId: '507f1f77bcf86cd799439011', // Replace with actual token ID
      contractId: 'CTEST123...', // Replace with actual contract ID
      proposer: 'GPROPOSER123...', // Replace with actual proposer address
      changes: {
        name: 'Updated Token Name',
        symbol: 'UTN'
      },
      quorum: 60, // 60% approval required
      durationDays: 7 // 7 days voting period
    }, { headers });

    console.log('✅ Proposal Created:');
    console.log(JSON.stringify(response.data, null, 2));
    return response.data.data._id;
  } catch (error) {
    console.error('❌ Error creating proposal:', error.response?.data || error.message);
  }
}

/**
 * Example 2: Cast a Vote
 */
async function castVote(proposalId, voter, support) {
  try {
    const response = await axios.post(`${API_BASE}/dao/votes`, {
      proposalId,
      voter,
      support
    }, { headers });

    console.log(`✅ Vote Cast (${support ? 'FOR' : 'AGAINST'}):`);
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ Error casting vote:', error.response?.data || error.message);
  }
}

/**
 * Example 3: Get Proposal Details
 */
async function getProposal(proposalId) {
  try {
    const response = await axios.get(`${API_BASE}/dao/proposals/${proposalId}`, { headers });

    console.log('✅ Proposal Details:');
    console.log(JSON.stringify(response.data, null, 2));
    return response.data.data;
  } catch (error) {
    console.error('❌ Error fetching proposal:', error.response?.data || error.message);
  }
}

/**
 * Example 4: Get All Proposals for a Token
 */
async function getProposalsByToken(tokenId, status = null) {
  try {
    const url = status 
      ? `${API_BASE}/dao/proposals?tokenId=${tokenId}&status=${status}`
      : `${API_BASE}/dao/proposals?tokenId=${tokenId}`;
    
    const response = await axios.get(url, { headers });

    console.log('✅ Proposals:');
    console.log(JSON.stringify(response.data, null, 2));
    return response.data.data;
  } catch (error) {
    console.error('❌ Error fetching proposals:', error.response?.data || error.message);
  }
}

/**
 * Example 5: Get Votes for a Proposal
 */
async function getVotes(proposalId) {
  try {
    const response = await axios.get(`${API_BASE}/dao/proposals/${proposalId}/votes`, { headers });

    console.log('✅ Votes:');
    console.log(JSON.stringify(response.data, null, 2));
    return response.data.data;
  } catch (error) {
    console.error('❌ Error fetching votes:', error.response?.data || error.message);
  }
}

/**
 * Complete Workflow Example
 */
async function completeWorkflow() {
  console.log('🚀 Starting DAO Voting Workflow Example\n');

  // Step 1: Create a proposal
  console.log('📝 Step 1: Creating Proposal...');
  const proposalId = await createProposal();
  if (!proposalId) return;
  console.log('\n');

  // Step 2: Cast votes from multiple voters
  console.log('🗳️  Step 2: Casting Votes...');
  await castVote(proposalId, 'GVOTER1...', true);  // Vote FOR
  await castVote(proposalId, 'GVOTER2...', true);  // Vote FOR
  await castVote(proposalId, 'GVOTER3...', false); // Vote AGAINST
  await castVote(proposalId, 'GVOTER4...', true);  // Vote FOR
  console.log('\n');

  // Step 3: Check proposal status
  console.log('📊 Step 3: Checking Proposal Status...');
  const proposal = await getProposal(proposalId);
  console.log('\n');

  // Step 4: Get all votes
  console.log('📋 Step 4: Fetching All Votes...');
  await getVotes(proposalId);
  console.log('\n');

  // Step 5: Calculate results
  if (proposal) {
    const totalVotes = proposal.votesFor + proposal.votesAgainst;
    const approvalRate = (proposal.votesFor / totalVotes) * 100;
    
    console.log('📈 Voting Results:');
    console.log(`   Total Votes: ${totalVotes}`);
    console.log(`   Votes For: ${proposal.votesFor}`);
    console.log(`   Votes Against: ${proposal.votesAgainst}`);
    console.log(`   Approval Rate: ${approvalRate.toFixed(2)}%`);
    console.log(`   Required Quorum: ${proposal.quorum}%`);
    console.log(`   Status: ${proposal.status}`);
    
    if (proposal.status === 'EXECUTED') {
      console.log('   ✅ Proposal has been executed!');
      console.log(`   Transaction Hash: ${proposal.executionTxHash}`);
    } else if (approvalRate >= proposal.quorum) {
      console.log('   ⏳ Quorum reached, awaiting execution...');
    } else {
      console.log('   ⏳ Quorum not yet reached');
    }
  }

  console.log('\n✨ Workflow Complete!');
}

/**
 * Run the example
 */
if (require.main === module) {
  completeWorkflow().catch(console.error);
}

module.exports = {
  createProposal,
  castVote,
  getProposal,
  getProposalsByToken,
  getVotes,
  completeWorkflow
};
