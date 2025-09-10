#!/usr/bin/env node

import AttributeExtractor from './utils/attributeExtraction.js';

/**
 * Quick Test Script for Attribute Extraction
 * Use this for rapid testing during development
 */
class QuickTester {
    constructor() {
        this.extractor = new AttributeExtractor(console);
    }

    /**
     * Run quick tests with predefined scenarios
     */
    async runQuickTests() {
        console.log('🚀 Quick Attribute Extraction Tests\n');

        // Test 1: Simple logistics scenario
        await this.testSimpleScenario();
        
        // Test 2: Change detection
        await this.testChangeDetection();
        
        // Test 3: Custom attributes
        await this.testCustomAttributes();
    }

    /**
     * Test with a simple logistics scenario
     */
    async testSimpleScenario() {
        console.log('📦 Test 1: Simple Logistics Scenario');
        console.log('-'.repeat(30));

        const attributes = [
            {
                attribute_key: 'pickup_location',
                attribute_display_name: 'Pickup Location',
                attribute_description: 'Address where goods will be collected',
                attribute_values: []
            },
            {
                attribute_key: 'delivery_location',
                attribute_display_name: 'Delivery Location',
                attribute_description: 'Destination address for delivery',
                attribute_values: []
            },
            {
                attribute_key: 'package_type',
                attribute_display_name: 'Package Type',
                attribute_description: 'Type of package - Electronics, Documents, Fragile, General',
                attribute_values: ['Electronics', 'Documents', 'Fragile', 'General']
            }
        ];

        const message = "I need to send documents from 123 Main Street to 456 Oak Avenue";

        console.log(`Message: "${message}"`);
        console.log('\nExtracting attributes...');

        try {
            const result = await this.extractor.extractAllAttributesFromMessage(message, attributes);
            
            console.log('\n✅ Extraction Results:');
            for (const [key, value] of Object.entries(result)) {
                console.log(`  ${key}: "${value}"`);
            }
            
            if (Object.keys(result).length === 0) {
                console.log('  No attributes extracted');
            }

        } catch (error) {
            console.log(`❌ Error: ${error.message}`);
        }
    }

    /**
     * Test change detection
     */
    async testChangeDetection() {
        console.log('\n🔄 Test 2: Change Detection');
        console.log('-'.repeat(30));

        const attributes = [
            {
                attribute_key: 'delivery_location',
                attribute_display_name: 'Delivery Location',
                attribute_description: 'Destination address',
                attribute_values: []
            }
        ];

        const currentAttributes = {
            delivery_location: '123 Main Street'
        };

        const messages = [
            "I want to change my delivery location",
            "Change delivery to 456 Oak Avenue",
            "Actually, deliver to downtown office"
        ];

        for (const message of messages) {
            console.log(`\nMessage: "${message}"`);
            
            const changeIntent = this.extractor.detectAttributeChangeIntent(
                message,
                currentAttributes,
                attributes
            );

            console.log(`Change Intent: ${changeIntent.hasChangeIntent ? 'YES' : 'NO'}`);
            if (changeIntent.hasChangeIntent) {
                console.log(`  Type: ${changeIntent.changeType}`);
                console.log(`  Attribute: ${changeIntent.attributeKey}`);
                console.log(`  New Value: ${changeIntent.newValue || 'NEEDS VALUE'}`);
                console.log(`  Confidence: ${changeIntent.confidence}`);
            }
        }
    }

    /**
     * Test with custom attributes (user can modify this)
     */
    async testCustomAttributes() {
        console.log('\n🎛️ Test 3: Custom Attributes (Modify as needed)');
        console.log('-'.repeat(30));

        // YOU CAN MODIFY THESE FOR YOUR TESTING
        const customAttributes = [
            {
                attribute_key: 'customer_name',
                attribute_display_name: 'Customer Name',
                attribute_description: 'Full name of the customer',
                attribute_values: []
            },
            {
                attribute_key: 'service_type',
                attribute_display_name: 'Service Type',
                attribute_description: 'Type of service needed - Repair, Installation, Consultation, Maintenance',
                attribute_values: ['Repair', 'Installation', 'Consultation', 'Maintenance']
            },
            {
                attribute_key: 'priority_level',
                attribute_display_name: 'Priority Level',
                attribute_description: 'Urgency level - Low, Medium, High, Critical',
                attribute_values: ['Low', 'Medium', 'High', 'Critical']
            }
        ];

        const customMessage = "Hi, I'm John Smith and I need urgent repair service";

        console.log(`Message: "${customMessage}"`);
        console.log('\nExtracting custom attributes...');

        try {
            const result = await this.extractor.extractAllAttributesFromMessage(customMessage, customAttributes);
            
            console.log('\n✅ Custom Extraction Results:');
            for (const [key, value] of Object.entries(result)) {
                console.log(`  ${key}: "${value}"`);
            }
            
            if (Object.keys(result).length === 0) {
                console.log('  No attributes extracted');
            }

        } catch (error) {
            console.log(`❌ Error: ${error.message}`);
        }
    }

    /**
     * Interactive testing mode
     */
    async runInteractiveTest() {
        const readline = await import('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('\n🎮 Interactive Testing Mode');
        console.log('Enter your test message (or "quit" to exit):');

        // Default attributes for testing
        const defaultAttributes = [
            {
                attribute_key: 'location',
                attribute_display_name: 'Location',
                attribute_description: 'Any location or address mentioned',
                attribute_values: []
            },
            {
                attribute_key: 'contact_info',
                attribute_display_name: 'Contact Info',
                attribute_description: 'Email, phone, or other contact information',
                attribute_values: []
            },
            {
                attribute_key: 'classification',
                attribute_display_name: 'Classification',
                attribute_description: 'Any category, type, or classification mentioned',
                attribute_values: []
            }
        ];

        const askQuestion = () => {
            rl.question('\n> ', async (message) => {
                if (message.toLowerCase() === 'quit') {
                    rl.close();
                    return;
                }

                if (message.trim() === '') {
                    askQuestion();
                    return;
                }

                console.log(`\nTesting: "${message}"`);
                
                try {
                    const result = await this.extractor.extractAllAttributesFromMessage(message, defaultAttributes);
                    
                    if (Object.keys(result).length > 0) {
                        console.log('✅ Extracted:');
                        for (const [key, value] of Object.entries(result)) {
                            console.log(`  ${key}: "${value}"`);
                        }
                    } else {
                        console.log('❌ No attributes extracted');
                    }
                } catch (error) {
                    console.log(`❌ Error: ${error.message}`);
                }

                askQuestion();
            });
        };

        askQuestion();
    }
}

// Command line handling
if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2);
    const tester = new QuickTester();

    if (args.includes('--interactive') || args.includes('-i')) {
        tester.runInteractiveTest().catch(console.error);
    } else {
        tester.runQuickTests().catch(console.error);
    }
}

export default QuickTester;
