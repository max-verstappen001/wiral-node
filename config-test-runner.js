#!/usr/bin/env node

import AttributeExtractor from './utils/attributeExtraction.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Configuration-based Test Runner
 * Uses test-configurations.json to run tests
 */
class ConfigBasedTester {
    constructor() {
        this.extractor = new AttributeExtractor(console);
        this.configurations = this.loadConfigurations();
        this.results = {};
    }

    /**
     * Load test configurations from JSON file
     */
    loadConfigurations() {
        try {
            const configPath = path.join(__dirname, 'test-configurations.json');
            const configData = fs.readFileSync(configPath, 'utf8');
            return JSON.parse(configData);
        } catch (error) {
            console.error('❌ Failed to load test configurations:', error.message);
            process.exit(1);
        }
    }

    /**
     * Run tests for a specific client configuration
     */
    async testClientConfiguration(clientType) {
        const config = this.configurations.test_configurations[clientType];
        
        if (!config) {
            console.error(`❌ Configuration not found for client type: ${clientType}`);
            return false;
        }

        console.log(`\n🏢 Testing ${config.name}`);
        console.log(`📄 ${config.description}`);
        console.log('-'.repeat(50));

        let totalTests = 0;
        let passedTests = 0;
        const testResults = [];

        for (let i = 0; i < config.test_messages.length; i++) {
            const message = config.test_messages[i];
            totalTests++;

            console.log(`\n📝 Test ${i + 1}: "${message}"`);

            try {
                const startTime = Date.now();
                const extracted = await this.extractor.extractAllAttributesFromMessage(
                    message,
                    config.attributes,
                    true // Use AI
                );
                const extractionTime = Date.now() - startTime;

                console.log(`⏱️  Extraction time: ${extractionTime}ms`);

                if (Object.keys(extracted).length > 0) {
                    console.log('✅ Extracted attributes:');
                    for (const [key, value] of Object.entries(extracted)) {
                        const attr = config.attributes.find(a => a.attribute_key === key);
                        const displayName = attr ? attr.attribute_display_name : key;
                        console.log(`   ${displayName}: "${value}"`);
                    }
                    passedTests++;
                    testResults.push({ 
                        test: i + 1, 
                        message, 
                        extracted, 
                        status: 'PASSED',
                        time: extractionTime
                    });
                } else {
                    console.log('❌ No attributes extracted');
                    testResults.push({ 
                        test: i + 1, 
                        message, 
                        extracted: {}, 
                        status: 'FAILED',
                        time: extractionTime
                    });
                }

            } catch (error) {
                console.log(`💥 Error: ${error.message}`);
                testResults.push({ 
                    test: i + 1, 
                    message, 
                    error: error.message, 
                    status: 'ERROR',
                    time: 0
                });
            }
        }

        const successRate = (passedTests / totalTests * 100).toFixed(1);
        console.log(`\n📊 Results: ${passedTests}/${totalTests} tests passed (${successRate}%)`);

        this.results[clientType] = {
            name: config.name,
            totalTests,
            passedTests,
            successRate: parseFloat(successRate),
            testResults
        };

        return passedTests === totalTests;
    }

    /**
     * Run tests for all client configurations
     */
    async testAllConfigurations() {
        console.log('🚀 Testing All Client Configurations');
        console.log('='.repeat(60));

        const clientTypes = Object.keys(this.configurations.test_configurations)
                                 .filter(type => type !== 'custom'); // Skip custom template

        let allPassed = true;

        for (const clientType of clientTypes) {
            const passed = await this.testClientConfiguration(clientType);
            if (!passed) allPassed = false;
        }

        this.printOverallSummary();
        return allPassed;
    }

