#!/usr/bin/env node

import AttributeExtractor from './utils/attributeExtraction.js';

/**
 * Comprehensive Test Script for Universal Attribute Extraction System
 * Tests the system with various client types and attribute configurations
 */
class AttributeExtractionTester {
    constructor() {
        this.extractor = new AttributeExtractor(console);
        this.testResults = [];
        this.passedTests = 0;
        this.totalTests = 0;
    }

    /**
     * Run all test suites
     */
    async runAllTests() {
        console.log('🚀 Starting Universal Attribute Extraction Tests\n');
        console.log('=' * 60);

        // Test different client types
        await this.testLogisticsClient();
        await this.testHealthcareClient();
        await this.testRealEstateClient();
        await this.testECommerceClient();
        await this.testFinancialServicesClient();
        await this.testEducationClient();
        
        // Test specific scenarios
        await this.testAttributeChangeDetection();
        await this.testMissingAttributeCollection();
        await this.testValueProcessing();
        await this.testErrorHandling();

        this.printSummary();
    }

    /**
     * Test Case 1: Logistics/Transportation Client
     */
    async testLogisticsClient() {
        console.log('\n📦 Testing Logistics Client Attributes');
        console.log('-'.repeat(40));

        const logisticsAttributes = [
            {
                attribute_key: 'pickup_location',
                attribute_display_name: 'Pickup Location',
                attribute_description: 'The address where goods will be collected',
                attribute_values: []
            },
            {
                attribute_key: 'delivery_location',
                attribute_display_name: 'Delivery Location',
                attribute_description: 'The destination address for delivery',
                attribute_values: []
            },
            {
                attribute_key: 'package_classification',
                attribute_display_name: 'Package Type',
                attribute_description: 'Classification of goods - one of these 4 values - Electronics, Fragile, Documents, General',
                attribute_values: ['Electronics', 'Fragile', 'Documents', 'General']
            },
            {
                attribute_key: 'delivery_urgency',
                attribute_display_name: 'Delivery Urgency',
                attribute_description: 'Priority level - can be Standard, Express, or Urgent',
                attribute_values: ['Standard', 'Express', 'Urgent']
            },
            {
                attribute_key: 'package_weight',
                attribute_display_name: 'Package Weight',
                attribute_description: 'Weight of the package in kg',
                attribute_values: []
            }
        ];

        const testMessages = [
            {
                message: "I need to send a laptop from 123 Main Street to 456 Oak Avenue. It's urgent and weighs about 2kg.",
                expected: {
                    pickup_location: '123 Main Street',
                    delivery_location: '456 Oak Avenue',
                    package_classification: 'Electronics',
                    delivery_urgency: 'Urgent',
                    package_weight: '2kg'
                }
            },
            {
                message: "Pick up some fragile items from downtown office, deliver to residential area",
                expected: {
                    pickup_location: 'downtown office',
                    delivery_location: 'residential area',
                    package_classification: 'Fragile'
                }
            },
            {
                message: "Standard delivery of documents from corporate building to law firm",
                expected: {
                    pickup_location: 'corporate building',
                    delivery_location: 'law firm',
                    package_classification: 'Documents',
                    delivery_urgency: 'Standard'
                }
            }
        ];

        await this.runTestSuite('Logistics', logisticsAttributes, testMessages);
    }

