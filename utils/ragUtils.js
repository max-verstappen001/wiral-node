import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenAIEmbeddings } from "@langchain/openai";
import Firecrawl from "@mendable/firecrawl-js";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { parseOffice } from "officeparser";
import xlsx from "xlsx";


class RagUtils {
    constructor() {
        this.textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
        });
        this.embeddings = new OpenAIEmbeddings({
            apiKey: process.env.OPENAI_API_KEY,
            modelName: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
        });
        this.firecrawl = process.env.FIRECRAWL_API_KEY ? new Firecrawl({
            apiKey: process.env.FIRECRAWL_API_KEY,
            defaultMaxPages: 5,
            defaultMaxDepth: 2,
            defaultWaitUntil: 'networkidle2',
        }) : null;
    }
    
    async splitText(text) {
        if (!text || typeof text !== 'string') {
            throw new Error("Text input is required and must be a string");
        }
        
        if (text.trim().length === 0) {
            throw new Error("Text input cannot be empty");
        }
        
        try {
            const chunks = await this.textSplitter.splitText(text);
            
            // Ensure we always return an array, even if splitting fails
            if (!Array.isArray(chunks)) {
                return [text]; // Fallback to original text as single chunk
            }
            
            // Filter out empty chunks
            const validChunks = chunks.filter(chunk => chunk && chunk.trim().length > 0);
            
            if (validChunks.length === 0) {
                return [text]; // Fallback to original text if no valid chunks
            }
            
            return validChunks;
            
        } catch (error) {
            // If text splitting fails, return the original text as a single chunk
            console.warn(`Text splitting failed, using original text as single chunk: ${error.message}`);
            return [text];
        }
    }

    async generateEmbeddings(texts) {
        if (!texts || !Array.isArray(texts)) {
            throw new Error("Texts input must be an array");
        }
        
        if (texts.length === 0) {
            throw new Error("Texts array cannot be empty");
        }
        
        // Filter out invalid text entries
        const validTexts = texts.filter(text => text && typeof text === 'string' && text.trim().length > 0);
        
        if (validTexts.length === 0) {
            throw new Error("No valid text entries found for embedding generation");
        }
        
        try {
            const embeddings = await this.embeddings.embedDocuments(validTexts);
            
            if (!embeddings || !Array.isArray(embeddings)) {
                throw new Error("Failed to generate embeddings: Invalid response from embedding service");
            }
            
            if (embeddings.length !== validTexts.length) {
                throw new Error(`Embedding count mismatch: expected ${validTexts.length}, got ${embeddings.length}`);
            }
            
            return embeddings;
            
        } catch (error) {
            // If it's already our custom error, re-throw it
            if (error.message.includes('Failed to generate embeddings') || 
                error.message.includes('Embedding count mismatch')) {
                throw error;
            }
            
            // For other errors, wrap them with more context
            throw new Error(`Failed to generate embeddings: ${error.message}`);
        }
    }

    async crawlUrl(url) {
        if (!this.firecrawl) {
            // Fallback to basic URL fetching if Firecrawl is not configured
            return await this._basicUrlFetch(url);
        }
        
        try {
            // For single URLs, use scrape instead of crawl for better reliability
            console.log(`Attempting to scrape URL: ${url}`);
            
            // Try scrape method first (better for single pages)
            let result;
            try {
                result = await this.firecrawl.scrape(url, {
                    formats: ['markdown', 'html'],
                    waitFor: 3000,
                    timeout: 30000
                });
                
                console.log(`Scrape result:`, JSON.stringify(result, null, 2));
                
                if (result && result.markdown && result.markdown.trim().length > 0) {
                    return result.markdown;
                } else if (result && result.html && result.html.trim().length > 0) {
                    // Basic HTML to text conversion
                    const textContent = result.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                    if (textContent.length > 0) {
                        return textContent;
                    }
                }
            } catch (scrapeError) {
                console.log(`Scrape method failed, trying crawl method: ${scrapeError.message}`);
                
                // Fallback to crawl method
                result = await this.firecrawl.crawl(url, {
                    maxPages: 1,
                    maxDepth: 0,
                    wait: 3000,
                    timeout: 30000
                });
                
                console.log(`Crawl result:`, JSON.stringify(result, null, 2));
                
                // Check if crawl was successful
                if (!result || result.status !== 'completed') {
                    throw new Error(`Crawl failed with status: ${result?.status || 'unknown'}`);
                }
                
                // Check if pages exist and is an array
                if (!result.pages || !Array.isArray(result.pages)) {
                    throw new Error("No pages found in crawl result");
                }
                
                // Extract text from pages
                const extractedText = result.pages
                    .filter(page => page && (page.text || page.markdown || page.content)) // Filter out invalid pages
                    .map(page => page.text || page.markdown || page.content)
                    .join('\n');
                
                if (!extractedText || extractedText.trim().length === 0) {
                    throw new Error("No text content found on the webpage");
                }
                
                return extractedText;
            }
            
            // If we reach here, neither scrape nor crawl found content
            throw new Error("No text content could be extracted from the webpage");
            
        } catch (error) {
            // Try basic URL fetch as final fallback
            console.log(`Firecrawl methods failed, trying basic URL fetch: ${error.message}`);
            try {
                return await this._basicUrlFetch(url);
            } catch (fallbackError) {
                // If all methods fail, throw the original Firecrawl error
                throw new Error(`All URL processing methods failed. Firecrawl error: ${error.message}. Fallback error: ${fallbackError.message}`);
            }
        }
    }

    // Basic URL fetching as fallback when Firecrawl is not available or fails
    async _basicUrlFetch(url) {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; Wiral-RAG-Bot/1.0)',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                timeout: 30000
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const html = await response.text();
            
            if (!html || html.trim().length === 0) {
                throw new Error("No content received from URL");
            }
            
            // Basic HTML to text conversion
            let textContent = html
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove styles
                .replace(/<[^>]*>/g, ' ') // Remove HTML tags
                .replace(/\s+/g, ' ') // Normalize whitespace
                .trim();
            
            if (!textContent || textContent.length < 50) {
                throw new Error("Insufficient text content extracted from webpage");
            }
            
            return textContent;
            
        } catch (error) {
            throw new Error(`Failed to fetch URL content: ${error.message}`);
        }
    }
    

    async extractTextFromPDF(filePath) {
        const loader = new PDFLoader(filePath);
        const docs = await loader.load();
        return docs.map(doc => doc.pageContent).join('\n');
    }

    async extractTextFromExcel(filePath) {
        const workbook = xlsx.readFile(filePath);
        let text = '';
        workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            const sheetText = xlsx.utils.sheet_to_csv(sheet);
            text += sheetText + '\n';
        });
        return text;
    }
    
    async extractTextFromDocx(filePath) {
        return new Promise((resolve, reject) => {
            parseOffice(filePath, (err, data) => {
                if (err) {
                    return reject(err);
                }
                resolve(data);
            });
        });
    }
}

export default RagUtils;