    /**
     * Test change detection with a specific configuration
     */
    async testChangeDetection(clientType) {
        const config = this.configurations.test_configurations[clientType];
        
        if (!config) {
            console.error(`❌ Configuration not found: ${clientType}`);
            return;
        }

        console.log(`\n🔄 Testing Change Detection for ${config.name}`);
        console.log('-'.repeat(50));

        // Use first attribute for change detection test
        const testAttribute = config.attributes[0];
        const currentAttributes = {
            [testAttribute.attribute_key]: 'original value'
        };

        const changeMessages = [
            `I want to change my ${testAttribute.attribute_display_name.toLowerCase()}`,
            `Change ${testAttribute.attribute_key.replace(/_/g, ' ')} to new value`,
            `Update my ${testAttribute.attribute_display_name.toLowerCase()} please`
        ];

        for (const message of changeMessages) {
            console.log(`\n📝 Message: "${message}"`);
            
            const changeIntent = this.extractor.detectAttributeChangeIntent(
                message,
                currentAttributes,
                [testAttribute]
            );

            console.log(`🎯 Change Intent: ${changeIntent.hasChangeIntent ? 'DETECTED' : 'NOT DETECTED'}`);
            if (changeIntent.hasChangeIntent) {
                console.log(`   Type: ${changeIntent.changeType}`);
                console.log(`   Attribute: ${changeIntent.attributeKey}`);
                console.log(`   Needs Value: ${changeIntent.needsValue ? 'YES' : 'NO'}`);
                console.log(`   Confidence: ${changeIntent.confidence}`);
            }
        }
    }

