#!/bin/bash

# Universal Attribute Extraction Test Runner
# Easy script to run different types of tests

echo "🚀 Universal Attribute Extraction Test Runner"
echo "=============================================="

# Function to show usage
show_usage() {
    echo ""
    echo "Usage: ./run-tests.sh [option]"
    echo ""
    echo "Options:"
    echo "  quick           - Quick development tests"
    echo "  interactive     - Interactive testing mode"
    echo "  logistics       - Test logistics client"
    echo "  healthcare      - Test healthcare client"
    echo "  real_estate     - Test real estate client"
    echo "  ecommerce       - Test e-commerce client"
    echo "  financial       - Test financial services client"
    echo "  education       - Test education client"
    echo "  all             - Test all client configurations"
    echo "  comprehensive   - Run comprehensive test suite"
    echo "  change          - Test change detection (logistics)"
    echo "  benchmark       - Performance benchmark (logistics)"
    echo "  help            - Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./run-tests.sh quick"
    echo "  ./run-tests.sh logistics"
    echo "  ./run-tests.sh all"
    echo ""
}

# Check if node is available
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed or not in PATH"
    exit 1
fi

# Check if we have the required files
if [ ! -f "quick-test-attributes.js" ]; then
    echo "❌ Error: Test files not found. Make sure you're in the correct directory."
    exit 1
fi

# Handle different test options
case "$1" in
    "quick")
        echo "🔧 Running Quick Development Tests..."
        node quick-test-attributes.js
        ;;
    "interactive")
        echo "🎮 Starting Interactive Testing Mode..."
        node quick-test-attributes.js --interactive
        ;;
    "logistics")
        echo "📦 Testing Logistics Client..."
        node config-test-runner.js logistics
        ;;
    "healthcare")
        echo "🏥 Testing Healthcare Client..."
        node config-test-runner.js healthcare
        ;;
    "real_estate")
        echo "🏠 Testing Real Estate Client..."
        node config-test-runner.js real_estate
        ;;
    "ecommerce")
        echo "🛒 Testing E-Commerce Client..."
        node config-test-runner.js ecommerce
        ;;
    "financial")
        echo "💰 Testing Financial Services Client..."
        node config-test-runner.js financial
        ;;
    "education")
        echo "🎓 Testing Education Client..."
        node config-test-runner.js education
        ;;
    "all")
        echo "🌟 Testing All Client Configurations..."
        node config-test-runner.js all
        ;;
    "comprehensive")
        echo "🎯 Running Comprehensive Test Suite..."
        node test-attribute-extraction.js
        ;;
    "change")
        echo "🔄 Testing Change Detection..."
        node config-test-runner.js --change logistics
        ;;
    "benchmark")
        echo "⚡ Running Performance Benchmark..."
        node config-test-runner.js --benchmark logistics 10
        ;;
    "help"|"-h"|"--help")
        show_usage
        ;;
    "")
        echo "❌ No test option provided."
        show_usage
        exit 1
        ;;
    *)
        echo "❌ Unknown test option: $1"
        show_usage
        exit 1
        ;;
esac

echo ""
echo "✅ Test completed!"
echo ""
echo "📚 For more information:"
echo "  - Read TESTING-GUIDE.md for comprehensive documentation"
echo "  - Read TESTING-README.md for detailed technical information"
echo "  - Use './run-tests.sh help' to see all options"
