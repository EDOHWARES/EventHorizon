const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

/**
 * If we're on the main thread, export a function that spawns a worker thread.
 */
if (isMainThread) {
    module.exports = {
        /**
         * Transforms a payload using a base64 encoded WASM module
         * 
         * @param {string} wasmBase64 - Base64 encoded WebAssembly binary
         * @param {Object} payload - The event payload to transform
         * @param {number} timeoutMs - Maximum execution time in milliseconds
         * @returns {Promise<Object>} The transformed payload
         */
        transformPayload: async (wasmBase64, payload, timeoutMs = 1000) => {
            return new Promise((resolve, reject) => {
                const worker = new Worker(__filename, {
                    workerData: { wasmBase64, payload }
                });

                const timer = setTimeout(() => {
                    worker.terminate();
                    reject(new Error(`WASM execution timed out after ${timeoutMs}ms`));
                }, timeoutMs);

                worker.on('message', (msg) => {
                    clearTimeout(timer);
                    if (msg.error) reject(new Error(msg.error));
                    else resolve(msg.result);
                });

                worker.on('error', (err) => {
                    clearTimeout(timer);
                    reject(err);
                });

                worker.on('exit', (code) => {
                    clearTimeout(timer);
                    if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
                });
            });
        }
    };
} else {
    // --- Worker Thread Context ---
    async function runWasm() {
        try {
            const { wasmBase64, payload } = workerData;
            const wasmBuffer = Buffer.from(wasmBase64, 'base64');
            
            const wasmModule = await WebAssembly.compile(wasmBuffer);
            
            // Ensure an isolated execution space by passing an empty env unless necessary
            const instance = await WebAssembly.instantiate(wasmModule, { env: {} });
            const { transform, memory, alloc, dealloc } = instance.exports;

            if (!transform || !memory || !alloc) {
                throw new Error('WASM module missing required ABI exports: transform, memory, alloc');
            }

            // Serialize and load the payload into the Wasm memory space
            const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
            const ptr = alloc(payloadBytes.length);
            new Uint8Array(memory.buffer).set(payloadBytes, ptr);
            
            // Execute User Logic
            const outPtr = transform(ptr, payloadBytes.length);
            
            // Read null-terminated output string
            const outArray = new Uint8Array(memory.buffer, outPtr);
            let outLen = 0;
            while (outArray[outLen] !== 0 && outLen < 5000000) outLen++; // 5MB limit max
            
            const outString = new TextDecoder().decode(new Uint8Array(memory.buffer, outPtr, outLen));
            const result = JSON.parse(outString);

            // Optional cleanup internally
            if (dealloc) {
                dealloc(ptr, payloadBytes.length);
                dealloc(outPtr, outLen + 1);
            }

            parentPort.postMessage({ result });
        } catch (error) {
            parentPort.postMessage({ error: error.message });
        }
    }

    runWasm();
}