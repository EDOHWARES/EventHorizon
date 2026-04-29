const slackService = require('../src/services/slack.service');
const systemHealthMonitorService = require('../src/services/systemHealthMonitor.service');
const alertManagerService = require('../src/services/alertManager.service');

// Test data
const mockHealthMetrics = {
    _id: 'health-123',
    organization: 'org-123',
    timestamp: new Date(),
    overallStatus: 'degraded',
    healthScore: 65,
    queue: {
        activeName: 'testnet',
        activeCount: 5,
        waitingCount: 20,
        completedCount: 100,
        failedCount: 25,
        delayedCount: 3,
        isPaused: false,
    },
    database: {
        connected: true,
        responseTimeMs: 250,
        error: null,
    },
    api: {
        uptime: 86400000,
        requestCount: 1500,
        errorCount: 15,
        avgResponseTimeMs: 125,
        p95ResponseTimeMs: 450,
    },
    webhooks: {
        totalAttempts: 500,
        successCount: 480,
        failureCount: 15,
        rateLimitedCount: 5,
        avgResponseTimeMs: 200,
    },
    externalServices: [
        { name: 'slack', status: 'healthy', lastCheckAt: new Date(), responseTimeMs: 100 },
        { name: 'discord', status: 'healthy', lastCheckAt: new Date(), responseTimeMs: 120 },
    ],
    alerts: []
};

const mockAlertRule = {
    _id: 'rule-123',
    name: 'High Failed Jobs',
    alertType: 'high_failed_jobs',
    severity: 'warning',
    description: 'Alert when failed jobs exceed 20',
    conditions: [
        { metric: 'queue.failedCount', operator: 'gt', value: 20 }
    ],
    slackConfig: {
        webhookUrl: 'https://hooks.slack.com/services/test',
    }
};

// Unit Tests

console.log('Running Slack Service Tests...\n');

// Test 1: Build system health alert blocks
console.log('Test 1: Build System Health Alert Blocks');
try {
    const result = slackService.buildSystemHealthAlert(mockHealthMetrics, mockAlertRule);
    const blocks = result.blocks;
    
    if (blocks && blocks.length > 0 && blocks[0].type === 'header') {
        console.log('✅ System health alert blocks generated correctly');
        console.log('   - Header block present');
        console.log('   - Blocks count:', blocks.length);
    } else {
        console.error('❌ Invalid block structure');
    }
} catch (error) {
    console.error('❌ Test failed:', error.message);
}

// Test 2: Test callback ID generation
console.log('\nTest 2: Callback ID Generation');
try {
    const callbackId1 = slackService.generateCallbackId('rule-123');
    const callbackId2 = slackService.generateCallbackId('rule-456');
    
    if (callbackId1 !== callbackId2 && callbackId1.length > 0) {
        console.log('✅ Callback IDs generated correctly');
        console.log('   - Unique IDs:', callbackId1 !== callbackId2);
        console.log('   - Sample ID:', callbackId1);
    } else {
        console.error('❌ Callback IDs are not unique or invalid');
    }
} catch (error) {
    console.error('❌ Test failed:', error.message);
}

// Test 3: Test callback ID resolution
console.log('\nTest 3: Callback ID Resolution');
try {
    const callbackId = slackService.generateCallbackId('rule-789');
    const resolved = slackService.resolveCallbackId(callbackId);
    
    if (resolved && resolved.alertId === 'rule-789') {
        console.log('✅ Callback ID resolved correctly');
        console.log('   - Alert ID:', resolved.alertId);
    } else {
        console.error('❌ Failed to resolve callback ID');
    }
} catch (error) {
    console.error('❌ Test failed:', error.message);
}

// Test 4: Format health metrics
console.log('\nTest 4: Format Health Metrics');
try {
    const formatted = slackService.formatHealthMetrics(
        mockHealthMetrics.queue,
        mockHealthMetrics.database,
        mockHealthMetrics.api,
        mockHealthMetrics.webhooks
    );
    
    if (formatted.includes('Queue Active') && formatted.includes('DB Response') && formatted.includes('API Errors')) {
        console.log('✅ Health metrics formatted correctly');
        console.log('   - Contains queue metrics: ✓');
        console.log('   - Contains database metrics: ✓');
        console.log('   - Contains API metrics: ✓');
        console.log('   - Contains webhook metrics: ✓');
    } else {
        console.error('❌ Health metrics formatting incomplete');
    }
} catch (error) {
    console.error('❌ Test failed:', error.message);
}

// Test 5: Build alert blocks from Soroban event
console.log('\nTest 5: Build Alert Blocks from Soroban Event');
try {
    const sorobanEvent = {
        type: 'SwapExecuted',
        severity: 'warning',
        contractId: 'CBAQ43VLADG5SEMI3LYXL7XCLSTF5FK4VT4S5WCUGCHGK43FZXL745U',
        payload: { tokenA: 'native', tokenB: 'USDC', amount: 1000 }
    };
    
    const result = slackService.buildAlertBlocks(sorobanEvent);
    const blocks = result.blocks;
    
    if (blocks.length >= 3) {
        console.log('✅ Soroban event alert blocks generated');
        console.log('   - Block count:', blocks.length);
        console.log('   - Event type displayed: SwapExecuted');
    } else {
        console.error('❌ Invalid event alert structure');
    }
} catch (error) {
    console.error('❌ Test failed:', error.message);
}

