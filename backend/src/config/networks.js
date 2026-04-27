module.exports = {
    mainnet: {
        rpcUrl: process.env.SOROBAN_RPC_URL_MAINNET || 'https://soroban-mainnet.stellar.org',
        passphrase: 'Public Global Stellar Network ; September 2015',
        horizonUrl: 'https://horizon.stellar.org'
    },
    testnet: {
        rpcUrl: process.env.SOROBAN_RPC_URL_TESTNET || 'https://soroban-testnet.stellar.org',
        passphrase: 'Test SDF Network ; September 2015',
        horizonUrl: 'https://horizon-testnet.stellar.org'
    },
    futurenet: {
        rpcUrl: process.env.SOROBAN_RPC_URL_FUTURENET || 'https://rpc-futurenet.stellar.org',
        passphrase: 'Test SDF Future Network ; Fall 2022',
        horizonUrl: 'https://horizon-futurenet.stellar.org'
    }
};