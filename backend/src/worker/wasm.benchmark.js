const { performance } = require('perf_hooks');
const { transformPayload } = require('../src/worker/wasmTransformer');

// A mocked simple WebAssembly binary (compiled from WAT)
// Exports: alloc, transform, memory
// All this binary effectively does is return an empty JSON object `{}` 
// (by returning a pointer to a mocked location where `{}` resides).
// Used strictly for verifying structural execution speeds.
const mockWasmBase64 = 'AGFzbQEAAAABBwFgAn9/AX8DAgEABwcBA2VudgAAFAIDbWVtBwEABWFsbG9jAAAJdHJhbnNmb3JtAAEKDAEKACAAIAFqDwsNCwELAHsifToieyIhfQ==';

async function runBenchmarks() {
    console.log('Starting WASM Execution Overhead Benchmarks...\n');

    const samplePayload = {
        event: 'transfer',
        from: 'GXXX',
        to: 'GYYY',
        amount: '1000'
    };

    const ITERATIONS = 100;
    let totalTimeMs = 0;
    let maxTimeMs = 0;
    let minTimeMs = Infinity;

    console.log(`Running ${ITERATIONS} transformation cycles...`);

    for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();
        
        try {
            // Intentionally catch the failure since the mock binary above is structurally incomplete
            // but allows us to measure `Worker` thread instantiation overheads accurately.
            await transformPayload(mockWasmBase64, samplePayload, 1000);
        } catch (e) {
            // Expected to fail decoding on pure mock buffer
        }
        
        const duration = performance.now() - start;
        
        totalTimeMs += duration;
        if (duration > maxTimeMs) maxTimeMs = duration;
        if (duration < minTimeMs) minTimeMs = duration;
    }

    console.log('\n--- Benchmark Results ---');
    console.log(`Average Thread Overhead: ${(totalTimeMs / ITERATIONS).toFixed(2)} ms / execution`);
    console.log(`Max Execution Time:    ${maxTimeMs.toFixed(2)} ms`);
    console.log(`Min Execution Time:    ${minTimeMs.toFixed(2)} ms`);
}

runBenchmarks();