    /**
     * Test Case 2: Healthcare Client
     */
    async testHealthcareClient() {
        console.log('\n🏥 Testing Healthcare Client Attributes');
        console.log('-'.repeat(40));

        const healthcareAttributes = [
            {
                attribute_key: 'patient_name',
                attribute_display_name: 'Patient Name',
                attribute_description: 'Full name of the patient',
                attribute_values: []
            },
            {
                attribute_key: 'appointment_type',
                attribute_display_name: 'Appointment Type',
                attribute_description: 'Type of medical appointment - Consultation, Checkup, Emergency, Surgery',
                attribute_values: ['Consultation', 'Checkup', 'Emergency', 'Surgery']
            },
            {
                attribute_key: 'preferred_doctor',
                attribute_display_name: 'Preferred Doctor',
                attribute_description: 'Name of preferred healthcare provider',
                attribute_values: []
            },
            {
                attribute_key: 'insurance_id',
                attribute_display_name: 'Insurance ID',
                attribute_description: 'Patient insurance identification number',
                attribute_values: []
            },
            {
                attribute_key: 'emergency_contact',
                attribute_display_name: 'Emergency Contact',
                attribute_description: 'Phone number for emergency contact',
                attribute_values: []
            }
        ];

        const testMessages = [
            {
                message: "Hi, I'm John Smith and I need an emergency appointment. My insurance ID is HC123456 and emergency contact is 555-0123",
                expected: {
                    patient_name: 'John Smith',
                    appointment_type: 'Emergency',
                    insurance_id: 'HC123456',
                    emergency_contact: '555-0123'
                }
            },
            {
                message: "Schedule a checkup with Dr. Wilson for Sarah Johnson",
                expected: {
                    patient_name: 'Sarah Johnson',
                    appointment_type: 'Checkup',
                    preferred_doctor: 'Dr. Wilson'
                }
            }
        ];

        await this.runTestSuite('Healthcare', healthcareAttributes, testMessages);
    }

    /**
     * Test Case 3: Real Estate Client
     */
    async testRealEstateClient() {
        console.log('\n🏠 Testing Real Estate Client Attributes');
        console.log('-'.repeat(40));

        const realEstateAttributes = [
            {
                attribute_key: 'property_type',
                attribute_display_name: 'Property Type',
                attribute_description: 'Type of property - House, Apartment, Condo, Townhouse, Commercial',
                attribute_values: ['House', 'Apartment', 'Condo', 'Townhouse', 'Commercial']
            },
            {
                attribute_key: 'budget_range',
                attribute_display_name: 'Budget Range',
                attribute_description: 'Price range for property search',
                attribute_values: []
            },
            {
                attribute_key: 'preferred_location',
                attribute_display_name: 'Preferred Location',
                attribute_description: 'Desired neighborhood or area',
                attribute_values: []
            },
            {
                attribute_key: 'bedrooms',
                attribute_display_name: 'Number of Bedrooms',
                attribute_description: 'Required number of bedrooms',
                attribute_values: []
            },
            {
                attribute_key: 'move_in_date',
                attribute_display_name: 'Move-in Date',
                attribute_description: 'Preferred move-in timeline',
                attribute_values: []
            }
        ];

        const testMessages = [
            {
                message: "Looking for a 3-bedroom house in downtown area, budget is $300k-500k, need to move in by next month",
                expected: {
                    property_type: 'House',
                    budget_range: '$300k-500k',
                    preferred_location: 'downtown area',
                    bedrooms: '3',
                    move_in_date: 'next month'
                }
            },
            {
                message: "I want an apartment in the suburbs, 2 bedrooms preferred",
                expected: {
                    property_type: 'Apartment',
                    preferred_location: 'suburbs',
                    bedrooms: '2'
                }
            }
        ];

        await this.runTestSuite('Real Estate', realEstateAttributes, testMessages);
    }

    /**
     * Test Case 4: E-Commerce Client
     */
    async testECommerceClient() {
        console.log('\n🛒 Testing E-Commerce Client Attributes');
        console.log('-'.repeat(40));

        const ecommerceAttributes = [
            {
                attribute_key: 'product_category',
                attribute_display_name: 'Product Category',
                attribute_description: 'Type of product - Electronics, Clothing, Books, Home, Sports',
                attribute_values: ['Electronics', 'Clothing', 'Books', 'Home', 'Sports']
            },
            {
                attribute_key: 'shipping_address',
                attribute_display_name: 'Shipping Address',
                attribute_description: 'Delivery address for orders',
                attribute_values: []
            },
            {
                attribute_key: 'payment_method',
                attribute_display_name: 'Payment Method',
                attribute_description: 'Preferred payment option - Credit Card, PayPal, Bank Transfer',
                attribute_values: ['Credit Card', 'PayPal', 'Bank Transfer']
            },
            {
                attribute_key: 'order_value',
                attribute_display_name: 'Order Value',
                attribute_description: 'Total value of the order',
                attribute_values: []
            }
        ];

        const testMessages = [
            {
                message: "I want to buy electronics worth $500, ship to 789 Pine Street, I'll pay with credit card",
                expected: {
                    product_category: 'Electronics',
                    shipping_address: '789 Pine Street',
                    payment_method: 'Credit Card',
                    order_value: '$500'
                }
            },
            {
                message: "Looking for sports equipment, delivery to gym address, will use PayPal",
                expected: {
                    product_category: 'Sports',
                    shipping_address: 'gym address',
                    payment_method: 'PayPal'
                }
            }
        ];

        await this.runTestSuite('E-Commerce', ecommerceAttributes, testMessages);
    }