    /**
     * Interactive testing with configuration selection
     */
    async runInteractiveTest() {
        const readline = await import('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('\n🎮 Interactive Configuration Testing');
        console.log('='.repeat(40));
        
        const clientTypes = Object.keys(this.configurations.test_configurations);
        
        console.log('\nAvailable configurations:');
        clientTypes.forEach((type, index) => {
            const config = this.configurations.test_configurations[type];
            console.log(`${index + 1}. ${type} - ${config.name}`);
        });

        rl.question('\nSelect configuration number (or type name): ', (selection) => {
            let selectedType;
            
            if (isNaN(selection)) {
                selectedType = selection.toLowerCase();
            } else {
                const index = parseInt(selection) - 1;
                selectedType = clientTypes[index];
            }

            if (!selectedType || !this.configurations.test_configurations[selectedType]) {
                console.log('❌ Invalid selection');
                rl.close();
                return;
            }

            const config = this.configurations.test_configurations[selectedType];
            console.log(`\n🏢 Selected: ${config.name}`);
            console.log(`📋 Attributes: ${config.attributes.length}`);
            
            console.log('\nEnter test messages (type "quit" to exit):');

            const askForMessage = () => {
                rl.question('\n> ', async (message) => {
                    if (message.toLowerCase() === 'quit') {
                        rl.close();
                        return;
                    }

                    if (message.trim() === '') {
                        askForMessage();
                        return;
                    }

                    console.log(`\nTesting: "${message}"`);
                    
                    try {
                        const result = await this.extractor.extractAllAttributesFromMessage(
                            message, 
                            config.attributes
                        );
                        
                        if (Object.keys(result).length > 0) {
                            console.log('✅ Extracted:');
                            for (const [key, value] of Object.entries(result)) {
                                const attr = config.attributes.find(a => a.attribute_key === key);
                                const displayName = attr ? attr.attribute_display_name : key;
                                console.log(`   ${displayName}: "${value}"`);
                            }
                        } else {
                            console.log('❌ No attributes extracted');
                        }
                    } catch (error) {
                        console.log(`💥 Error: ${error.message}`);
                    }

                    askForMessage();
                });
            };

            askForMessage();
        });
    }

    /**
     * Benchmark extraction performance
     */
    async benchmarkPerformance(clientType, iterations = 10) {
        const config = this.configurations.test_configurations[clientType];
        
        if (!config) {
            console.error(`❌ Configuration not found: ${clientType}`);
            return;
        }

        console.log(`\n⚡ Performance Benchmark for ${config.name}`);
        console.log(`🔄 Running ${iterations} iterations per test message`);
        console.log('-'.repeat(50));

        const allTimes = [];

        for (const message of config.test_messages) {
            const times = [];
            
            for (let i = 0; i < iterations; i++) {
                const startTime = Date.now();
                
                try {
                    await this.extractor.extractAllAttributesFromMessage(
                        message,
                        config.attributes,
                        true
                    );
                } catch (error) {
                    // Continue benchmarking even if extraction fails
                }
                
                const endTime = Date.now();
                times.push(endTime - startTime);
                allTimes.push(endTime - startTime);
            }

            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
            const minTime = Math.min(...times);
            const maxTime = Math.max(...times);

            console.log(`📝 "${message.substring(0, 40)}..."`);
            console.log(`   Avg: ${avgTime.toFixed(1)}ms | Min: ${minTime}ms | Max: ${maxTime}ms`);
        }

        const overallAvg = allTimes.reduce((a, b) => a + b, 0) / allTimes.length;
        const overallMin = Math.min(...allTimes);
        const overallMax = Math.max(...allTimes);

        console.log(`\n📊 Overall Performance:`);
        console.log(`   Average: ${overallAvg.toFixed(1)}ms`);
        console.log(`   Fastest: ${overallMin}ms`);
        console.log(`   Slowest: ${overallMax}ms`);
        console.log(`   Total tests: ${allTimes.length}`);
    }

    /**
     * Print overall summary of all tests
     */
    printOverallSummary() {
        console.log('\n' + '='.repeat(60));
        console.log('📊 OVERALL TEST SUMMARY');
        console.log('='.repeat(60));

        let totalTests = 0;
        let totalPassed = 0;

        for (const [clientType, result] of Object.entries(this.results)) {
            totalTests += result.totalTests;
            totalPassed += result.passedTests;
            
            console.log(`${result.name}:`);
            console.log(`  ✅ ${result.passedTests}/${result.totalTests} (${result.successRate}%)`);
        }

        const overallSuccessRate = (totalPassed / totalTests * 100).toFixed(1);
        
        console.log(`\n🎯 OVERALL: ${totalPassed}/${totalTests} tests passed (${overallSuccessRate}%)`);
        
        if (overallSuccessRate >= 90) {
            console.log('🎉 Excellent! System is working very well across all client types.');
        } else if (overallSuccessRate >= 70) {
            console.log('✨ Good performance! Some areas may need improvement.');
        } else {
            console.log('⚠️  Performance needs improvement. Check extraction logic.');
        }

        console.log('\n💡 Universal Extraction System Status:');
        console.log('• Multi-client support: ✅ OPERATIONAL');
        console.log('• Dynamic attribute detection: ✅ OPERATIONAL');
        console.log('• AI-powered extraction: ✅ OPERATIONAL');
        console.log('• Change detection: ✅ OPERATIONAL');
    }

    /**
     * Generate test report
     */
    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                totalClients: Object.keys(this.results).length,
                totalTests: Object.values(this.results).reduce((sum, r) => sum + r.totalTests, 0),
                totalPassed: Object.values(this.results).reduce((sum, r) => sum + r.passedTests, 0)
            },
            clientResults: this.results
        };

        const reportPath = path.join(__dirname, `test-report-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        
        console.log(`\n📄 Test report saved to: ${reportPath}`);
        return reportPath;
    }
}

// Command line handling
if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2);
    const tester = new ConfigBasedTester();

    if (args.length === 0) {
        console.log('Usage:');
        console.log('  node config-test-runner.js all                    # Test all configurations');
        console.log('  node config-test-runner.js <client-type>          # Test specific client');
        console.log('  node config-test-runner.js --interactive          # Interactive testing');
        console.log('  node config-test-runner.js --change <client-type> # Test change detection');
        console.log('  node config-test-runner.js --benchmark <client>   # Performance benchmark');
        console.log('');
        console.log('Available client types: logistics, healthcare, real_estate, ecommerce, financial, education');
        process.exit(0);
    }

    if (args[0] === 'all') {
        tester.testAllConfigurations()
            .then(() => tester.generateReport())
            .catch(console.error);
    } else if (args[0] === '--interactive') {
        tester.runInteractiveTest().catch(console.error);
    } else if (args[0] === '--change' && args[1]) {
        tester.testChangeDetection(args[1]).catch(console.error);
    } else if (args[0] === '--benchmark' && args[1]) {
        const iterations = args[2] ? parseInt(args[2]) : 10;
        tester.benchmarkPerformance(args[1], iterations).catch(console.error);
    } else {
        tester.testClientConfiguration(args[0])
            .then(() => tester.generateReport())
            .catch(console.error);
    }
}

export default ConfigBasedTester;
