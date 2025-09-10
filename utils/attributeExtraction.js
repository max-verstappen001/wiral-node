import dotenv from 'dotenv';
dotenv.config();
class AttributeExtractor {
    constructor(logger = console) {
        this.logger = logger;
    }

    /**
     * Enhanced change detection that works with any client's attributes dynamically
     */
    detectAttributeChangeIntent(message, currentAttributes, requiredAttributes) {
        const lowerMessage = message.toLowerCase().trim();

        this.logger.info(`=== CHANGE DETECTION ===`);
        this.logger.info(`Message: "${message}"`);
        this.logger.info(`Current attributes:`, currentAttributes);

        const detectionResult = {
            hasChangeIntent: false,
            changeType: null,
            attributeKey: null,
            newValue: null,
            confidence: 0,
            matchedPattern: null,
            needsValue: false
        };

        // STEP 1: Check for explicit change requests (without values)
        const changeRequestPatterns = [
            /(?:i\s+want\s+(?:to\s+)?change)\s+(?:my\s+|me\s+)?([\w\s]+)/gi,
            /(?:want\s+(?:to\s+)?change)\s+(?:my\s+|me\s+)?([\w\s]+)/gi,
            /(?:change|update|modify)\s+(?:my\s+|me\s+)?([\w\s]+)/gi,
        ];

        for (const pattern of changeRequestPatterns) {
            pattern.lastIndex = 0;
            const match = pattern.exec(lowerMessage);
            if (match) {
                const potentialKey = match[1].trim();
                this.logger.info(`Found change request pattern: "${potentialKey}"`);

                // Find matching attribute dynamically
                const matchingAttr = this.findAttributeByKeyword(potentialKey, requiredAttributes);
                if (matchingAttr && currentAttributes[matchingAttr.attribute_key]) {
                    this.logger.info(`Matched to attribute: ${matchingAttr.attribute_key}`);

                    detectionResult.hasChangeIntent = true;
                    detectionResult.changeType = 'change_request';
                    detectionResult.attributeKey = matchingAttr.attribute_key;
                    detectionResult.newValue = null;
                    detectionResult.confidence = 0.9;
                    detectionResult.matchedPattern = pattern.source;
                    detectionResult.needsValue = true;

                    return detectionResult;
                }
            }
        }

        // STEP 2: Check if this is a simple value response (but be more restrictive)
        if (lowerMessage.length < 50 && lowerMessage.length > 2 && !this.containsQuestionWords(lowerMessage)) {
            // First, check if this is a common conversational response that should be ignored
            const commonResponses = [
                'hi', 'hello', 'hey', 'yes', 'no', 'ok', 'okay', 'thanks', 'thank you', 
                'good', 'fine', 'sure', 'alright', 'right', 'correct', 'great', 'awesome',
                'nice', 'cool', 'perfect', 'exactly', 'yep', 'nope', 'yeah', 'nah', 'well',
                'hmm', 'um', 'uh', 'ah', 'oh', 'wow', 'indeed', 'absolutely', 'definitely'
            ];
            
            if (commonResponses.includes(lowerMessage.trim())) {
                this.logger.info(`Ignoring common conversational response: "${lowerMessage}"`);
                return detectionResult;
            }
            
            // Only consider if message contains meaningful content indicators
            const hasNumbers = /\d/.test(message);
            const hasLetters = /[a-zA-Z]{3,}/.test(message); // At least 3 consecutive letters
            const seemsLikeAddress = /\b(street|st|road|rd|avenue|ave|lane|ln|drive|dr|place|pl|way|blvd|boulevard|court|ct|floor|apt|apartment|unit|building|block)\b/i.test(lowerMessage);
            const seemsLikeLocation = /\b(near|at|in|from|to|opposite|next to|beside|behind|front of|around|close to|by)\b/i.test(lowerMessage);
            const hasSpecialChars = /[@#$%^&*()_+=\[\]{};':"\\|,.<>\?\/~`]/.test(message);
            
            // Only proceed if it seems like actual content, not just a greeting or confirmation
            const hasContentIndicators = hasNumbers || seemsLikeAddress || seemsLikeLocation || hasSpecialChars || lowerMessage.length > 15;
            
            if (hasLetters && hasContentIndicators) {
                // Check against any attribute that exists and could match this value
                const potentialMatch = this.findBestAttributeForValue(lowerMessage.trim(), requiredAttributes, currentAttributes);
                if (potentialMatch) {
                    this.logger.info(`Potential value response for ${potentialMatch.attribute_key}: "${lowerMessage}"`);

                    detectionResult.hasChangeIntent = true;
                    detectionResult.changeType = 'value_response';
                    detectionResult.attributeKey = potentialMatch.attribute_key;
                    detectionResult.newValue = lowerMessage.trim();
                    detectionResult.confidence = 0.6; // Lower confidence for value responses
                    detectionResult.matchedPattern = 'simple_value_response';

                    return detectionResult;
                }
            } else {
                this.logger.info(`Message "${lowerMessage}" doesn't contain content indicators, ignoring as potential attribute value`);
            }
        }

        // STEP 3: Check for explicit value changes ("change X to Y")
        const valueChangePatterns = [
            /(?:change|update)\s+(?:my\s+)?([\w\s]+?)\s+(?:to|is|from\s+\w+\s+to)\s+([\w\s-]+)/gi,
            /(?:my\s+)([\w\s]+?)\s+(?:is\s+now|should\s+be|becomes?)\s+([\w\s-]+)/gi,
        ];

        for (const pattern of valueChangePatterns) {
            pattern.lastIndex = 0;
            const match = pattern.exec(lowerMessage);
            if (match) {
                const potentialKey = match[1].trim();
                const potentialValue = match[2].trim();

                this.logger.info(`Found value change pattern: "${potentialKey}" -> "${potentialValue}"`);

                const matchingAttr = this.findAttributeByKeyword(potentialKey, requiredAttributes);
                if (matchingAttr && currentAttributes[matchingAttr.attribute_key]) {
                    this.logger.info(`Matched to attribute: ${matchingAttr.attribute_key}`);

                    detectionResult.hasChangeIntent = true;
                    detectionResult.changeType = 'explicit_change';
                    detectionResult.attributeKey = matchingAttr.attribute_key;
                    detectionResult.newValue = potentialValue;
                    detectionResult.confidence = 0.95;
                    detectionResult.matchedPattern = pattern.source;

                    return detectionResult;
                }
            }
        }

        this.logger.info(`No change intent detected`);
        return detectionResult;
    }

    /**
     * Dynamic attribute finder that works with any client's attributes
     */
    findAttributeByKeyword(searchText, requiredAttributes) {
        const normalizedSearch = searchText.toLowerCase().replace(/[_-\s]/g, '');

        this.logger.info(`Searching for attribute with text: "${searchText}" (normalized: "${normalizedSearch}")`);

        // Dynamic keyword extraction from attribute definitions
        for (const attr of requiredAttributes) {
            // Check attribute key
            const normalizedKey = attr.attribute_key.toLowerCase().replace(/[_-]/g, '');
            if (normalizedKey.includes(normalizedSearch) || normalizedSearch.includes(normalizedKey)) {
                this.logger.info(`Found via attribute key: ${attr.attribute_key}`);
                return attr;
            }

            // Check display name
            if (attr.attribute_display_name) {
                const normalizedDisplay = attr.attribute_display_name.toLowerCase().replace(/[_-\s]/g, '');
                if (normalizedDisplay.includes(normalizedSearch) || normalizedSearch.includes(normalizedDisplay)) {
                    this.logger.info(`Found via display name: ${attr.attribute_key}`);
                    return attr;
                }
            }

            // Check description keywords
            if (attr.attribute_description) {
                const descriptionWords = attr.attribute_description.toLowerCase()
                    .split(/\s+/)
                    .filter(word => word.length > 3)
                    .map(word => word.replace(/[^a-z]/g, ''));

                for (const word of descriptionWords) {
                    if (word.includes(normalizedSearch) || normalizedSearch.includes(word)) {
                        this.logger.info(`Found via description keyword "${word}": ${attr.attribute_key}`);
                        return attr;
                    }
                }
            }

            // Check individual words in the search text against attribute components
            const searchWords = searchText.toLowerCase().split(/\s+/);
            for (const searchWord of searchWords) {
                const normalizedSearchWord = searchWord.replace(/[^a-z]/g, '');
                if (normalizedSearchWord.length > 2) {
                    if (normalizedKey.includes(normalizedSearchWord) ||
                        (attr.attribute_display_name && attr.attribute_display_name.toLowerCase().includes(normalizedSearchWord))) {
                        this.logger.info(`Found via word match "${searchWord}": ${attr.attribute_key}`);
                        return attr;
                    }
                }
            }
        }

        this.logger.info(`No attribute found for: "${searchText}"`);
        return null;
    }

    /**
     * Find the best attribute for a given value (for value responses) - Completely Dynamic
     */
    findBestAttributeForValue(value, requiredAttributes, currentAttributes) {
        const lowerValue = value.toLowerCase().trim();
        
        // Don't match common conversational words to any attribute
        const conversationalWords = [
            'hi', 'hello', 'hey', 'yes', 'no', 'ok', 'okay', 'thanks', 'thank you', 
            'good', 'fine', 'sure', 'alright', 'right', 'correct', 'great', 'awesome',
            'nice', 'cool', 'perfect', 'exactly', 'yep', 'nope', 'yeah', 'nah'
        ];
        
        if (conversationalWords.includes(lowerValue)) {
            this.logger.info(`Not matching conversational word "${value}" to any attribute`);
            return null;
        }

        // Only consider missing attributes (not ones that already have values)
        const missingAttributes = requiredAttributes.filter(attr =>
            !currentAttributes[attr.attribute_key] || currentAttributes[attr.attribute_key] === ''
        );

        this.logger.info(`Checking value "${value}" against ${missingAttributes.length} missing attributes`);

        // Score each attribute based on how well the value matches
        const attributeScores = [];

        for (const attr of missingAttributes) {
            let score = 0;
            const reasons = [];

            // Check predefined attribute values (highest priority)
            if (attr.attribute_values && attr.attribute_values.length > 0) {
                for (const possibleValue of attr.attribute_values) {
                    const similarity = this.calculateStringSimilarity(lowerValue, possibleValue.toLowerCase());
                    if (similarity > 0.8) {
                        score += 10;
                        reasons.push(`exact_value_match:${similarity}`);
                    } else if (similarity > 0.5) {
                        score += 5;
                        reasons.push(`partial_value_match:${similarity}`);
                    }
                }
            }

            // Analyze attribute description dynamically
            if (attr.attribute_description) {
                const descriptionScore = this.scoreValueAgainstDescription(value, attr.attribute_description);
                score += descriptionScore.score;
                reasons.push(...descriptionScore.reasons);
            }

            // Check attribute key/display name relevance
            const keyScore = this.scoreValueAgainstAttributeNames(value, attr);
            score += keyScore.score;
            reasons.push(...keyScore.reasons);

            if (score > 0) {
                attributeScores.push({
                    attribute: attr,
                    score,
                    reasons
                });
            }
        }

        // Sort by score and return the best match
        attributeScores.sort((a, b) => b.score - a.score);

        if (attributeScores.length > 0 && attributeScores[0].score >= 3) {
            const bestMatch = attributeScores[0];
            this.logger.info(`Best match for value "${value}": ${bestMatch.attribute.attribute_key} (score: ${bestMatch.score}, reasons: ${bestMatch.reasons.join(', ')})`);
            return bestMatch.attribute;
        }

        this.logger.info(`No suitable attribute found for value: "${value}"`);
        return null;
    }

    /**
     * Calculate string similarity between two strings
     */
    calculateStringSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) return 1.0;
        
        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    /**
     * Calculate Levenshtein distance
     */
    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    /**
     * Score value against attribute description dynamically
     */
    scoreValueAgainstDescription(value, description) {
        const desc = description.toLowerCase();
        const val = value.toLowerCase();
        let score = 0;
        const reasons = [];

        // Dynamic pattern detection based on description content
        const patterns = {
            email: {
                keywords: ['email', 'e-mail', 'mail'],
                validator: (v) => /@/.test(v) && /\.[a-z]{2,}$/i.test(v),
                score: 8
            },
            phone: {
                keywords: ['phone', 'mobile', 'contact', 'number', 'call'],
                validator: (v) => /[\d\s\-\+\(\)]{8,}/.test(v) && /\d{8,}/.test(v.replace(/\D/g, '')),
                score: 8
            },
            location: {
                keywords: ['location', 'address', 'place', 'pickup', 'drop', 'where', 'from', 'to'],
                validator: (v) => {
                    const hasLocationWords = /\b(street|st|road|rd|avenue|ave|lane|ln|drive|dr|place|pl|way|building|apt|floor|near|at|in|downtown|uptown|city|area)\b/i.test(v);
                    const hasNumbers = /\d/.test(v);
                    const isLongEnough = v.length > 5;
                    const hasMultipleWords = v.split(' ').length > 1;
                    return hasLocationWords || hasNumbers || (isLongEnough && hasMultipleWords);
                },
                score: 6
            },
            name: {
                keywords: ['name', 'first', 'last', 'full'],
                validator: (v) => /^[a-zA-Z\s\-'\.]{2,}$/.test(v) && v.split(' ').length <= 4,
                score: 5
            },
            classification: {
                keywords: ['classification', 'type', 'category', 'level', 'priority', 'status'],
                validator: (v) => {
                    // Extract possible values from description
                    const possibleValues = this.extractPossibleValuesFromDescription(description);
                    return possibleValues.some(pv => 
                        pv.toLowerCase().includes(v) || v.includes(pv.toLowerCase())
                    );
                },
                score: 7
            },
            date: {
                keywords: ['date', 'time', 'when', 'schedule', 'appointment'],
                validator: (v) => /\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{2}-\d{2}|tomorrow|today|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday/.test(v),
                score: 6
            }
        };

        // Check each pattern
        for (const [patternName, pattern] of Object.entries(patterns)) {
            const hasKeywords = pattern.keywords.some(keyword => desc.includes(keyword));
            if (hasKeywords && pattern.validator(value)) {
                score += pattern.score;
                reasons.push(`${patternName}_match`);
                break; // Only count the best match
            }
        }

        // Check for contextual clues in description
        const contextWords = desc.split(/\s+/).filter(word => word.length > 3);
        const valueWords = val.split(/\s+/);
        
        const contextMatches = contextWords.filter(word => 
            valueWords.some(vword => vword.includes(word) || word.includes(vword))
        );
        
        if (contextMatches.length > 0) {
            score += contextMatches.length;
            reasons.push(`context_words:${contextMatches.join(',')}`);
        }

        return { score, reasons };
    }

    /**
     * Score value against attribute names
     */
    scoreValueAgainstAttributeNames(value, attribute) {
        const val = value.toLowerCase();
        let score = 0;
        const reasons = [];

        // Check attribute key
        const key = attribute.attribute_key.toLowerCase();
        const keyWords = key.split(/[_-]/);
        
        const keyMatches = keyWords.filter(word => 
            val.includes(word) || word.includes(val)
        );
        
        if (keyMatches.length > 0) {
            score += keyMatches.length * 2;
            reasons.push(`key_match:${keyMatches.join(',')}`);
        }

        // Check display name
        if (attribute.attribute_display_name) {
            const displayName = attribute.attribute_display_name.toLowerCase();
            const displayWords = displayName.split(/\s+/);
            
            const displayMatches = displayWords.filter(word => 
                val.includes(word) || word.includes(val)
            );
            
            if (displayMatches.length > 0) {
                score += displayMatches.length * 2;
                reasons.push(`display_match:${displayMatches.join(',')}`);
            }
        }

        return { score, reasons };
    }

    /**
     * Check if message contains question words
     */
    containsQuestionWords(message) {
        const questionWords = ['what', 'how', 'when', 'where', 'why', 'which', 'who', 'can', 'could', 'would', 'should'];
        return questionWords.some(word => message.includes(word));
    }

    /**
     * Smart attribute collection timing - don't ask after certain conversation depth
     */
    shouldCollectAttributes(conversationHistory, missingAttributes) {
        if (!missingAttributes || missingAttributes.length === 0) {
            return { shouldCollect: false, reason: 'no_missing_attributes' };
        }

        // Count actual conversation turns (ignore system messages)
        const conversationTurns = conversationHistory.filter(msg =>
            msg.message_type === 'incoming' || msg.sender?.type === 'contact'
        ).length;

        this.logger.info(`Conversation turns: ${conversationTurns}, Missing attributes: ${missingAttributes.length}`);

        // Always collect attributes in first 5 conversation turns
        if (conversationTurns <= 5) {
            return {
                shouldCollect: true,
                reason: 'early_conversation',
                attributesToCollect: missingAttributes.slice(0, 1), // Only ask for one at a time
                turnCount: conversationTurns
            };
        }

        // After 5 turns, only collect critical attributes
        const criticalAttributes = missingAttributes.filter(attr =>
            attr.attribute_description && (
                attr.attribute_description.toLowerCase().includes('required') ||
                attr.attribute_description.toLowerCase().includes('mandatory') ||
                attr.attribute_description.toLowerCase().includes('essential')
            )
        );

        if (criticalAttributes.length === 0) {
            return {
                shouldCollect: false,
                reason: 'conversation_too_deep_no_critical_attributes',
                turnCount: conversationTurns
            };
        }

        return {
            shouldCollect: true,
            reason: 'critical_attributes_only',
            attributesToCollect: criticalAttributes,
            turnCount: conversationTurns
        };
    }

    /**
     * Process attribute changes
     */
    async processAttributeChanges(message, currentAttributes, requiredAttributes, api_access_token, account_id, contact_id) {
        this.logger.info(`=== PROCESSING ATTRIBUTE CHANGES ===`);

        // Detect change intent
        const changeIntent = this.detectAttributeChangeIntent(message, currentAttributes, requiredAttributes);

        if (!changeIntent.hasChangeIntent) {
            this.logger.info(`No change intent detected`);
            return { hasChanges: false };
        }

        this.logger.info(`Change intent detected:`, changeIntent);

        // Handle change request (when user wants to change but hasn't provided new value)
        if (changeIntent.needsValue) {
            const attributeDef = requiredAttributes.find(attr => attr.attribute_key === changeIntent.attributeKey);
            const questionMessage = this.generateAttributeChangeQuestion(attributeDef);

            this.logger.info(`Asking for new value: "${questionMessage}"`);

            return {
                hasChanges: true,
                success: false,
                needsValue: true,
                clarificationQuestion: questionMessage,
                attributeKey: changeIntent.attributeKey
            };
        }

        // Handle the change with provided value
        const changeResult = await this.handleAttributeChange(
            changeIntent,
            currentAttributes,
            requiredAttributes,
            api_access_token,
            account_id,
            contact_id
        );

        if (changeResult.success) {
            const confirmationMessage = this.generateChangeConfirmationMessage(changeResult);

            return {
                hasChanges: true,
                success: true,
                updatedAttributes: changeResult.updatedAttributes,
                confirmationMessage,
                changeDetails: changeResult
            };
        } else {
            return {
                hasChanges: true,
                success: false,
                error: changeResult.error
            };
        }
    }

    /**
     * Handle the actual attribute change
     */
    async handleAttributeChange(changeIntent, currentAttributes, requiredAttributes, api_access_token, account_id, contact_id) {
        const { attributeKey, newValue } = changeIntent;

        // Find attribute definition
        const attributeDef = requiredAttributes.find(attr => attr.attribute_key === attributeKey);
        if (!attributeDef) {
            this.logger.error(`Attribute definition not found for ${attributeKey}`);
            return { success: false, error: 'Attribute not found' };
        }

        // Process the new value
        const processedValue = this.processValue(newValue, attributeDef);
        if (!processedValue) {
            this.logger.warn(`Invalid value for ${attributeKey}: ${newValue}`);
            return { success: false, error: 'Invalid value' };
        }

        // Update attributes
        const updatedAttributes = { ...currentAttributes };
        const previousValue = updatedAttributes[attributeKey];
        updatedAttributes[attributeKey] = processedValue;

        try {
            // Update in Chatwoot
            await this.updateContactAttributes(account_id, contact_id, updatedAttributes, api_access_token);

            this.logger.info(`Successfully changed ${attributeKey} from "${previousValue}" to "${processedValue}"`);

            return {
                success: true,
                attributeKey,
                previousValue,
                newValue: processedValue,
                changeType: changeIntent.changeType,
                updatedAttributes
            };
        } catch (error) {
            this.logger.error(`Failed to update attribute ${attributeKey}:`, error.message);
            return { success: false, error: 'Update failed' };
        }
    }

    /**
     * Generate question for attribute change
     */
    generateAttributeChangeQuestion(attributeDef) {
        const displayName = attributeDef?.attribute_display_name || attributeDef?.attribute_key || 'that field';

        // Include possible values if available
        if (attributeDef.attribute_values && attributeDef.attribute_values.length > 0) {
            const options = attributeDef.attribute_values.join(', ');
            return `What would you like to change your ${displayName.toLowerCase()} to? (Options: ${options})`;
        }

        return `What would you like to change your ${displayName.toLowerCase()} to?`;
    }

    /**
     * Generate change confirmation message
     */
    generateChangeConfirmationMessage(changeResult) {
        const { attributeKey, previousValue, newValue } = changeResult;
        const displayName = this.getAttributeDisplayName(attributeKey, changeResult.attributeDef);
        return `I've updated your ${displayName.toLowerCase()} from "${previousValue}" to "${newValue}".`;
    }

    /**
     * Get display name for attribute (dynamic)
     */
    getAttributeDisplayName(attributeKey, attributeDef = null) {
        if (attributeDef && attributeDef.attribute_display_name) {
            return attributeDef.attribute_display_name;
        }

        // Fallback to formatted key
        return attributeKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    /**
     * Process and clean attribute values (dynamic based on description)
     */
    processValue(value, attributeDef) {
        if (!value) return null;

        let cleaned = value.toString().trim();

        // Handle predefined values first
        if (attributeDef.attribute_values && attributeDef.attribute_values.length > 0) {
            const lowerValue = cleaned.toLowerCase();
            for (const possibleValue of attributeDef.attribute_values) {
                if (possibleValue.toLowerCase().includes(lowerValue) || lowerValue.includes(possibleValue.toLowerCase())) {
                    return possibleValue; // Return exact predefined value
                }
            }
        }

        // Dynamic processing based on description
        if (attributeDef.attribute_description) {
            const desc = attributeDef.attribute_description.toLowerCase();

            // Location handling
            if (desc.includes('location') || desc.includes('address')) {
                return cleaned.split(' ').map(word =>
                    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                ).join(' ');
            }

            // Classification handling
            if (desc.includes('classif')) {
                // Extract possible values from description
                const possibleValues = this.extractPossibleValuesFromDescription(attributeDef.attribute_description);
                if (possibleValues.length > 0) {
                    const lowerValue = cleaned.toLowerCase();
                    for (const option of possibleValues) {
                        if (option.toLowerCase().includes(lowerValue) || lowerValue.includes(option.toLowerCase())) {
                            return option;
                        }
                    }
                }
            }
        }

        return cleaned;
    }

    /**
     * Update contact attributes in Chatwoot
     */
    async updateContactAttributes(accountId, contactId, attributes, api_access_token) {
        const axios = (await import('axios')).default;
        const CHATWOOT_URL = process.env.CHATWOOT_URL;

        this.logger.info(`Updating contact ${contactId} with attributes:`, attributes);

        await axios.put(
            `${CHATWOOT_URL}/api/v1/accounts/${accountId}/contacts/${contactId}`,
            { custom_attributes: attributes },
            {
                headers: { "Content-Type": "application/json", api_access_token: api_access_token },
                timeout: 10000,
            }
        );

        this.logger.info(`Successfully updated contact ${contactId} attributes`);
    }

    // Keep existing methods for compatibility
    checkMissingAttributes(requiredAttributes, currentAttributes) {
        const missing = [];
        for (const attr of requiredAttributes) {
            if (!currentAttributes[attr.attribute_key] || currentAttributes[attr.attribute_key] === '') {
                missing.push(attr);
            }
        }
        return missing;
    }

    extractPossibleValuesFromDescription(description) {
        if (!description) return [];

        const patterns = [
            /(?:values?|options?)[^-]*-\s*([^.!?]+)/i,
            /(?:can be|include|are)[^:]*:\s*([^.!?]+)/i,
            /(?:one of these \d+ values?)[^-]*-\s*([^.!?]+)/i
        ];

        for (const pattern of patterns) {
            const match = description.match(pattern);
            if (match) {
                return match[1].split(',').map(v => v.trim()).filter(v => v.length > 0);
            }
        }

        return [];
    }

    // Simplified AI extraction for normal attribute collection
    async extractAllAttributesFromMessage(message, requiredAttributes, useAI = true) {
        const extractedAttributes = {};

        if (!message || !requiredAttributes || requiredAttributes.length === 0) {
            return extractedAttributes;
        }

        this.logger.info(`Starting extraction from message: "${message}"`);

        if (useAI) {
            try {
                const aiExtracted = await this.extractUsingAI(message, requiredAttributes);
                Object.assign(extractedAttributes, aiExtracted);
                this.logger.info(`AI extracted:`, aiExtracted);
            } catch (error) {
                this.logger.warn(`AI extraction failed: ${error.message}`);
            }
        }

        return extractedAttributes;
    }

    async extractUsingAI(message, requiredAttributes) {
        try {
            const { ChatOpenAI } = await import("@langchain/openai");
            const { ChatPromptTemplate } = await import("@langchain/core/prompts");
            const { StringOutputParser } = await import("@langchain/core/output_parsers");

            const prompt = ChatPromptTemplate.fromMessages([
                ["system", `You are an expert data extraction assistant. Extract specific information from user messages.

RULES:
1. Extract only information explicitly mentioned in the message
2. Return valid JSON format only
3. Use null for information not found
4. Don't guess or infer - be precise
5. Match classification values to closest valid option when provided

Attributes to extract:
{attributeInfo}

Example response format: {{"attribute_key": "value"}}`],
                ["human", `Message: "{message}"

Extract the attributes listed above and return only a JSON object:`]
            ]);

            const attributeInfo = requiredAttributes.map(attr => {
                let info = `- ${attr.attribute_key}: ${attr.attribute_description}`;

                const possibleValues = this.extractPossibleValuesFromDescription(attr.attribute_description);
                if (possibleValues.length > 0) {
                    info += ` (Valid options: ${possibleValues.join(', ')})`;
                }

                return info;
            }).join('\n');

            const llm = new ChatOpenAI({
                apiKey: process.env.OPENAI_API_KEY,
                model: "gpt-4o-mini",
                temperature: 0,
                maxTokens: 300
            });

            const chain = prompt.pipe(llm).pipe(new StringOutputParser());

            const result = await chain.invoke({
                message: message,
                attributeInfo: attributeInfo
            });

            this.logger.info(`AI extraction raw result: ${result}`);

            // Parse and validate result
            const cleaned = result.replace(/```json|```|```/g, '').trim();

            if (!cleaned.startsWith('{')) {
                this.logger.warn(`AI returned non-JSON response: ${cleaned}`);
                return {};
            }

            const parsed = JSON.parse(cleaned);

            const validated = {};
            for (const [key, value] of Object.entries(parsed)) {
                if (value && value !== null && value !== '') {
                    const attrDef = requiredAttributes.find(a => a.attribute_key === key);
                    if (attrDef) {
                        const processed = this.processValue(value, attrDef);
                        if (processed) {
                            validated[key] = processed;
                        }
                    }
                }
            }

            return validated;

        } catch (error) {
            this.logger.error(`AI extraction error: ${error.message}`);
            return {};
        }
    }

    /**
     * Detects contradictions between message content and existing attributes
     */
    detectValueContradictions(message, currentAttributes, requiredAttributes) {
        const result = {
            hasContradiction: false,
            attributeKey: null,
            newValue: null,
            confidence: 0
        };

        // Extract all possible values from the message
        const extractedFromMessage = this.extractAllAttributesFromMessageSync(message, requiredAttributes);

        for (const [key, extractedValue] of Object.entries(extractedFromMessage)) {
            const currentValue = currentAttributes[key];
            if (currentValue && extractedValue && this.normalizeValue(currentValue) !== this.normalizeValue(extractedValue)) {
                result.hasContradiction = true;
                result.attributeKey = key;
                result.newValue = extractedValue;
                result.confidence = 0.7;
                this.logger.info(`Detected value contradiction for ${key}: current="${currentValue}", extracted="${extractedValue}"`);
                return result;
            }
        }
        return result;
    }

    /**
     * Synchronous version of attribute extraction for change detection
     */
    extractAllAttributesFromMessageSync(message, requiredAttributes) {
        const extractedAttributes = {};
        for (const attribute of requiredAttributes) {
            const extracted = this.extractUsingRegex(message, attribute);
            if (extracted) {
                extractedAttributes[attribute.attribute_key] = extracted;
            }
        }
        return extractedAttributes;
    }

    /**
     * Handles the attribute change process
     */
    async handleAttributeChange(changeIntent, currentAttributes, requiredAttributes, api_access_token, account_id, contact_id) {
        let { attributeKey, newValue, changeType, _llmExtractionNeeded } = changeIntent;
        // Find attribute definition
        const attributeDef = requiredAttributes.find(attr => attr.attribute_key === attributeKey);
        if (!attributeDef) {
            this.logger.error(`Attribute definition not found for ${attributeKey}`);
            return { success: false, error: 'Attribute not found' };
        }
        // If LLM extraction is needed, extract value using LLM
        if (_llmExtractionNeeded) {
            try {
                const aiExtracted = await this.extractUsingAI(
                    `User wants to change ${attributeDef.attribute_display_name || attributeKey}. Message: "${arguments[0].message || ''}"`,
                    [attributeDef]
                );
                if (aiExtracted && aiExtracted[attributeKey]) {
                    newValue = aiExtracted[attributeKey];
                    this.logger.info(`LLM extracted new value for ${attributeKey}: ${newValue}`);
                }
            } catch (err) {
                this.logger.warn(`LLM extraction failed for ${attributeKey}: ${err.message}`);
            }
        }
        // Validate new value
        const processedValue = this.processValue(newValue, attributeDef);
        if (!processedValue) {
            this.logger.warn(`Invalid value for ${attributeKey}: ${newValue}`);
            return {
                success: false,
                error: 'Invalid value',
                needsConfirmation: true,
                question: `The value "${newValue}" doesn't seem valid for ${attributeDef.attribute_display_name || attributeKey}. ${this.generateAttributeQuestion(attributeDef)}`
            };
        }
        // Update attributes
        const updatedAttributes = { ...currentAttributes };
        const previousValue = updatedAttributes[attributeKey];
        updatedAttributes[attributeKey] = processedValue;
        try {
            // Update in Chatwoot
            await this.updateContactAttributes(account_id, contact_id, updatedAttributes, api_access_token);
            this.logger.info(`Successfully changed ${attributeKey} from "${previousValue}" to "${processedValue}"`);
            return {
                success: true,
                attributeKey,
                previousValue,
                newValue: processedValue,
                changeType,
                updatedAttributes
            };
        } catch (error) {
            this.logger.error(`Failed to update attribute ${attributeKey}:`, error.message);
            return { success: false, error: 'Update failed' };
        }
    }

    /**
     * Generates confirmation message for attribute changes
     */
    generateChangeConfirmationMessage(changeResult) {
        const { attributeKey, previousValue, newValue, changeType } = changeResult;
        const displayName = this.getAttributeDisplayName(attributeKey);
        switch (changeType) {
            case 'explicit':
                return `I've updated your ${displayName} from "${previousValue}" to "${newValue}".`;
            case 'contradiction':
                return `I noticed you mentioned a different ${displayName}. I've updated it from "${previousValue}" to "${newValue}".`;
            default:
                return `Your ${displayName} has been changed to "${newValue}".`;
        }
    }

    /**
     * Generates clarification question when change intent is unclear
     */
    generateChangeClarificationQuestion(attributeKey, detectedValue, currentValue) {
        const displayName = this.getAttributeDisplayName(attributeKey);
        return `I notice you mentioned "${detectedValue}" for your ${displayName}, but I have "${currentValue}" on record. Would you like me to update it to "${detectedValue}"?`;
    }

    /**
     * Helper methods
     */
    findAttributeByKey(searchKey, requiredAttributes) {
        const normalizedSearch = searchKey.toLowerCase().replace(/[_-]/g, '');
        return requiredAttributes.find(attr => {
            const normalizedKey = attr.attribute_key.toLowerCase().replace(/[_-]/g, '');
            const normalizedDisplay = (attr.attribute_display_name || '').toLowerCase().replace(/[_-\s]/g, '');
            return normalizedKey.includes(normalizedSearch) ||
                normalizedSearch.includes(normalizedKey) ||
                normalizedDisplay.includes(normalizedSearch) ||
                normalizedSearch.includes(normalizedDisplay);
        });
    }

    normalizeValue(value) {
        return value.toString().toLowerCase().trim().replace(/\s+/g, ' ');
    }

    getAttributeDisplayName(attributeKey) {
        // This should ideally access the attribute definition to get display name
        return attributeKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    async updateContactAttributes(accountId, contactId, attributes, api_access_token) {
        const axios = (await import('axios')).default;
        const CHATWOOT_URL = process.env.CHATWOOT_URL;
        await axios.put(
            `${CHATWOOT_URL}/api/v1/accounts/${accountId}/contacts/${contactId}`,
            { custom_attributes: attributes },
            {
                headers: { "Content-Type": "application/json", api_access_token: api_access_token },
                timeout: 10000,
            }
        );
    }

    /**
     * Main method to process attribute changes in webhook
     */
    async processAttributeChanges(message, currentAttributes, requiredAttributes, api_access_token, account_id, contact_id) {
        // First detect if there's change intent
        const changeIntent = this.detectAttributeChangeIntent(message, currentAttributes, requiredAttributes);
        if (!changeIntent.hasChangeIntent) {
            return { hasChanges: false };
        }
        this.logger.info(`Processing attribute change:`, changeIntent);
        // Handle the change
        const changeResult = await this.handleAttributeChange(
            changeIntent,
            currentAttributes,
            requiredAttributes,
            api_access_token,
            account_id,
            contact_id
        );
        if (changeResult.success) {
            const confirmationMessage = this.generateChangeConfirmationMessage(changeResult);
            return {
                hasChanges: true,
                success: true,
                updatedAttributes: changeResult.updatedAttributes,
                confirmationMessage,
                changeDetails: changeResult
            };
        } else if (changeResult.needsConfirmation) {
            return {
                hasChanges: true,
                success: false,
                needsConfirmation: true,
                clarificationQuestion: changeResult.question
            };
        } else {
            return {
                hasChanges: true,
                success: false,
                error: changeResult.error
            };
        }
    }

    checkMissingAttributes(requiredAttributes, currentAttributes) {
        const missing = [];
        for (const attr of requiredAttributes) {
            if (!currentAttributes[attr.attribute_key] || currentAttributes[attr.attribute_key] === '') {
                missing.push(attr);
            }
        }
        return missing;
    }

    async extractAllAttributesFromMessage(message, requiredAttributes, useAI = true) {
        const extractedAttributes = {};

        if (!message || !requiredAttributes || requiredAttributes.length === 0) {
            return extractedAttributes;
        }

        this.logger.info(`Starting universal extraction from message: "${message}"`);
        this.logger.info(`Client has ${requiredAttributes.length} custom attributes to extract`);

        // STEP 1: AI Extraction (primary method - works for any client)
        if (useAI) {
            try {
                const aiExtracted = await this.extractUsingAI(message, requiredAttributes);
                Object.assign(extractedAttributes, aiExtracted);
                this.logger.info(`AI extracted (client-agnostic):`, aiExtracted);
            } catch (error) {
                this.logger.warn(`AI extraction failed: ${error.message}`);
            }
        }

        // STEP 2: Dynamic Contextual Extraction (fallback - also client-agnostic)
        const remainingAttributes = requiredAttributes.filter(attr => !extractedAttributes[attr.attribute_key]);
        this.logger.info(`Running contextual extraction for ${remainingAttributes.length} remaining attributes`);

        for (const attribute of remainingAttributes) {
            const contextualExtracted = this.applyContextualExtraction(message, attribute);
            if (contextualExtracted) {
                extractedAttributes[attribute.attribute_key] = contextualExtracted;
                this.logger.info(`Contextual extracted ${attribute.attribute_key}: ${contextualExtracted}`);
            }
        }

        // STEP 3: Pattern-based extraction (final fallback)
        const stillRemaining = requiredAttributes.filter(attr => !extractedAttributes[attr.attribute_key]);
        this.logger.info(`Running pattern-based extraction for ${stillRemaining.length} still remaining attributes`);

        for (const attribute of stillRemaining) {
            const patternExtracted = this.extractUsingDynamicPatterns(message, attribute);
            if (patternExtracted) {
                extractedAttributes[attribute.attribute_key] = patternExtracted;
                this.logger.info(`Pattern extracted ${attribute.attribute_key}: ${patternExtracted}`);
            }
        }

        this.logger.info(`Total extracted attributes: ${Object.keys(extractedAttributes).length}/${requiredAttributes.length}`);
        return extractedAttributes;
    }

    /**
     * Enhanced dynamic pattern extraction that works for any attribute type
     */
    extractUsingDynamicPatterns(message, attribute) {
        const allText = `${attribute.attribute_key} ${attribute.attribute_description || ''} ${attribute.attribute_display_name || ''}`.toLowerCase();
        
        // Generate attribute identifiers dynamically
        const identifiers = this.generateAttributeIdentifiers(attribute);
        
        // Generate content patterns based on attribute analysis
        const contentPatterns = this.generateDynamicContentPatterns(attribute);
        
        this.logger.info(`Trying dynamic patterns for ${attribute.attribute_key}: ${identifiers.length} identifiers, ${contentPatterns.length} patterns`);
        
        // Try different extraction combinations
        for (const identifier of identifiers) {
            for (const pattern of contentPatterns) {
                const extracted = this.tryExtractionPattern(message, identifier, pattern);
                if (extracted) {
                    this.logger.info(`Extracted "${extracted}" using identifier "${identifier}" and pattern "${pattern.name}"`);
                    return extracted;
                }
            }
        }

        return null;
    }

    /**
     * Generate dynamic content patterns based on attribute analysis
     */
    generateDynamicContentPatterns(attribute) {
        const patterns = [];
        const allText = `${attribute.attribute_key} ${attribute.attribute_description || ''} ${attribute.attribute_display_name || ''}`.toLowerCase();

        // Basic patterns that work for any attribute
        patterns.push(
            { name: 'colon_separator', pattern: '\\s*[:=]\\s*([^.!?\\n,;]+)' },
            { name: 'is_pattern', pattern: '\\s+(?:is|was|are|were)\\s+([^.!?\\n,;]+)' },
            { name: 'space_separator', pattern: '\\s+([a-zA-Z0-9\\s,.-]+?)(?:\\s|$)' }
        );

        // Location-specific patterns
        if (this.containsAny(allText, ['location', 'address', 'place', 'pickup', 'drop'])) {
            patterns.push(
                { name: 'at_pattern', pattern: '\\s+(?:at|in|near)\\s+([a-zA-Z0-9\\s,.-]+?)(?:\\s*[.!?]|$)' },
                { name: 'from_to_pattern', pattern: '\\s+(?:from|to)\\s+([a-zA-Z0-9\\s,.-]+?)(?:\\s*[.!?]|$)' }
            );
        }

        // Classification-specific patterns
        if (this.containsAny(allText, ['classification', 'type', 'category', 'status', 'level'])) {
            patterns.push(
                { name: 'type_pattern', pattern: '\\s+(?:type|level|status)\\s+([a-zA-Z0-9\\s-]+?)(?:\\s*[.!?]|$)' }
            );
        }

        // Contact-specific patterns
        if (this.containsAny(allText, ['email', 'mail'])) {
            patterns.push(
                { name: 'email_pattern', pattern: '\\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})' }
            );
        }

        if (this.containsAny(allText, ['phone', 'mobile', 'number'])) {
            patterns.push(
                { name: 'phone_pattern', pattern: '\\s*([+]?[\\d\\s\\-\\(\\)]{8,})' }
            );
        }

        // Quantity patterns
        if (this.containsAny(allText, ['quantity', 'amount', 'count', 'weight', 'size'])) {
            patterns.push(
                { name: 'quantity_pattern', pattern: '\\s*(\\d+(?:\\.\\d+)?(?:\\s*\\w+)?)' }
            );
        }

        return patterns;
    }

    /**
     * Generate all possible identifiers for any attribute
     */
    generateAttributeIdentifiers(attribute) {
        const identifiers = new Set();
        
        // Base identifiers from attribute key
        const key = attribute.attribute_key.toLowerCase();
        identifiers.add(key);
        identifiers.add(key.replace(/_/g, ' '));
        identifiers.add(key.replace(/_/g, ''));
        
        // Add individual words from key
        key.split('_').forEach(word => {
            if (word.length > 2) identifiers.add(word);
        });
        
        // Display name variations
        if (attribute.attribute_display_name) {
            const displayName = attribute.attribute_display_name.toLowerCase();
            identifiers.add(displayName);
            identifiers.add(displayName.replace(/\s+/g, ''));
            
            displayName.split(/\s+/).forEach(word => {
                if (word.length > 2) identifiers.add(word);
            });
        }
        
        // Extract meaningful terms from description
        if (attribute.attribute_description) {
            const description = attribute.attribute_description.toLowerCase();
            const meaningfulTerms = description
                .split(/\s+/)
                .filter(word => word.length > 3 && !this.isStopWord(word))
                .slice(0, 5); // Limit to prevent too many attempts
            
            meaningfulTerms.forEach(term => identifiers.add(term));
        }
        
        // Add common variations
        const baseIdentifiers = Array.from(identifiers);
        baseIdentifiers.forEach(id => {
            identifiers.add(`my ${id}`);
            identifiers.add(`the ${id}`);
            identifiers.add(`your ${id}`);
        });
        
        return Array.from(identifiers).filter(id => id.length > 1);
    }

    /**
     * Try to extract using a specific identifier and content pattern
     */
    tryExtractionPattern(message, identifier, contentPattern) {
        try {
            const escapedIdentifier = this.escapeRegex(identifier);
            const fullPattern = new RegExp(`(?:${escapedIdentifier})${contentPattern.pattern}`, 'gi');
            
            const match = message.match(fullPattern);
            if (match && match[1]) {
                const value = match[1].trim();
                // Basic validation
                if (value.length > 0 && value.length < 200 && !this.isStopWord(value)) {
                    return value;
                }
            }
        } catch (error) {
            // Ignore regex errors and continue
        }
        return null;
    }

    /**
     * Check if a word is a stop word
     */
    isStopWord(word) {
        const stopWords = [
            'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 
            'up', 'about', 'into', 'over', 'after', 'a', 'an', 'as', 'are', 'was', 'were', 'been', 
            'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should'
        ];
        return stopWords.includes(word.toLowerCase());
    }

    async extractUsingAI(message, requiredAttributes) {
        try {
            const { ChatOpenAI } = await import("@langchain/openai");
            const { ChatPromptTemplate } = await import("@langchain/core/prompts");
            const { StringOutputParser } = await import("@langchain/core/output_parsers");

            // Completely dynamic prompt that adapts to any client's attributes
            const prompt = ChatPromptTemplate.fromMessages([
                ["system", `You are an intelligent data extraction specialist that works with ANY type of business attributes. You must be completely dynamic and adapt to different clients and industries.

UNIVERSAL EXTRACTION RULES:
1. Extract ONLY information explicitly mentioned in the message
2. Return valid JSON with exact attribute keys provided
3. Use null for information not found in the message
4. Analyze attribute descriptions to understand what to extract
5. Be flexible - different clients have different types of data
6. Handle any domain: logistics, healthcare, retail, finance, etc.

DYNAMIC PATTERN RECOGNITION:
- Analyze each attribute's description to understand its purpose
- Look for contextual clues based on attribute names and descriptions
- Recognize industry-specific terminology dynamically
- Adapt extraction patterns based on attribute metadata

FLEXIBLE CONTEXT PATTERNS:
- For location-type attributes: look for addresses, place names, directions
- For classification/status attributes: look for state descriptions, levels, types
- For contact attributes: look for emails, phones, names
- For date/time attributes: look for temporal references
- For quantity/amount attributes: look for numbers and units
- For service/product attributes: look for item names and descriptions

SMART INFERENCE:
- Use attribute descriptions to guide extraction logic
- Match values to predefined options when available
- Recognize synonyms and variations based on context
- Handle multi-word entities and compound information

CLIENT ATTRIBUTES TO EXTRACT:
{attributeInfo}

IMPORTANT: Each client may have completely different attribute types. Be adaptive and context-aware.`],
                ["human", `Message: "{message}"

Extract any mentioned values for the client's attributes. Analyze the attribute descriptions to understand what to look for. Return only JSON:`]
            ]);

            // Generate completely dynamic attribute information
            const attributeInfo = this.generateDynamicAttributeInfo(requiredAttributes);

            const llm = new ChatOpenAI({
                apiKey: process.env.OPENAI_API_KEY,
                model: "gpt-4o-mini",
                temperature: 0.2, // Allow some creativity for pattern recognition
                maxTokens: 500
            });

            const chain = prompt.pipe(llm).pipe(new StringOutputParser());

            this.logger.info(`Universal AI extraction for message: "${message}"`);
            this.logger.info(`Dynamic attribute analysis: ${attributeInfo}`);

            const result = await chain.invoke({
                message: message,
                attributeInfo: attributeInfo
            });

            this.logger.info(`AI extraction raw result: ${result}`);

            // Enhanced parsing and validation
            const cleaned = result.replace(/```json|```|```/g, '').trim();

            // Handle case where AI returns non-JSON response
            if (!cleaned.startsWith('{')) {
                this.logger.warn(`AI returned non-JSON response: ${cleaned}`);
                return {};
            }

            const parsed = JSON.parse(cleaned);

            const validated = {};
            for (const [key, value] of Object.entries(parsed)) {
                if (value && value !== null && value !== '') {
                    const attrDef = requiredAttributes.find(a => a.attribute_key === key);
                    if (attrDef) {
                        const processed = this.processValueDynamically(value, attrDef);
                        if (processed) {
                            validated[key] = processed;
                        }
                    }
                }
            }

            return validated;

        } catch (error) {
            this.logger.error(`AI extraction error: ${error.message}`);
            return {};
        }
    }

    /**
     * Generate completely dynamic attribute information for any client
     */
    generateDynamicAttributeInfo(requiredAttributes) {
        return requiredAttributes.map(attr => {
            let info = `- ${attr.attribute_key}: ${attr.attribute_description || 'Custom client attribute'}`;

            // Dynamic analysis based on attribute metadata
            const lowerKey = attr.attribute_key.toLowerCase();
            const lowerDesc = (attr.attribute_description || '').toLowerCase();
            const lowerDisplayName = (attr.attribute_display_name || '').toLowerCase();

            // Combine all text for analysis
            const allText = `${lowerKey} ${lowerDesc} ${lowerDisplayName}`;

            // Dynamic pattern detection based on content analysis
            const patterns = this.analyzeAttributeType(allText, attr);
            if (patterns.length > 0) {
                info += ` (Detected patterns: ${patterns.join(', ')})`;
            }

            // Add possible values if available
            if (attr.attribute_values && attr.attribute_values.length > 0) {
                info += ` (Valid options: ${attr.attribute_values.join(', ')})`;
            }

            // Add examples based on dynamic analysis
            const examples = this.generateDynamicExamples(attr);
            if (examples.length > 0) {
                info += ` (Examples: ${examples.join(', ')})`;
            }

            return info;
        }).join('\n');
    }

    /**
     * Analyze attribute type dynamically for any business domain
     */
    analyzeAttributeType(allText, attribute) {
        const patterns = [];

        // Universal pattern detection
        const typeIndicators = {
            location: ['location', 'address', 'place', 'pickup', 'drop', 'destination', 'from', 'to', 'where', 'venue', 'site'],
            contact: ['email', 'phone', 'mobile', 'contact', 'number', 'call', 'reach', 'communication'],
            classification: ['classification', 'type', 'category', 'status', 'level', 'priority', 'stage', 'class'],
            personal: ['name', 'first', 'last', 'full', 'person', 'user', 'customer', 'client'],
            temporal: ['date', 'time', 'when', 'schedule', 'appointment', 'deadline', 'timestamp'],
            quantity: ['amount', 'quantity', 'count', 'number', 'size', 'weight', 'volume'],
            service: ['service', 'product', 'item', 'goods', 'package', 'plan', 'subscription'],
            financial: ['price', 'cost', 'payment', 'bill', 'invoice', 'amount', 'fee', 'charge'],
            identifier: ['id', 'code', 'reference', 'ticket', 'order', 'transaction', 'serial'],
            description: ['description', 'notes', 'comment', 'details', 'info', 'remark'],
            preference: ['preference', 'choice', 'option', 'selection', 'requirement']
        };

        for (const [type, keywords] of Object.entries(typeIndicators)) {
            const matchCount = keywords.filter(keyword => allText.includes(keyword)).length;
            if (matchCount > 0) {
                patterns.push(`${type}(${matchCount})`);
            }
        }

        return patterns;
    }

    /**
     * Generate dynamic examples based on attribute analysis
     */
    generateDynamicExamples(attribute) {
        const examples = [];
        const allText = `${attribute.attribute_key} ${attribute.attribute_description || ''} ${attribute.attribute_display_name || ''}`.toLowerCase();

        // Location patterns
        if (this.containsAny(allText, ['location', 'address', 'place', 'pickup', 'drop'])) {
            if (allText.includes('pickup') || allText.includes('from')) {
                examples.push('"from downtown"', '"pickup at airport"');
            } else if (allText.includes('drop') || allText.includes('to')) {
                examples.push('"to station"', '"drop at mall"');
            } else {
                examples.push('"123 Main St"', '"downtown office"');
            }
        }

        // Contact patterns
        if (this.containsAny(allText, ['email', 'mail'])) {
            examples.push('"user@example.com"');
        }
        if (this.containsAny(allText, ['phone', 'mobile', 'number'])) {
            examples.push('"+1234567890"', '"555-123-4567"');
        }

        // Classification patterns
        if (this.containsAny(allText, ['classification', 'type', 'category', 'status', 'level'])) {
            // Try to extract from description
            const possibleValues = this.extractPossibleValuesFromDescription(attribute.attribute_description);
            if (possibleValues.length > 0) {
                examples.push(...possibleValues.slice(0, 3).map(v => `"${v}"`));
            } else {
                examples.push('"high"', '"medium"', '"low"');
            }
        }

        // Name patterns
        if (this.containsAny(allText, ['name', 'person', 'customer'])) {
            examples.push('"John Doe"', '"Jane Smith"');
        }

        // Service/Product patterns
        if (this.containsAny(allText, ['service', 'product', 'goods', 'item', 'package'])) {
            examples.push('"documents"', '"electronics"', '"furniture"');
        }

        // Quantity patterns
        if (this.containsAny(allText, ['quantity', 'amount', 'count', 'number', 'weight'])) {
            examples.push('"5 boxes"', '"2.5 kg"', '"100 units"');
        }

        // Date/Time patterns
        if (this.containsAny(allText, ['date', 'time', 'schedule', 'appointment'])) {
            examples.push('"2024-12-25"', '"tomorrow"', '"3 PM"');
        }

        return examples.slice(0, 4); // Limit examples
    }

    /**
     * Helper method to check if text contains any of the keywords
     */
    containsAny(text, keywords) {
        return keywords.some(keyword => text.includes(keyword));
    }

    /**
     * Process value dynamically based on attribute analysis
     */
    processValueDynamically(value, attribute) {
        if (!value) return null;

        let cleaned = value.toString().trim();

        // Handle predefined values first (exact matching)
        if (attribute.attribute_values && attribute.attribute_values.length > 0) {
            const match = this.findBestValueMatch(cleaned, attribute.attribute_values);
            if (match) return match;
        }

        // Dynamic processing based on attribute analysis
        const allText = `${attribute.attribute_key} ${attribute.attribute_description || ''} ${attribute.attribute_display_name || ''}`.toLowerCase();

        // Location processing
        if (this.containsAny(allText, ['location', 'address', 'place', 'pickup', 'drop'])) {
            return this.processLocationValue(cleaned);
        }

        // Email processing
        if (this.containsAny(allText, ['email', 'mail'])) {
            return this.processEmailValue(cleaned);
        }

        // Phone processing
        if (this.containsAny(allText, ['phone', 'mobile', 'number']) && this.looksLikePhone(cleaned)) {
            return this.processPhoneValue(cleaned);
        }

        // Name processing
        if (this.containsAny(allText, ['name', 'person', 'customer'])) {
            return this.processNameValue(cleaned);
        }

        // Classification processing
        if (this.containsAny(allText, ['classification', 'type', 'category', 'status', 'level'])) {
            return this.processClassificationValue(cleaned, attribute);
        }

        // Quantity processing
        if (this.containsAny(allText, ['quantity', 'amount', 'count', 'weight', 'size'])) {
            return this.processQuantityValue(cleaned);
        }

        // Date processing
        if (this.containsAny(allText, ['date', 'time', 'schedule', 'appointment'])) {
            return this.processDateValue(cleaned);
        }

        // Default: clean and format properly
        return this.processGenericValue(cleaned);
    }

    /**
     * Find best match from predefined values using fuzzy matching
     */
    findBestValueMatch(value, possibleValues) {
        const lowerValue = value.toLowerCase();
        
        // Exact match first
        for (const possible of possibleValues) {
            if (possible.toLowerCase() === lowerValue) {
                return possible;
            }
        }

        // Partial match
        for (const possible of possibleValues) {
            if (possible.toLowerCase().includes(lowerValue) || lowerValue.includes(possible.toLowerCase())) {
                return possible;
            }
        }

        // Fuzzy match using similarity
        let bestMatch = null;
        let bestScore = 0;

        for (const possible of possibleValues) {
            const similarity = this.calculateStringSimilarity(lowerValue, possible.toLowerCase());
            if (similarity > 0.7 && similarity > bestScore) {
                bestScore = similarity;
                bestMatch = possible;
            }
        }

        return bestMatch;
    }

    // Dynamic value processors for different types
    processLocationValue(value) {
        return value.split(' ').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ');
    }

    processEmailValue(value) {
        return value.toLowerCase().trim();
    }

    processPhoneValue(value) {
        // Keep original format but validate
        return this.looksLikePhone(value) ? value : null;
    }

    processNameValue(value) {
        return value.split(' ').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ');
    }

    processClassificationValue(value, attribute) {
        // Try to match against possible values from description
        const possibleValues = this.extractPossibleValuesFromDescription(attribute.attribute_description);
        if (possibleValues.length > 0) {
            return this.findBestValueMatch(value, possibleValues);
        }
        return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
    }

    processQuantityValue(value) {
        // Keep numbers and units together
        return value.replace(/\s+/g, ' ').trim();
    }

    processDateValue(value) {
        // Basic date cleaning
        return value.toLowerCase().trim();
    }

    processGenericValue(value) {
        return value.replace(/\s+/g, ' ').trim();
    }

    looksLikePhone(value) {
        const cleaned = value.replace(/\D/g, '');
        return cleaned.length >= 10 && cleaned.length <= 15;
    }

    extractUsingRegex(message, attribute) {
        const {
            attribute_key,
            attribute_display_name,
            attribute_description,
            regex_pattern,
            regex_cue,
            attribute_values
        } = attribute;

        this.logger.info(`Enhanced regex extraction for ${attribute_key} from: "${message}"`);

        let extracted = null;

        // Priority 1: Custom regex patterns from database
        if (regex_pattern) {
            extracted = this.applyCustomRegex(message, regex_pattern, regex_cue);
            if (extracted) {
                this.logger.info(`Extracted "${extracted}" using custom regex for ${attribute_key}`);
                return this.processValue(extracted, attribute);
            }
        }

        // Priority 2: Predefined attribute values matching
        if (attribute_values && attribute_values.length > 0) {
            extracted = this.matchAttributeValues(message, attribute_values);
            if (extracted) {
                this.logger.info(`Extracted "${extracted}" using predefined values for ${attribute_key}`);
                return this.processValue(extracted, attribute);
            }
        }

        // Priority 3: Enhanced dynamic pattern generation
        extracted = this.applyDynamicPatterns(message, attribute);
        if (extracted) {
            this.logger.info(`Extracted "${extracted}" using dynamic patterns for ${attribute_key}`);
            return this.processValue(extracted, attribute);
        }

        // Priority 4: Context-based extraction for specific attribute types
        extracted = this.applyContextualExtraction(message, attribute);
        if (extracted) {
            this.logger.info(`Extracted "${extracted}" using contextual extraction for ${attribute_key}`);
            return this.processValue(extracted, attribute);
        }

        return null;
    }

    /**
     * Completely dynamic contextual extraction that works for any client
     */
    applyContextualExtraction(message, attribute) {
        const allText = `${attribute.attribute_key} ${attribute.attribute_description || ''} ${attribute.attribute_display_name || ''}`.toLowerCase();
        
        this.logger.info(`Applying contextual extraction for ${attribute.attribute_key} based on: "${allText}"`);

        // Dynamic extraction based on attribute content analysis
        const extractionStrategies = this.getDynamicExtractionStrategies(allText, attribute);

        for (const strategy of extractionStrategies) {
            const result = strategy.extract(message);
            if (result && this.isValidContextualResult(result, attribute.attribute_key, attribute.attribute_description)) {
                this.logger.info(`Extracted "${result}" using strategy: ${strategy.name}`);
                return result;
            }
        }

        return null;
    }

    /**
     * Validate contextual extraction results to prevent cross-contamination
     */
    isValidContextualResult(result, attributeName, attributeDescription) {
        if (!result || typeof result !== 'string' || result.length < 1) return false;
        
        // Reject overly long extractions (likely wrong)
        if (result.length > 200) return false;
        
        // Reject results that look like full sentences or phrases that don't match the attribute
        if (this.looksLikeFullSentence(result) && !this.isDescriptiveAttribute(attributeName)) {
            return false;
        }
        
        // Specific validations by attribute type
        if (attributeName.includes('name') || attributeName.includes('doctor')) {
            return this.isValidName(result);
        }
        
        if (attributeName.includes('email')) {
            return this.isValidEmail(result);
        }
        
        if (attributeName.includes('phone') || attributeName.includes('contact')) {
            return this.isValidPhone(result);
        }
        
        if (attributeName.includes('id') || attributeName.includes('identifier')) {
            return this.isValidIdentifier(result);
        }
        
        if (attributeName.includes('amount') || attributeName.includes('value') || attributeName.includes('income')) {
            return this.isValidFinancialAmount(result);
        }
        
        if (attributeName.includes('location') || attributeName.includes('address')) {
            return this.isValidLocation(result) && !this.looksLikeFullSentence(result);
        }
        
        return true;
    }

    /**
     * Check if a result looks like a full sentence rather than an attribute value
     */
    looksLikeFullSentence(text) {
        // Count words - more than 6 words suggests a sentence
        const wordCount = text.split(/\s+/).length;
        if (wordCount > 6) return true;
        
        // Check for sentence indicators
        if (text.includes(' and ') || text.includes(' or ') || text.includes(' by ') || text.includes(' with ')) {
            return true;
        }
        
        // Check for multiple capitalized words in sequence (likely not a single attribute)
        const words = text.split(/\s+/);
        let capitalizedCount = 0;
        for (const word of words) {
            if (word.charAt(0) === word.charAt(0).toUpperCase() && word.length > 2) {
                capitalizedCount++;
            }
        }
        
        return capitalizedCount > 3; // More than 3 capitalized words suggests a sentence
    }

    /**
     * Check if the attribute is expected to be descriptive (can contain longer text)
     */
    isDescriptiveAttribute(attributeName) {
        const descriptiveAttributes = [
            'description', 'concern', 'features', 'details', 'notes', 'comment', 'reason'
        ];
        return descriptiveAttributes.some(attr => attributeName.includes(attr));
    }

    /**
     * Validate name fields
     */
    isValidName(name) {
        if (!name || name.length < 2 || name.length > 50) return false;
        
        // Should contain letters
        if (!/[a-zA-Z]/.test(name)) return false;
        
        // Should not contain too many numbers
        const numberCount = (name.match(/\d/g) || []).length;
        if (numberCount > 2) return false;
        
        // Should not look like a sentence
        return !this.looksLikeFullSentence(name);
    }

    /**
     * Validate email addresses
     */
    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    /**
     * Validate phone numbers
     */
    isValidPhone(phone) {
        // Remove common phone number characters for validation
        const cleaned = phone.replace(/[\s\-\(\)\+]/g, '');
        return /^\d{7,15}$/.test(cleaned);
    }

    /**
     * Validate identifier fields (IDs, codes, etc.)
     */
    isValidIdentifier(identifier) {
        if (!identifier || identifier.length < 2 || identifier.length > 30) return false;
        
        // Should contain some alphanumeric characters
        if (!/[a-zA-Z0-9]/.test(identifier)) return false;
        
        // Should not look like a sentence
        return !this.looksLikeFullSentence(identifier);
    }

    /**
     * Validate financial amounts
     */
    isValidFinancialAmount(amount) {
        if (!amount) return false;
        
        // Should contain numbers
        if (!/\d/.test(amount)) return false;
        
        // Should not look like a sentence
        if (this.looksLikeFullSentence(amount)) return false;
        
        // Common financial patterns
        return /^\$?\d+[,\d]*\.?\d*[kKmM]?$/.test(amount.replace(/\s/g, '')) || 
               /^\d+[,\d]*\.?\d*\s*(dollars?|usd|\$)$/i.test(amount);
    }

    /**
     * Generate dynamic extraction strategies based on attribute analysis
     */
    getDynamicExtractionStrategies(allText, attribute) {
        const strategies = [];

        // Location-based extraction
        if (this.containsAny(allText, ['location', 'address', 'place', 'pickup', 'drop', 'destination', 'from', 'to'])) {
            strategies.push({
                name: 'dynamic_location',
                extract: (msg) => this.extractLocationDynamically(msg, allText)
            });
        }

        // Contact information extraction
        if (this.containsAny(allText, ['email', 'mail'])) {
            strategies.push({
                name: 'email_extraction',
                extract: (msg) => this.extractEmail(msg)
            });
        }

        if (this.containsAny(allText, ['phone', 'mobile', 'contact', 'number'])) {
            strategies.push({
                name: 'phone_extraction', 
                extract: (msg) => this.extractPhone(msg)
            });
        }

        // Classification/Status extraction
        if (this.containsAny(allText, ['classification', 'type', 'category', 'status', 'level', 'priority', 'stage'])) {
            strategies.push({
                name: 'dynamic_classification',
                extract: (msg) => this.extractClassificationDynamically(msg, attribute)
            });
        }

        // Name extraction
        if (this.containsAny(allText, ['name', 'person', 'customer', 'user', 'client'])) {
            strategies.push({
                name: 'name_extraction',
                extract: (msg) => this.extractNameDynamically(msg)
            });
        }

        // Service/Product/Goods extraction
        if (this.containsAny(allText, ['service', 'product', 'goods', 'item', 'package', 'cargo', 'transfer'])) {
            strategies.push({
                name: 'dynamic_goods',
                extract: (msg) => this.extractGoodsDynamically(msg, allText)
            });
        }

        // Quantity/Amount extraction
        if (this.containsAny(allText, ['quantity', 'amount', 'count', 'number', 'weight', 'size', 'volume'])) {
            strategies.push({
                name: 'quantity_extraction',
                extract: (msg) => this.extractQuantityDynamically(msg)
            });
        }

        // Date/Time extraction
        if (this.containsAny(allText, ['date', 'time', 'schedule', 'appointment', 'deadline', 'when'])) {
            strategies.push({
                name: 'datetime_extraction',
                extract: (msg) => this.extractDateTimeDynamically(msg)
            });
        }

        // Identifier extraction (IDs, codes, references)
        if (this.containsAny(allText, ['id', 'code', 'reference', 'ticket', 'order', 'serial', 'number'])) {
            strategies.push({
                name: 'identifier_extraction',
                extract: (msg) => this.extractIdentifierDynamically(msg, attribute)
            });
        }

        // Financial extraction (only for amount/value attributes, not payment methods)
        if (this.containsAny(allText, ['amount', 'value', 'cost', 'fee', 'charge', 'bill']) && 
            !this.containsAny(allText, ['payment', 'method', 'option'])) {
            strategies.push({
                name: 'financial_extraction',
                extract: (msg) => this.extractFinancialDynamically(msg)
            });
        }

        // Payment method extraction (separate from financial amounts)
        if (this.containsAny(allText, ['payment', 'method', 'option']) && 
            this.containsAny(allText, ['credit', 'card', 'paypal', 'bank', 'transfer'])) {
            strategies.push({
                name: 'payment_method_extraction',
                extract: (msg) => this.extractPaymentMethodDynamically(msg, attribute)
            });
        }

        // Smart inference for missing attributes based on context
        strategies.push({
            name: 'smart_inference',
            extract: (msg) => this.extractWithSmartInference(msg, attribute)
        });

        // Generic text extraction (fallback)
        strategies.push({
            name: 'generic_text',
            extract: (msg) => this.extractGenericTextDynamically(msg, attribute)
        });

        return strategies;
    }

    /**
     * Smart inference for missing attributes based on context and reasonable defaults
     */
    extractWithSmartInference(message, attribute) {
        const attributeName = attribute.attribute_key.toLowerCase();
        const attributeDescription = (attribute.attribute_description || '').toLowerCase();
        const message_lower = message.toLowerCase();

        // Course level inference
        if (attributeName.includes('course_level') || attributeName.includes('level')) {
            // If no explicit level mentioned, but it's educational context
            if (message_lower.includes('course') || message_lower.includes('learn')) {
                // Look for complexity indicators
                if (message_lower.includes('advanced') || message_lower.includes('expert')) return 'Advanced';
                if (message_lower.includes('basic') || message_lower.includes('beginner') || message_lower.includes('start')) return 'Beginner';
                if (message_lower.includes('intermediate') || message_lower.includes('medium')) return 'Intermediate';
                
                // Professional context suggests higher level
                if (message_lower.includes('professional') || message_lower.includes('working professional')) return 'Intermediate';
                if (message_lower.includes('executive') || message_lower.includes('management')) return 'Advanced';
                
                // Business courses for professionals typically intermediate+
                if (message_lower.includes('business') && (message_lower.includes('professional') || message_lower.includes('work'))) {
                    return 'Intermediate';
                }
                
                // Default to Beginner for general learning requests
                if (message_lower.includes('want to learn') || message_lower.includes('looking for')) {
                    return 'Beginner';
                }
            }
        }

        // Student age inference
        if (attributeName.includes('student_age') || attributeName.includes('age')) {
            // Professional context suggests working age
            if (message_lower.includes('working professional') || message_lower.includes('professional')) return '30';
            if (message_lower.includes('executive') || message_lower.includes('senior')) return '35';
            if (message_lower.includes('young professional') || message_lower.includes('recent graduate')) return '25';
            
            // Educational context with explicit age indicators
            if (message_lower.includes('adult') || message_lower.includes('continuing education')) return '30';
            if (message_lower.includes('retirement') || message_lower.includes('senior citizen')) return '65';
            
            // Business courses often for working adults
            if (message_lower.includes('business') && (message_lower.includes('course') || message_lower.includes('training'))) {
                return '28'; // Typical business course participant age
            }
        }

        // Learning mode inference
        if (attributeName.includes('learning_mode') || attributeName.includes('mode')) {
            if (message_lower.includes('online') || message_lower.includes('remote')) return 'Online';
            if (message_lower.includes('in-person') || message_lower.includes('classroom') || message_lower.includes('campus')) return 'In-Person';
            if (message_lower.includes('hybrid') || message_lower.includes('mixed')) return 'Hybrid';
            
            // If requesting courses without specifying mode, default to Online (most common)
            if ((message_lower.includes('course') || message_lower.includes('class')) && 
                !message_lower.includes('person')) {
                return 'Online';
            }
        }

        // Risk tolerance inference for financial services
        if (attributeName.includes('risk')) {
            if (message_lower.includes('conservative') || message_lower.includes('safe') || message_lower.includes('low risk')) return 'Conservative';
            if (message_lower.includes('aggressive') || message_lower.includes('high risk') || message_lower.includes('growth')) return 'Aggressive';
            if (message_lower.includes('moderate') || message_lower.includes('balanced')) return 'Moderate';
            
            // Default based on service type
            if (message_lower.includes('investment') && !message_lower.includes('retirement')) {
                return 'Moderate'; // Most common choice
            }
        }

        // Property type inference for real estate
        if (attributeName.includes('property_type') || attributeName.includes('type')) {
            if (message_lower.includes('house') || message_lower.includes('home')) return 'House';
            if (message_lower.includes('apartment') || message_lower.includes('apt')) return 'Apartment';
            if (message_lower.includes('condo') || message_lower.includes('condominium')) return 'Condo';
            if (message_lower.includes('townhouse') || message_lower.includes('town house')) return 'Townhouse';
            if (message_lower.includes('commercial') || message_lower.includes('business') || message_lower.includes('office')) return 'Commercial';
        }

        // Delivery preference inference for e-commerce
        if (attributeName.includes('delivery_preference') || attributeName.includes('delivery')) {
            if (message_lower.includes('express') || message_lower.includes('fast') || message_lower.includes('quick')) return 'Express';
            if (message_lower.includes('next day') || message_lower.includes('tomorrow')) return 'Next Day';
            if (message_lower.includes('standard') || message_lower.includes('regular') || message_lower.includes('normal')) return 'Standard';
            
            // Business/office context often needs faster delivery
            if (message_lower.includes('office') || message_lower.includes('business') || message_lower.includes('work')) return 'Express';
            
            // Default to Standard for most cases
            if (message_lower.includes('ship') || message_lower.includes('delivery') || message_lower.includes('order')) return 'Standard';
        }

        // Course level context enhancement
        if (attributeName.includes('course_level') && !attributeName.includes('student_age')) {
            // Weekend courses often for working professionals (intermediate level)
            if (message_lower.includes('weekend') && message_lower.includes('business')) return 'Intermediate';
            
            // Evening courses often for working adults
            if (message_lower.includes('evening') && message_lower.includes('course')) return 'Beginner';
        }

        // Service type inference for financial services
        if (attributeName.includes('service_type') || (attributeName.includes('service') && attributeName.includes('type'))) {
            if (message_lower.includes('loan') || message_lower.includes('borrow')) return 'Loan';
            if (message_lower.includes('investment') || message_lower.includes('invest')) return 'Investment';
            if (message_lower.includes('insurance') || message_lower.includes('coverage')) return 'Insurance';
            if (message_lower.includes('banking') || message_lower.includes('account')) return 'Banking';
        }

        return null;
    }

    /**
     * Dynamic location extraction that adapts to any location type
     */
    extractLocationDynamically(message, allText) {
        const patterns = [];

        // Specific patterns based on attribute type
        if (allText.includes('pickup') || allText.includes('from')) {
            patterns.push(
                /(?:pickup\s+(?:from\s+|at\s+)?|from\s+|starting\s+(?:from\s+)?|pick\s+up\s+(?:from\s+|at\s+)?)([a-zA-Z0-9\s,.-]+?)(?:\s+to\s+|\s+and\s+deliver|\s*[.!?]|$)/gi,
                /(?:send\s+.*?\s+from\s+)([a-zA-Z0-9\s,.-]+?)(?:\s+to\s+|\s*[.!?]|$)/gi,
                /^([a-zA-Z0-9\s,.-]+?)\s+to\s+/gi // "123 Main Street to ..."
            );
        }

        if (allText.includes('drop') || allText.includes('delivery') || allText.includes('to') || allText.includes('destination')) {
            patterns.push(
                /(?:drop\s+(?:at\s+|to\s+)?|to\s+|going\s+to\s+|destination\s+|deliver\s+to\s+)([a-zA-Z0-9\s,.-]+?)(?:\s*[.!?]|$)/gi,
                /(?:send\s+.*?\s+to\s+)([a-zA-Z0-9\s,.-]+?)(?:\s*[.!?]|$)/gi,
                /\s+to\s+([a-zA-Z0-9\s,.-]+?)(?:\s*[.!?]|$)/gi // "... to 456 Oak Avenue"
            );
        }

        if (allText.includes('ship') || allText.includes('address')) {
            patterns.push(
                /(?:ship\s+to\s+|shipping\s+address\s*[:]\s*)([a-zA-Z0-9\s,.-]+?)(?:\s*[.!?]|$)/gi,
                /(?:address\s*[:]\s*)([a-zA-Z0-9\s,.-]+?)(?:\s*[.!?]|$)/gi
            );
        }

        // Generic location patterns
        patterns.push(
            /(?:at\s+|in\s+|near\s+|around\s+)([a-zA-Z0-9\s,.-]+?)(?:\s*[.!?]|$)/gi,
            /\b(\d+\s+[a-zA-Z\s]+(street|st|road|rd|avenue|ave|lane|ln|drive|dr|place|pl|way|blvd|boulevard|court|ct))\b/gi
        );

        for (const pattern of patterns) {
            pattern.lastIndex = 0; // Reset regex state
            const match = pattern.exec(message);
            if (match && match[1]) {
                const location = match[1].trim();
                if (this.isValidLocation(location)) {
                    return this.formatLocation(location);
                }
            }
        }
        return null;
    }

    /**
     * Validate if a string looks like a valid location
     */
    isValidLocation(location) {
        if (!location || location.length < 3 || location.length > 100) return false;
        
        // Should contain letters
        if (!/[a-zA-Z]/.test(location)) return false;
        
        // Should not be just numbers
        if (/^\d+$/.test(location.trim())) return false;
        
        // Common location indicators
        const locationWords = /\b(street|st|road|rd|avenue|ave|lane|ln|drive|dr|place|pl|way|blvd|boulevard|court|ct|floor|apt|apartment|unit|building|block|office|downtown|uptown|area|city|town|village)\b/i;
        const hasNumbers = /\d/.test(location);
        const hasMultipleWords = location.split(' ').length > 1;
        
        return locationWords.test(location) || hasNumbers || hasMultipleWords;
    }

    /**
     * Format location for consistent display
     */
    formatLocation(location) {
        return location.split(' ').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ');
    }

    /**
     * Dynamic classification extraction
     */
    extractClassificationDynamically(message, attribute) {
        const lowerMessage = message.toLowerCase();

        // First try predefined values (exact and partial matches)
        const possibleValues = this.extractPossibleValuesFromDescription(attribute.attribute_description);
        
        // Direct exact matches first
        for (const value of possibleValues) {
            if (lowerMessage.includes(value.toLowerCase())) {
                return value;
            }
        }

        // Partial matches and synonyms
        for (const value of possibleValues) {
            const valueLower = value.toLowerCase();
            
            // Check for partial word matches
            const valueWords = valueLower.split(/\s+/);
            if (valueWords.some(word => word.length > 3 && lowerMessage.includes(word))) {
                return value;
            }
        }

        // Smart mapping only if we have predefined values
        if (possibleValues.length > 0) {
            const urgencyMap = {
                urgent: possibleValues.find(v => /urgent/i.test(v)),
                emergency: possibleValues.find(v => /emergency/i.test(v)), 
                express: possibleValues.find(v => /express/i.test(v)),
                standard: possibleValues.find(v => /standard/i.test(v)),
                normal: possibleValues.find(v => /standard|normal/i.test(v)),
                electronics: possibleValues.find(v => /electronics/i.test(v)),
                documents: possibleValues.find(v => /documents/i.test(v)),
                fragile: possibleValues.find(v => /fragile/i.test(v))
            };

            for (const [keyword, value] of Object.entries(urgencyMap)) {
                if (value && lowerMessage.includes(keyword)) {
                    return value;
                }
            }
        }

        return null;
    }

    /**
     * Dynamic name extraction
     */
    extractNameDynamically(message) {
        const patterns = [
            /(?:my\s+name\s+is\s+|i\s+am\s+|call\s+me\s+)([a-zA-Z\s'-]{2,30})/gi,
            /(?:name\s*[:]\s*)([a-zA-Z\s'-]{2,30})/gi
        ];

        for (const pattern of patterns) {
            const match = message.match(pattern);
            if (match && match[1]) {
                const name = match[1].trim();
                // Validate it looks like a name
                if (/^[a-zA-Z\s'-]{2,30}$/.test(name) && name.split(' ').length <= 4) {
                    return name;
                }
            }
        }
        return null;
    }

    /**
     * Dynamic goods/items extraction
     */
    extractGoodsDynamically(message, allText) {
        const patterns = [
            /(?:carrying|transporting|moving|shipping|sending|delivering|transfer(?:ring)?)\s+([a-zA-Z0-9\s,.-]+?)(?:\s+(?:from|to|and)\s+|\s*[.!?]|$)/gi,
            /(?:goods|items|cargo|package|parcel|stuff|things|products)[\s:]*([a-zA-Z0-9\s,.-]+?)(?:\s*[.!?]|$)/gi,
            /(?:need\s+to\s+(?:send|ship|move|transport))\s+([a-zA-Z0-9\s,.-]+?)(?:\s*[.!?]|$)/gi
        ];

        // Add specific patterns based on attribute description
        if (allText.includes('transfer')) {
            patterns.push(/(?:transfer)\s+([a-zA-Z0-9\s,.-]+?)(?:\s*[.!?]|$)/gi);
        }

        for (const pattern of patterns) {
            const match = message.match(pattern);
            if (match && match[1]) {
                const goods = match[1].trim();
                if (goods.length > 1 && goods.length < 100) {
                    return goods;
                }
            }
        }
        return null;
    }

    /**
     * Dynamic quantity extraction
     */
    extractQuantityDynamically(message) {
        const patterns = [
            /(\d+(?:\.\d+)?\s*(?:kg|lbs|pounds|tons|grams|ounces|boxes|pieces|items|units))/gi,
            /(?:quantity|amount|count)[\s:]*(\d+(?:\.\d+)?(?:\s*\w+)?)/gi,
            /(\d+(?:\.\d+)?)\s*(?:kg|lbs|pounds|tons|grams|ounces|boxes|pieces|items|units)/gi
        ];

        for (const pattern of patterns) {
            const match = message.match(pattern);
            if (match && match[1]) {
                return match[1].trim();
            }
        }
        return null;
    }

    /**
     * Dynamic date/time extraction
     */
    extractDateTimeDynamically(message) {
        // Enhanced patterns for date/time extraction
        const patterns = [
            // Specific time patterns
            /(?:at\s+|by\s+|before\s+|after\s+)(\d{1,2}:\d{2}(?:\s*[ap]m)?)/gi,
            /(?:time\s*[:]\s*)(\d{1,2}:\d{2}(?:\s*[ap]m)?)/gi,
            
            // Date patterns
            /(?:on\s+|date\s*[:]\s*)(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
            /(?:on\s+|date\s*[:]\s*)((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{2,4})/gi,
            /(?:on\s+|date\s*[:]\s*)(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*,?\s*\d{2,4})/gi,
            
            // Combined date and time
            /(?:on\s+|at\s+|by\s+)(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\s+(?:at\s+)?\d{1,2}:\d{2}(?:\s*[ap]m)?)/gi,
            
            // Relative dates
            /(?:tomorrow|today|tonight)(?:\s+at\s+(\d{1,2}:\d{2}(?:\s*[ap]m)?))?/gi,
            /(next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))(?:\s+at\s+(\d{1,2}:\d{2}(?:\s*[ap]m)?))?/gi,
            
            // General patterns
            /\b(\d{1,2}:\d{2}(?:\s*[ap]m)?)\b/gi,
            /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/gi,
            /\b(\d{4}-\d{2}-\d{2})\b/g,
            /\b(today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi
        ];

        for (const pattern of patterns) {
            pattern.lastIndex = 0; // Reset regex state
            const match = pattern.exec(message);
            if (match && (match[1] || match[0])) {
                const dateTime = (match[1] || match[0]).trim();
                if (this.isValidDateTime(dateTime)) {
                    return this.formatDateTime(dateTime);
                }
            }
        }
        return null;
    }

    /**
     * Validate if a string looks like a valid date/time
     */
    isValidDateTime(dateTime) {
        if (!dateTime || dateTime.length < 3) return false;
        
        // Check for time pattern
        if (/\d{1,2}:\d{2}/.test(dateTime)) return true;
        
        // Check for date pattern
        if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(dateTime)) return true;
        
        // Check for ISO date
        if (/\d{4}-\d{2}-\d{2}/.test(dateTime)) return true;
        
        // Check for month names
        if (/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(dateTime)) return true;
        
        // Check for relative dates
        if (/(tomorrow|today|tonight|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(dateTime)) return true;
        
        return false;
    }

    /**
     * Format date/time for consistent display
     */
    formatDateTime(dateTime) {
        // Simple formatting - in a real system you'd use a proper date library
        return dateTime.trim();
    }

    /**
     * Dynamic identifier extraction (IDs, codes, etc.) - More specific to avoid cross-contamination
     */
    extractIdentifierDynamically(message, attribute) {
        const attrKey = attribute.attribute_key.toLowerCase();
        const attrDesc = (attribute.attribute_description || '').toLowerCase();
        
        // Create specific patterns based on the attribute context
        const patterns = [];
        
        // Insurance ID specific patterns
        if (attrKey.includes('insurance') || attrDesc.includes('insurance')) {
            patterns.push(
                /(?:insurance\s+(?:id|number))[\s:]*([A-Z0-9-_]+)/gi,
                /\b[A-Z]{2}\d{6,}\b/g // Pattern like HC123456
            );
        }
        
        // General ID patterns (only if specifically mentioned)
        if (attrKey.includes('id') || attrDesc.includes('identification')) {
            patterns.push(
                /(?:id|identification)[\s:]*([A-Z0-9-_]+)/gi
            );
        }
        
        // Reference/ticket patterns
        if (attrKey.includes('reference') || attrKey.includes('ticket')) {
            patterns.push(
                /(?:reference|ticket|order)[\s:]*([A-Z0-9-_]+)/gi,
                /#([A-Z0-9-_]+)/g
            );
        }

        for (const pattern of patterns) {
            const match = message.match(pattern);
            if (match && match[1]) {
                return match[1];
            } else if (match && match[0] && pattern.source.includes('\\b[A-Z]')) {
                // Only return direct matches for specific patterns
                return match[0];
            }
        }
        return null;
    }

    /**
     * Dynamic payment method extraction
     */
    extractPaymentMethodDynamically(message, attribute) {
        const lowerMessage = message.toLowerCase();
        
        // First try predefined values if available
        const possibleValues = this.extractPossibleValuesFromDescription(attribute.attribute_description);
        for (const value of possibleValues) {
            if (lowerMessage.includes(value.toLowerCase())) {
                return value;
            }
        }
        
        // Common payment method patterns
        const paymentMethods = {
            'credit card': ['credit card', 'credit', 'card'],
            'paypal': ['paypal', 'pay pal'],
            'bank transfer': ['bank transfer', 'wire transfer', 'bank'],
            'cash': ['cash', 'cash on delivery', 'cod'],
            'debit card': ['debit card', 'debit'],
            'check': ['check', 'cheque']
        };
        
        for (const [method, keywords] of Object.entries(paymentMethods)) {
            if (keywords.some(keyword => lowerMessage.includes(keyword))) {
                // Try to match with predefined values first
                const predefinedMatch = possibleValues.find(v => 
                    v.toLowerCase().includes(method) || method.includes(v.toLowerCase())
                );
                return predefinedMatch || method;
            }
        }
        
        return null;
    }

    /**
     * Dynamic financial extraction
     */
    extractFinancialDynamically(message) {
        const patterns = [
            /\$\d+(?:k|K)?(?:-\d+(?:k|K)?)?/g, // $300k-500k, $500, etc.
            /\$\d+(?:\.\d{2})?/g,
            /\b\d+(?:\.\d{2})?\s*(?:dollars|usd|eur|euros|pounds|gbp)\b/gi,
            /(?:price|cost|amount|fee|value|worth)[\s:]*\$?(\d+(?:\.\d{2})?(?:k|K)?)/gi
        ];

        for (const pattern of patterns) {
            const match = message.match(pattern);
            if (match) {
                return match[1] || match[0];
            }
        }
        return null;
    }

    /**
     * Generic text extraction as fallback
     */
    extractGenericTextDynamically(message, attribute) {
        // Use attribute key/name patterns as a last resort
        const key = attribute.attribute_key.toLowerCase();
        const displayName = (attribute.attribute_display_name || '').toLowerCase();

        const identifiers = [key, displayName, ...key.split('_'), ...displayName.split(' ')].filter(id => id.length > 2);

        for (const identifier of identifiers) {
            const pattern = new RegExp(`(?:${this.escapeRegex(identifier)})\\s*[:=]\\s*([^.!?\\n]+)`, 'gi');
            const match = message.match(pattern);
            if (match && match[1]) {
                const value = match[1].trim();
                if (value.length > 1 && value.length < 200) {
                    return value;
                }
            }
        }

        return null;
    }

    /**
     * Enhanced pickup location extraction
     */
    extractPickupLocation(message) {
        const patterns = [
            /(?:pickup\s+(?:from\s+|at\s+)?|from\s+|starting\s+(?:from\s+)?|pick\s+up\s+(?:from\s+|at\s+)?)([a-zA-Z0-9\s,.-]+?)(?:\s+to\s+|\s+and\s+|\s*[.!?]|$)/gi,
            /^([a-zA-Z0-9\s,.-]+?)\s+to\s+/gi, // "Delhi to Mumbai" pattern
            /(?:from\s+)([a-zA-Z0-9\s,.-]+?)(?:\s+to\s+|\s*$)/gi,
            /(?:starting\s+(?:from\s+)?)([a-zA-Z0-9\s,.-]+?)(?:\s+(?:going|to)\s+|\s*$)/gi
        ];

        for (const pattern of patterns) {
            const match = message.match(pattern);
            if (match && match[1]) {
                const location = match[1].trim();
                if (this.isValidLocation(location)) {
                    return location;
                }
            }
        }
        return null;
    }

    /**
     * Enhanced drop location extraction
     */
    extractDropLocation(message) {
        const patterns = [
            /(?:drop\s+(?:at\s+|to\s+)?|to\s+|going\s+to\s+|destination\s+|deliver\s+to\s+)([a-zA-Z0-9\s,.-]+?)(?:\s*[.!?]|$)/gi,
            /\s+to\s+([a-zA-Z0-9\s,.-]+?)(?:\s*[.!?]|$)/gi, // "Delhi to Mumbai" pattern
            /(?:heading\s+to\s+|bound\s+for\s+)([a-zA-Z0-9\s,.-]+?)(?:\s*[.!?]|$)/gi
        ];

        for (const pattern of patterns) {
            const match = message.match(pattern);
            if (match && match[1]) {
                const location = match[1].trim();
                if (this.isValidLocation(location)) {
                    return location;
                }
            }
        }
        return null;
    }

    /**
     * Enhanced classification extraction
     */
    extractClassification(message, attribute) {
        const lowerMessage = message.toLowerCase();

        // Get possible values from description
        const possibleValues = this.extractPossibleValuesFromDescription(attribute.attribute_description);

        // Direct value matching
        for (const value of possibleValues) {
            if (lowerMessage.includes(value.toLowerCase())) {
                return value;
            }
        }

        // Intent-based classification mapping
        const classificationMap = {
            'Hot': ['urgent', 'asap', 'immediately', 'right now', 'today', 'emergency', 'hot', 'priority'],
            'Warm': ['interested', 'soon', 'this week', 'warm', 'considering', 'planning', 'thinking about'],
            'Cold': ['maybe', 'later', 'someday', 'cold', 'not urgent', 'future', 'eventually', 'possibly']
        };

        for (const [classification, keywords] of Object.entries(classificationMap)) {
            if (keywords.some(keyword => lowerMessage.includes(keyword))) {
                // Check if this classification is in possible values
                if (possibleValues.length === 0 || possibleValues.includes(classification)) {
                    return classification;
                }
            }
        }

        return null;
    }

    /**
     * Enhanced goods extraction
     */
    extractGoods(message) {
        const patterns = [
            /(?:carrying|transporting|moving|shipping|sending|delivering|transfer(?:ring)?)\s+([a-zA-Z0-9\s,.-]+?)(?:\s+(?:from|to|and)\s+|\s*[.!?]|$)/gi,
            /(?:goods|items|cargo|package|parcel|stuff|things)[\s:]*([a-zA-Z0-9\s,.-]+?)(?:\s*[.!?]|$)/gi,
            /(?:need\s+to\s+(?:send|ship|move|transport))\s+([a-zA-Z0-9\s,.-]+?)(?:\s*[.!?]|$)/gi
        ];

        for (const pattern of patterns) {
            const match = message.match(pattern);
            if (match && match[1]) {
                const goods = match[1].trim();
                if (goods.length > 1 && goods.length < 100) {
                    return goods;
                }
            }
        }
        return null;
    }

    /**
     * Enhanced email extraction
     */
    extractEmail(message) {
        const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
        const match = message.match(emailPattern);
        return match ? match[0] : null;
    }

    /**
     * Enhanced phone extraction
     */
    extractPhone(message) {
        const phonePatterns = [
            /\b(?:\+\d{1,3}\s?)?(?:\(?\d{3,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{4,6}\b/g,
            /\b\d{10,15}\b/g
        ];

        for (const pattern of phonePatterns) {
            const match = message.match(pattern);
            if (match) {
                const phone = match[0].replace(/\D/g, ''); // Remove non-digits
                if (phone.length >= 10 && phone.length <= 15) {
                    return match[0]; // Return original format
                }
            }
        }
        return null;
    }

    /**
     * Validate if extracted text looks like a location
     */
    isValidLocation(location) {
        if (!location || location.length < 2 || location.length > 100) {
            return false;
        }

        // Filter out common non-location words
        const nonLocationWords = [
            'and', 'or', 'but', 'the', 'a', 'an', 'this', 'that', 'these', 'those',
            'yes', 'no', 'okay', 'ok', 'sure', 'please', 'thank', 'thanks', 'hi', 'hello',
            'good', 'great', 'fine', 'right', 'wrong', 'correct', 'perfect'
        ];

        const lowerLocation = location.toLowerCase().trim();
        if (nonLocationWords.includes(lowerLocation)) {
            return false;
        }

        // Basic validation - should contain letters and reasonable characters
        return /^[a-zA-Z0-9\s,.-]+$/.test(location) && /[a-zA-Z]/.test(location);
    }

    /**
     * Generate completely dynamic extraction patterns based on attribute metadata
     */
    generateDynamicExtractionPatterns(message, attribute) {
        const {
            attribute_key,
            attribute_display_name,
            attribute_description
        } = attribute;

        // Create all possible ways users might refer to this attribute
        const attributeIdentifiers = this.generateAttributeIdentifiers(attribute);
        
        // Generate content patterns based on attribute type/description
        const contentPatterns = this.generateContentPatterns(attribute);
        
        // Try different extraction strategies
        for (const identifier of attributeIdentifiers) {
            for (const contentPattern of contentPatterns) {
                const extracted = this.tryExtractionPattern(message, identifier, contentPattern);
                if (extracted) {
                    this.logger.info(`Extracted "${extracted}" using identifier "${identifier}" and pattern "${contentPattern.name}"`);
                    return extracted;
                }
            }
        }

        return null;
    }

    /**
     * Generate all possible identifiers for an attribute
     */
    generateAttributeIdentifiers(attribute) {
        const identifiers = new Set();
        
        // Add the attribute key variations
        const key = attribute.attribute_key.toLowerCase();
        identifiers.add(key);
        identifiers.add(key.replace(/_/g, ' '));
        identifiers.add(key.replace(/_/g, ''));
        
        // Add display name variations
        if (attribute.attribute_display_name) {
            const displayName = attribute.attribute_display_name.toLowerCase();
            identifiers.add(displayName);
            identifiers.add(displayName.replace(/\s+/g, ''));
            
            // Add individual words from display name
            displayName.split(/\s+/).forEach(word => {
                if (word.length > 2) identifiers.add(word);
            });
        }
        
        // Extract meaningful words from description
        if (attribute.attribute_description) {
            const description = attribute.attribute_description.toLowerCase();
            
            // Extract key terms based on common patterns
            const keyTerms = this.extractKeyTermsFromDescription(description);
            keyTerms.forEach(term => identifiers.add(term));
        }
        
        // Add common variations
        const baseIdentifiers = Array.from(identifiers);
        baseIdentifiers.forEach(id => {
            identifiers.add(`my ${id}`);
            identifiers.add(`the ${id}`);
            identifiers.add(`your ${id}`);
        });
        
        return Array.from(identifiers).filter(id => id.length > 1);
    }

    /**
     * Extract key terms from attribute description
     */
    extractKeyTermsFromDescription(description) {
        const keyTerms = new Set();
        
        // Common attribute type indicators
        const typeIndicators = {
            location: ['location', 'address', 'place', 'pickup', 'drop', 'destination', 'where'],
            contact: ['email', 'phone', 'mobile', 'contact', 'number', 'reach'],
            classification: ['classification', 'type', 'category', 'kind', 'level', 'priority'],
            personal: ['name', 'first', 'last', 'full'],
            service: ['service', 'plan', 'package', 'subscription', 'tier'],
            time: ['time', 'date', 'when', 'schedule', 'appointment'],
            preference: ['preference', 'choice', 'option', 'selection']
        };
        
        // Find matching type indicators
        for (const [type, indicators] of Object.entries(typeIndicators)) {
            indicators.forEach(indicator => {
                if (description.includes(indicator)) {
                    keyTerms.add(indicator);
                    // Add related terms
                    if (type === 'location') {
                        keyTerms.add('from');
                        keyTerms.add('to');
                        keyTerms.add('at');
                    }
                }
            });
        }
        
        // Extract words in quotes or parentheses (often examples)
        const quotedTerms = description.match(/["'](.*?)["']/g);
        if (quotedTerms) {
            quotedTerms.forEach(term => {
                const cleaned = term.replace(/["']/g, '').toLowerCase();
                if (cleaned.length > 2) keyTerms.add(cleaned);
            });
        }
        
        const parenthesisTerms = description.match(/\((.*?)\)/g);
        if (parenthesisTerms) {
            parenthesisTerms.forEach(term => {
                const cleaned = term.replace(/[()]/g, '').toLowerCase();
                cleaned.split(/[,\s]+/).forEach(word => {
                    if (word.length > 2) keyTerms.add(word);
                });
            });
        }
        
        return Array.from(keyTerms);
    }

    /**
     * Generate content patterns based on attribute type
     */
    generateContentPatterns(attribute) {
        const description = (attribute.attribute_description || '').toLowerCase();
        const patterns = [];
        
        // Determine attribute type from description
        if (description.includes('email')) {
            patterns.push({
                name: 'email',
                regex: /[\w\.-]+@[\w\.-]+\.\w+/,
                validator: (value) => /@/.test(value) && /\.\w+/.test(value)
            });
        }
        
        if (description.includes('phone') || description.includes('mobile')) {
            patterns.push({
                name: 'phone',
                regex: /[\+]?[\d\s\-\(\)]{8,}/,
                validator: (value) => /\d{8,}/.test(value.replace(/\D/g, ''))
            });
        }
        
        if (description.includes('location') || description.includes('address')) {
            patterns.push({
                name: 'address',
                regex: /[a-zA-Z0-9\s\-,\.#]{5,}/,
                validator: (value) => value.length > 4 && !/^(hi|hello|yes|no|ok|thanks)$/i.test(value)
            });
        }
        
        if (description.includes('classif') || description.includes('type') || description.includes('category')) {
            // Extract possible values from description
            const possibleValues = this.extractPossibleValuesFromDescription(attribute.attribute_description);
            if (possibleValues.length > 0) {
                const valuesPattern = possibleValues.map(v => this.escapeRegex(v)).join('|');
                patterns.push({
                    name: 'classification',
                    regex: new RegExp(`\\b(${valuesPattern})\\b`, 'i'),
                    validator: (value) => possibleValues.some(v => v.toLowerCase().includes(value.toLowerCase()))
                });
            }
        }
        
        // Generic text patterns (fallback)
        patterns.push({
            name: 'generic_text',
            regex: /[a-zA-Z0-9\s\-\.]{2,}/,
            validator: (value) => {
                const trimmed = value.trim();
                // Exclude common conversational words
                const excluded = ['hi', 'hello', 'hey', 'yes', 'no', 'ok', 'okay', 'thanks', 'good', 'fine'];
                return trimmed.length > 1 && !excluded.includes(trimmed.toLowerCase());
            }
        });
        
        return patterns;
    }

    /**
     * Try to extract using a specific identifier and content pattern
     */
    tryExtractionPattern(message, identifier, contentPattern) {
        const escapedIdentifier = this.escapeRegex(identifier);
        
        // Different extraction patterns - more comprehensive
        const extractionPatterns = [
            // "identifier is value" or "identifier: value"
            new RegExp(`\\b${escapedIdentifier}\\s*(?:is|:|are)\\s*(.+?)(?:\\.|,|;|!|\\?|$)`, 'i'),
            
            // "my identifier is value"
            new RegExp(`\\bmy\\s+${escapedIdentifier}\\s*(?:is|:|are)\\s*(.+?)(?:\\.|,|;|!|\\?|$)`, 'i'),
            
            // "identifier value" (direct)
            new RegExp(`\\b${escapedIdentifier}\\s+(.+?)(?:\\.|,|;|!|\\?|$)`, 'i'),
            
            // "value for identifier"
            new RegExp(`(.+?)\\s+for\\s+${escapedIdentifier}`, 'i'),
            
            // "at/in/from/to identifier" (for locations)
            new RegExp(`\\b(?:at|in|from|to)\\s+${escapedIdentifier}\\s*(?:is|:|are)?\\s*(.+?)(?:\\.|,|;|!|\\?|$)`, 'i'),
            
            // "I want to go to..." or "going to..." (for drop locations)
            new RegExp(`\\b(?:want to go to|going to|need to go to|drop at|deliver to|destination)\\s+(.+?)(?:\\.|,|;|!|\\?|$)`, 'i'),
            
            // "from X to Y" pattern (for pickup/drop)
            new RegExp(`\\bfrom\\s+[^\\s]+\\s+to\\s+(.+?)(?:\\.|,|;|!|\\?|$)`, 'i'),
            
            // Simple location patterns
            new RegExp(`\\b(airport|station|mall|office|home|hospital|hotel|restaurant|school|university|[A-Z][a-z]+\\s+[A-Z][a-z]+)\\b`, 'i')
        ];
        
        for (const pattern of extractionPatterns) {
            try {
                const match = message.match(pattern);
                if (match && match[1]) {
                    let extractedValue = match[1].trim();
                    
                    // Validate using content pattern
                    if (contentPattern.validator(extractedValue)) {
                        // Additional content pattern matching if needed
                        if (contentPattern.regex) {
                            const contentMatch = extractedValue.match(contentPattern.regex);
                            if (contentMatch) {
                                extractedValue = contentMatch[0];
                            }
                        }
                        
                        return extractedValue;
                    }
                }
            } catch (error) {
                // Continue to next pattern
                continue;
            }
        }
        
        return null;
    }

    applyCustomRegex(message, pattern, cue) {
        try {
            if (cue) {
                const cueRegex = new RegExp(cue, 'i');
                if (!cueRegex.test(message)) return null;
            }

            const regex = new RegExp(pattern, 'i');
            const match = message.match(regex);
            return match ? (match[1] || match[0]) : null;

        } catch (error) {
            this.logger.error(`Regex error: ${error.message}`);
            return null;
        }
    }

    matchAttributeValues(message, values) {
        const lowerMessage = message.toLowerCase();

        for (const value of values) {
            const lowerValue = value.toLowerCase();

            if (lowerMessage.includes(lowerValue)) {
                return value;
            }

            const words = lowerValue.split(/\s+/);
            if (words.length > 1 && words.every(word => lowerMessage.includes(word))) {
                return value;
            }
        }

        return null;
    }

    applyDynamicPatterns(message, attribute) {
        // This method is now replaced by generateDynamicExtractionPatterns
        // Keep for backwards compatibility but redirect to new method
        return this.generateDynamicExtractionPatterns(message, attribute);
    }

    processValue(value, attribute) {
        if (!value) return null;

        value = value.toString().trim();

        const possibleValues = this.extractPossibleValuesFromDescription(attribute.attribute_description);
        if (possibleValues.length > 0) {
            const matched = this.findBestMatch(value, possibleValues);
            if (matched) return matched;
        }

        return this.cleanValueDynamically(value, attribute);
    }

    findBestMatch(value, options) {
        const lowerValue = value.toLowerCase();

        for (const option of options) {
            if (option.toLowerCase() === lowerValue) {
                return option;
            }
        }

        for (const option of options) {
            const lowerOption = option.toLowerCase();
            if (lowerValue.includes(lowerOption) || lowerOption.includes(lowerValue)) {
                return option;
            }
        }

        return null;
    }

    cleanValueDynamically(value, attribute) {
        const description = (attribute.attribute_description || '').toLowerCase();
        const key = attribute.attribute_key.toLowerCase();
        const displayName = (attribute.attribute_display_name || '').toLowerCase();

        let cleaned = value;

        const contextWords = [
            ...description.split(/\s+/),
            ...key.split(/[_-]/),
            ...displayName.split(/\s+/)
        ].filter(word => word.length > 2).map(word => word.toLowerCase());

        const dynamicPrefixes = this.generateContextualPrefixes(contextWords);
        const dynamicSuffixes = this.generateContextualSuffixes(contextWords);

        for (const prefix of dynamicPrefixes) {
            const prefixRegex = new RegExp(`^${this.escapeRegex(prefix)}\\s+`, 'i');
            cleaned = cleaned.replace(prefixRegex, '');
        }

        for (const suffix of dynamicSuffixes) {
            const suffixRegex = new RegExp(`\\s+${this.escapeRegex(suffix)}$`, 'i');
            cleaned = cleaned.replace(suffixRegex, '');
        }

        return cleaned.replace(/\s+/g, ' ').trim();
    }

    generateContextualPrefixes(contextWords) {
        const basePrefixes = ['my', 'the', 'this', 'that', 'our', 'your'];
        const contextualPrefixes = [];

        if (contextWords.some(word => ['location', 'address', 'place', 'pickup', 'drop', 'destination'].includes(word))) {
            contextualPrefixes.push('at', 'in', 'from', 'to', 'near', 'located', 'situated', 'based');
        }

        if (contextWords.some(word => ['email', 'phone', 'contact', 'number', 'call', 'reach'].includes(word))) {
            contextualPrefixes.push('contact', 'call', 'reach', 'email', 'phone');
        }

        if (contextWords.some(word => ['classification', 'type', 'category', 'kind', 'level'].includes(word))) {
            contextualPrefixes.push('type', 'kind', 'category', 'classified', 'considered');
        }

        if (contextWords.some(word => ['service', 'plan', 'package', 'subscription'].includes(word))) {
            contextualPrefixes.push('using', 'subscribed', 'enrolled', 'signed');
        }

        if (contextWords.some(word => ['time', 'date', 'schedule', 'appointment', 'meeting'].includes(word))) {
            contextualPrefixes.push('scheduled', 'booked', 'planned', 'set');
        }

        return [...basePrefixes, ...contextualPrefixes];
    }

    generateContextualSuffixes(contextWords) {
        const baseSuffixes = ['info', 'data', 'details'];
        const contextualSuffixes = [];

        if (contextWords.some(word => ['location', 'address', 'place', 'pickup', 'drop'].includes(word))) {
            contextualSuffixes.push('area', 'zone', 'region', 'place', 'location', 'spot', 'point', 'building', 'address');
        }

        if (contextWords.some(word => ['classification', 'type', 'category', 'level'].includes(word))) {
            contextualSuffixes.push('type', 'category', 'class', 'level', 'grade', 'classification');
        }

        if (contextWords.some(word => ['email', 'phone', 'contact', 'number'].includes(word))) {
            contextualSuffixes.push('number', 'address', 'contact', 'info');
        }

        if (contextWords.some(word => ['service', 'plan', 'package', 'subscription'].includes(word))) {
            contextualSuffixes.push('plan', 'package', 'service', 'subscription', 'tier');
        }

        if (contextWords.some(word => ['time', 'date', 'schedule'].includes(word))) {
            contextualSuffixes.push('time', 'date', 'schedule', 'slot');
        }

        return [...baseSuffixes, ...contextualSuffixes];
    }

    extractPossibleValuesFromDescription(description) {
        if (!description) return [];

        const patterns = [
            /(?:values?|options?)[^-]*-\s*([^.!?]+)/i,
            /(?:can be|include|are)[^:]*:\s*([^.!?]+)/i,
            /(?:one of these \d+ values?)[^-]*-\s*([^.!?]+)/i
        ];

        for (const pattern of patterns) {
            const match = description.match(pattern);
            if (match) {
                return match[1].split(',').map(v => v.trim()).filter(v => v.length > 0);
            }
        }

        return [];
    }

    generateAttributeQuestion(attribute) {
        const displayName = attribute.attribute_display_name || attribute.attribute_key;
        const description = attribute.attribute_description || '';

        const possibleValues = this.extractPossibleValuesFromDescription(description);

        if (possibleValues.length > 0) {
            const options = possibleValues.join(', ');
            return `What is your ${displayName.toLowerCase()}? (${options})`;
        }

        if (description.toLowerCase().includes('location')) {
            return `What is your ${displayName.toLowerCase()}?`;
        }

        if (description.toLowerCase().includes('classif')) {
            return `How would you describe your ${displayName.toLowerCase()}?`;
        }

        return `Could you provide your ${displayName.toLowerCase()}?`;
    }

    getNextAttributeToCollect(missingAttributes) {
        return missingAttributes && missingAttributes.length > 0 ? missingAttributes[0] : null;
    }

    validateAttributeCollection(requiredAttributes, currentAttributes) {
        const missing = this.checkMissingAttributes(requiredAttributes, currentAttributes);
        const collected = requiredAttributes.length - missing.length;

        return {
            isComplete: missing.length === 0,
            totalRequired: requiredAttributes.length,
            totalCollected: collected,
            missingAttributes: missing,
            completionPercentage: Math.round((collected / requiredAttributes.length) * 100)
        };
    }

    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

}

export default AttributeExtractor;