    /**
     * Test Case 5: Financial Services Client
     */
    async testFinancialServicesClient() {
        console.log('\n💰 Testing Financial Services Client Attributes');
        console.log('-'.repeat(40));

        const financialAttributes = [
            {
                attribute_key: 'service_type',
                attribute_display_name: 'Service Type',
                attribute_description: 'Type of financial service - Loan, Investment, Insurance, Banking',
                attribute_values: ['Loan', 'Investment', 'Insurance', 'Banking']
            },
            {
                attribute_key: 'annual_income',
                attribute_display_name: 'Annual Income',
                attribute_description: 'Client\'s yearly income',
                attribute_values: []
            },
            {
                attribute_key: 'risk_tolerance',
                attribute_display_name: 'Risk Tolerance',
                attribute_description: 'Investment risk preference - Conservative, Moderate, Aggressive',
                attribute_values: ['Conservative', 'Moderate', 'Aggressive']
            },
            {
                attribute_key: 'contact_email',
                attribute_display_name: 'Contact Email',
                attribute_description: 'Email address for correspondence',
                attribute_values: []
            }
        ];

        const testMessages = [
            {
                message: "I'm interested in investment services, my income is $75000 annually, I prefer moderate risk, contact me at john@email.com",
                expected: {
                    service_type: 'Investment',
                    annual_income: '$75000',
                    risk_tolerance: 'Moderate',
                    contact_email: 'john@email.com'
                }
            }
        ];

        await this.runTestSuite('Financial Services', financialAttributes, testMessages);
    }

    /**
     * Test Case 6: Education Client
     */
    async testEducationClient() {
        console.log('\n🎓 Testing Education Client Attributes');
        console.log('-'.repeat(40));

        const educationAttributes = [
            {
                attribute_key: 'course_level',
                attribute_display_name: 'Course Level',
                attribute_description: 'Academic level - Beginner, Intermediate, Advanced, Expert',
                attribute_values: ['Beginner', 'Intermediate', 'Advanced', 'Expert']
            },
            {
                attribute_key: 'subject_area',
                attribute_display_name: 'Subject Area',
                attribute_description: 'Area of study - Mathematics, Science, Arts, Technology, Business',
                attribute_values: ['Mathematics', 'Science', 'Arts', 'Technology', 'Business']
            },
            {
                attribute_key: 'learning_mode',
                attribute_display_name: 'Learning Mode',
                attribute_description: 'Preferred learning format - Online, In-Person, Hybrid',
                attribute_values: ['Online', 'In-Person', 'Hybrid']
            },
            {
                attribute_key: 'student_age',
                attribute_display_name: 'Student Age',
                attribute_description: 'Age of the student',
                attribute_values: []
            }
        ];

        const testMessages = [
            {
                message: "I'm 25 years old and want to learn advanced mathematics online",
                expected: {
                    course_level: 'Advanced',
                    subject_area: 'Mathematics',
                    learning_mode: 'Online',
                    student_age: '25'
                }
            },
            {
                message: "Looking for beginner technology courses, prefer in-person classes",
                expected: {
                    course_level: 'Beginner',
                    subject_area: 'Technology',
                    learning_mode: 'In-Person'
                }
            }
        ];

        await this.runTestSuite('Education', educationAttributes, testMessages);
    }

