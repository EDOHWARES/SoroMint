/**
 * @title Socket.io Verification Script
 * @description A simple client to verify that Socket.io events are being emitted correctly.
 */

const { io } = require('socket.io-client');

const SOCKET_URL = 'http://localhost:5000'; // Adjust port if necessary
const ROOM_NAME = 'GC...TEST_WALLET'; // Example room name (wallet address)

const socket = io(SOCKET_URL);

socket.on('connect', () => {
    console.log('Connected to socket server');
    console.log('Joining room:', ROOM_NAME);
    socket.emit('join', ROOM_NAME);
});

socket.on('minting_progress', (data) => {
    console.log('\n[EVENT] minting_progress:', JSON.stringify(data, null, 2));
});

socket.on('transaction_update', (data) => {
    console.log('\n[EVENT] transaction_update:', JSON.stringify(data, null, 2));
});

socket.on('ledger_event', (data) => {
    console.log('\n[EVENT] ledger_event:', JSON.stringify(data, null, 2));
});

socket.on('disconnect', () => {
    console.log('Disconnected from socket server');
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error.message);
});

console.log('Socket client started. Listening for events...');