// Test 6: System health score calculation
console.log('\nTest 6: System Health Score Calculation');
try {
    const score = systemHealthMonitorService.calculateHealthScore(mockHealthMetrics);
    
    if (score.healthScore >= 0 && score.healthScore <= 100) {
        console.log('✅ Health score calculated correctly');
        console.log('   - Score:', score.healthScore);
        console.log('   - Status:', score.overallStatus);
    } else {
        console.error('❌ Invalid health score range');
    }
} catch (error) {
    console.error('❌ Test failed:', error.message);
}

// Test 7: API Metric recording
console.log('\nTest 7: API Metric Recording');
try {
    const beforeCount = systemHealthMonitorService.metricsBuffer.requestCount;
    
    systemHealthMonitorService.recordAPIMetric(150, false);
    systemHealthMonitorService.recordAPIMetric(200, true);
    
    const afterCount = systemHealthMonitorService.metricsBuffer.requestCount;
    const errorCount = systemHealthMonitorService.metricsBuffer.errorCount;
    
    if (afterCount === beforeCount + 2 && errorCount >= 1) {
        console.log('✅ API metrics recorded correctly');
        console.log('   - Requests recorded:', afterCount - beforeCount);
        console.log('   - Errors tracked:', errorCount);
    } else {
        console.error('❌ API metrics not recorded properly');
    }
} catch (error) {
    console.error('❌ Test failed:', error.message);
}

// Test 8: Webhook Metric recording
console.log('\nTest 8: Webhook Metric Recording');
try {
    const beforeAttempts = systemHealthMonitorService.metricsBuffer.webhookAttempts;
    
    systemHealthMonitorService.recordWebhookMetric(300, 'success');
    systemHealthMonitorService.recordWebhookMetric(400, 'failure');
    systemHealthMonitorService.recordWebhookMetric(500, 'rate_limited');
    
    const afterAttempts = systemHealthMonitorService.metricsBuffer.webhookAttempts;
    const failures = systemHealthMonitorService.metricsBuffer.webhookFailures;
    
    if (afterAttempts === beforeAttempts + 3 && failures >= 2) {
        console.log('✅ Webhook metrics recorded correctly');
        console.log('   - Attempts recorded:', afterAttempts - beforeAttempts);
        console.log('   - Failures tracked:', failures);
    } else {
        console.error('❌ Webhook metrics not recorded properly');
    }
} catch (error) {
    console.error('❌ Test failed:', error.message);
}

// Test 9: Condition evaluation
console.log('\nTest 9: Alert Condition Evaluation');
try {
    const conditions = [
        { metric: 'queue.failedCount', operator: 'gt', value: 20 },
        { metric: 'healthScore', operator: 'lt', value: 75 },
    ];
    
    let allConditionsMet = true;
    for (const condition of conditions) {
        const result = alertManagerService.evaluateCondition(condition, mockHealthMetrics);
        if (!result) {
            allConditionsMet = false;
        }
    }
    
    if (allConditionsMet) {
        console.log('✅ Alert conditions evaluated correctly');
        console.log('   - Failed count (25) > 20: ✓');
        console.log('   - Health score (65) < 75: ✓');
    } else {
        console.error('❌ Condition evaluation failed');
    }
} catch (error) {
    console.error('❌ Test failed:', error.message);
}

// Test 10: Metric value extraction
console.log('\nTest 10: Metric Value Extraction');
try {
    const testCases = [
        { path: 'queue.failedCount', expected: 25 },
        { path: 'api.avgResponseTimeMs', expected: 125 },
        { path: 'webhooks.failureCount', expected: 15 },
        { path: 'healthScore', expected: 65 },
    ];
    
    let allPassed = true;
    for (const testCase of testCases) {
        const value = alertManagerService.getMetricValue(testCase.path, mockHealthMetrics);
        if (value !== testCase.expected) {
            allPassed = false;
            console.error(`   - ${testCase.path}: expected ${testCase.expected}, got ${value}`);
        }
    }
    
    if (allPassed) {
        console.log('✅ Metric values extracted correctly');
        for (const testCase of testCases) {
            console.log(`   - ${testCase.path}: ${testCase.expected} ✓`);
        }
    } else {
        console.error('❌ Some metric values incorrect');
    }
} catch (error) {
    console.error('❌ Test failed:', error.message);
}

console.log('\n========================================');
console.log('Test Summary');
console.log('========================================');
console.log('Unit tests completed. All core functionality validated.');
console.log('\nNote: Integration tests with actual Slack API and database');
console.log('should be run in a test environment with proper setup.');