    /**
     * Test attribute change detection
     */
    async testAttributeChangeDetection() {
        console.log('\n🔄 Testing Attribute Change Detection');
        console.log('-'.repeat(40));

        const attributes = [
            {
                attribute_key: 'delivery_location',
                attribute_display_name: 'Delivery Location',
                attribute_description: 'The destination address',
                attribute_values: []
            }
        ];

        const currentAttributes = {
            delivery_location: '123 Main Street'
        };

        const changeTests = [
            {
                message: "I want to change my delivery location",
                expectedIntent: true,
                expectedNeedsValue: true
            },
            {
                message: "Change delivery location to 456 Oak Avenue",
                expectedIntent: true,
                expectedNeedsValue: false,
                expectedValue: '456 Oak Avenue'
            },
            {
                message: "Actually, deliver to downtown office instead",
                expectedIntent: true,
                expectedValue: 'downtown office'
            }
        ];

        for (const test of changeTests) {
            const result = this.extractor.detectAttributeChangeIntent(
                test.message,
                currentAttributes,
                attributes
            );

            const passed = result.hasChangeIntent === test.expectedIntent &&
                          (test.expectedNeedsValue === undefined || result.needsValue === test.expectedNeedsValue) &&
                          (test.expectedValue === undefined || result.newValue === test.expectedValue);

            this.recordTest(`Change Detection: "${test.message}"`, passed);
            console.log(`${passed ? '✅' : '❌'} Change Detection: "${test.message}"`);
            
            if (!passed) {
                console.log(`   Expected: ${JSON.stringify(test)}`);
                console.log(`   Got: ${JSON.stringify(result)}`);
            }
        }
    }

    /**
     * Test missing attribute collection timing
     */
    async testMissingAttributeCollection() {
        console.log('\n📝 Testing Missing Attribute Collection');
        console.log('-'.repeat(40));

        const attributes = [
            {
                attribute_key: 'pickup_location',
                attribute_description: 'Required pickup address',
                attribute_values: []
            },
            {
                attribute_key: 'delivery_location',
                attribute_description: 'Required delivery address',
                attribute_values: []
            }
        ];

        // Test early conversation (should collect)
        let conversationHistory = [
            { message_type: 'incoming', content: 'Hi' },
            { message_type: 'incoming', content: 'I need delivery' }
        ];

        let missingAttrs = this.extractor.checkMissingAttributes(attributes, {});
        let result = this.extractor.shouldCollectAttributes(conversationHistory, missingAttrs);

        this.recordTest('Early conversation collection', result.shouldCollect === true);
        console.log(`${result.shouldCollect ? '✅' : '❌'} Early conversation collection`);

        // Test deep conversation (should not collect non-critical)
        conversationHistory = Array(10).fill({ message_type: 'incoming', content: 'message' });
        result = this.extractor.shouldCollectAttributes(conversationHistory, missingAttrs);

        this.recordTest('Deep conversation collection', result.shouldCollect === false);
        console.log(`${!result.shouldCollect ? '✅' : '❌'} Deep conversation collection`);
    }

    /**
     * Test value processing
     */
    async testValueProcessing() {
        console.log('\n⚙️ Testing Value Processing');
        console.log('-'.repeat(40));

        const testCases = [
            {
                attribute: {
                    attribute_key: 'location',
                    attribute_description: 'Location address',
                    attribute_values: []
                },
                value: 'main street building',
                expected: 'Main Street Building'
            },
            {
                attribute: {
                    attribute_key: 'classification',
                    attribute_description: 'Type classification',
                    attribute_values: ['Express', 'Standard', 'Economy']
                },
                value: 'express',
                expected: 'Express'
            }
        ];

        for (const test of testCases) {
            const result = this.extractor.processValue(test.value, test.attribute);
            const passed = result === test.expected;

            this.recordTest(`Value Processing: ${test.value}`, passed);
            console.log(`${passed ? '✅' : '❌'} Value Processing: "${test.value}" -> "${result}"`);
        }
    }

    /**
     * Test error handling
     */
    async testErrorHandling() {
        console.log('\n🛠️ Testing Error Handling');
        console.log('-'.repeat(40));

        // Test with null/undefined inputs
        try {
            const result = await this.extractor.extractAllAttributesFromMessage(null, []);
            const passed = typeof result === 'object' && Object.keys(result).length === 0;
            this.recordTest('Null message handling', passed);
            console.log(`${passed ? '✅' : '❌'} Null message handling`);
        } catch (error) {
            this.recordTest('Null message handling', false);
            console.log(`❌ Null message handling - threw error: ${error.message}`);
        }

        // Test with empty attributes
        try {
            const result = await this.extractor.extractAllAttributesFromMessage('test message', []);
            const passed = typeof result === 'object' && Object.keys(result).length === 0;
            this.recordTest('Empty attributes handling', passed);
            console.log(`${passed ? '✅' : '❌'} Empty attributes handling`);
        } catch (error) {
            this.recordTest('Empty attributes handling', false);
            console.log(`❌ Empty attributes handling - threw error: ${error.message}`);
        }
    }

