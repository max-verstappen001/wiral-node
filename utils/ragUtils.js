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
        return await this.textSplitter.splitText(text);
    }

    async generateEmbeddings(texts) {
        return await this.embeddings.embedDocuments(texts);
    }

    async crawlUrl(url) {
        if (!this.firecrawl) {
            throw new Error("Firecrawl API key not configured");
        }
        const result = await this.firecrawl.crawl(url);
        if (result.status !== 'completed') {
            throw new Error(`Crawl failed with status: ${result.status}`);
        }
        return result.pages.map(page => page.text).join('\n');
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