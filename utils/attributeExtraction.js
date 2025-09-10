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

        // STEP 2: Check if this is a simple value response
        if (lowerMessage.length < 30 && !this.containsQuestionWords(lowerMessage)) {
            // Check against any attribute that exists and could match this value
            const potentialMatch = this.findBestAttributeForValue(lowerMessage.trim(), requiredAttributes, currentAttributes);
            if (potentialMatch) {
                this.logger.info(`Potential value response for ${potentialMatch.attribute_key}: "${lowerMessage}"`);

                detectionResult.hasChangeIntent = true;
                detectionResult.changeType = 'value_response';
                detectionResult.attributeKey = potentialMatch.attribute_key;
                detectionResult.newValue = lowerMessage.trim();
                detectionResult.confidence = 0.8;
                detectionResult.matchedPattern = 'simple_value_response';

                return detectionResult;
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
     * Find the best attribute for a given value (for value responses)
     */
    findBestAttributeForValue(value, requiredAttributes, currentAttributes) {
        // Only consider attributes that already have values (for changes)
        const existingAttributes = requiredAttributes.filter(attr =>
            currentAttributes[attr.attribute_key] && currentAttributes[attr.attribute_key] !== ''
        );

        // Check if value matches predefined attribute values
        for (const attr of existingAttributes) {
            if (attr.attribute_values && attr.attribute_values.length > 0) {
                const lowerValue = value.toLowerCase();
                for (const possibleValue of attr.attribute_values) {
                    if (possibleValue.toLowerCase().includes(lowerValue) || lowerValue.includes(possibleValue.toLowerCase())) {
                        return attr;
                    }
                }
            }
        }

        // Check against description patterns
        for (const attr of existingAttributes) {
            if (attr.attribute_description) {
                const desc = attr.attribute_description.toLowerCase();

                // Location patterns
                if (desc.includes('location') || desc.includes('address')) {
                    if (/^[a-zA-Z\s-]+$/.test(value) && value.split(' ').length <= 3) {
                        return attr;
                    }
                }

                // Classification patterns
                if (desc.includes('classif') || desc.includes('type') || desc.includes('category')) {
                    const classificationWords = ['hot', 'warm', 'cold', 'high', 'medium', 'low', 'good', 'bad', 'excellent', 'poor'];
                    if (classificationWords.includes(value.toLowerCase())) {
                        return attr;
                    }
                }
            }
        }

        return null;
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

        // Don't ask for attributes after 3 user messages unless it's critical
        if (conversationTurns > 3) {
            // Only collect critical attributes after this point
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

        // Collect normally in early conversation
        return {
            shouldCollect: true,
            reason: 'early_conversation',
            attributesToCollect: missingAttributes.slice(0, 1), // Only ask for one at a time
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

        const remaining = requiredAttributes.filter(attr => !extractedAttributes[attr.attribute_key]);

        for (const attribute of remaining) {
            const regexExtracted = this.extractUsingRegex(message, attribute);
            if (regexExtracted) {
                extractedAttributes[attribute.attribute_key] = regexExtracted;
                this.logger.info(`Regex extracted ${attribute.attribute_key}: ${regexExtracted}`);
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

                    Example response format: {{"pickup_location": "downtown", "lead_classification": "Hot"}}`],
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

            this.logger.info(`AI extraction prompt data:`, { message, attributeInfo });

            const result = await chain.invoke({
                message: message,
                attributeInfo: attributeInfo
            });

            this.logger.info(`AI extraction raw result: ${result}`);

            // Parse and validate result
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

    extractUsingRegex(message, attribute) {
        const {
            attribute_key,
            regex_pattern,
            regex_cue,
            attribute_values
        } = attribute;

        let extracted = null;

        if (regex_pattern) {
            extracted = this.applyCustomRegex(message, regex_pattern, regex_cue);
            if (extracted) return this.processValue(extracted, attribute);
        }

        if (attribute_values && attribute_values.length > 0) {
            extracted = this.matchAttributeValues(message, attribute_values);
            if (extracted) return this.processValue(extracted, attribute);
        }

        extracted = this.applyDynamicPatterns(message, attribute);
        if (extracted) return this.processValue(extracted, attribute);

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
        const key = attribute.attribute_key.toLowerCase();
        const name = (attribute.attribute_display_name || '').toLowerCase();

        const patterns = [
            new RegExp(`(?:${this.escapeRegex(key)})(?:\\s*[is:]\\s*)([^\\n\\r.,;!?]+)`, 'i'),
            new RegExp(`(?:my\\s+${this.escapeRegex(key)})(?:\\s*[is:]\\s*)([^\\n\\r.,;!?]+)`, 'i'),
            new RegExp(`(?:${this.escapeRegex(name)})(?:\\s*[is:]\\s*)([^\\n\\r.,;!?]+)`, 'i')
        ];

        for (const pattern of patterns) {
            try {
                const match = message.match(pattern);
                if (match && match[1]) {
                    return match[1].trim();
                }
            } catch (error) {
                continue;
            }
        }

        return null;
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