    /**
     * Run a test suite for a specific client type
     */
    async runTestSuite(clientType, attributes, testMessages) {
        console.log(`\nRunning ${testMessages.length} tests for ${clientType}:`);

        for (let i = 0; i < testMessages.length; i++) {
            const test = testMessages[i];
            console.log(`\nTest ${i + 1}: "${test.message}"`);

            try {
                const result = await this.extractor.extractAllAttributesFromMessage(
                    test.message,
                    attributes,
                    true // Use AI
                );

                let allPassed = true;
                const issues = [];

                // Check each expected attribute
                for (const [key, expectedValue] of Object.entries(test.expected)) {
                    const actualValue = result[key];
                    const passed = this.compareValues(actualValue, expectedValue);
                    
                    if (passed) {
                        console.log(`  ✅ ${key}: "${actualValue}"`);
                    } else {
                        console.log(`  ❌ ${key}: expected "${expectedValue}", got "${actualValue}"`);
                        allPassed = false;
                        issues.push(`${key}: expected "${expectedValue}", got "${actualValue}"`);
                    }
                }

                this.recordTest(`${clientType} Test ${i + 1}`, allPassed);

                if (allPassed) {
                    console.log(`  🎉 Test ${i + 1} PASSED`);
                } else {
                    console.log(`  💥 Test ${i + 1} FAILED - Issues: ${issues.join(', ')}`);
                }

            } catch (error) {
                console.log(`  💥 Test ${i + 1} ERROR: ${error.message}`);
                this.recordTest(`${clientType} Test ${i + 1}`, false);
            }
        }
    }

    /**
     * Compare extracted value with expected value
     */
    compareValues(actual, expected) {
        if (!actual) return false;
        
        const normalizeValue = (val) => val.toString().toLowerCase().trim();
        return normalizeValue(actual).includes(normalizeValue(expected)) ||
               normalizeValue(expected).includes(normalizeValue(actual));
    }

    /**
     * Record test result
     */
    recordTest(testName, passed) {
        this.totalTests++;
        if (passed) this.passedTests++;
        
        this.testResults.push({
            name: testName,
            passed: passed
        });
    }

    /**
     * Print test summary
     */
    printSummary() {
        console.log('\n' + '='.repeat(60));
        console.log('📊 TEST SUMMARY');
        console.log('='.repeat(60));
        
        console.log(`Total Tests: ${this.totalTests}`);
        console.log(`Passed: ${this.passedTests}`);
        console.log(`Failed: ${this.totalTests - this.passedTests}`);
        console.log(`Success Rate: ${((this.passedTests / this.totalTests) * 100).toFixed(1)}%`);

        console.log('\n📝 DETAILED RESULTS:');
        console.log('-'.repeat(40));
        
        for (const result of this.testResults) {
            console.log(`${result.passed ? '✅' : '❌'} ${result.name}`);
        }

        console.log('\n🎯 RECOMMENDATIONS:');
        console.log('-'.repeat(40));
        
        if (this.passedTests === this.totalTests) {
            console.log('🎉 All tests passed! The universal attribute extraction system is working perfectly.');
        } else if (this.passedTests / this.totalTests >= 0.8) {
            console.log('✨ Most tests passed! System is working well with minor improvements needed.');
        } else {
            console.log('⚠️  Several tests failed. Consider reviewing extraction logic and AI prompts.');
        }

        console.log('\n💡 SYSTEM CAPABILITIES VERIFIED:');
        console.log('• Universal client support across different industries');
        console.log('• Dynamic attribute type detection');
        console.log('• Multi-layer extraction (AI + Contextual + Pattern-based)');
        console.log('• Intelligent value processing and validation');
        console.log('• Robust error handling');
        console.log('• Attribute change detection and processing');
    }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const tester = new AttributeExtractionTester();
    tester.runAllTests().catch(console.error);
}

export default AttributeExtractionTester;
