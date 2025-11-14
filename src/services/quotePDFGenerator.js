// src/services/quotePDFGenerator.js
const { Storage } = require('@google-cloud/storage');
const puppeteer = require('puppeteer');
const db = require('../config/database');
const { getTenantGCSFile, getTenantLocalFile } = require('./storage');

class QuotePDFGenerator {
    constructor() {
        this.browser = null;
        this.bucket = null;
        
        // Initialize Google Cloud Storage if credentials available
        if (process.env.GOOGLE_CLOUD_PROJECT_ID && process.env.GCS_BUCKET_NAME) {
          try {
            const storage = new Storage({
              projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
              keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
            });
            this.bucket = storage.bucket(process.env.GCS_BUCKET_NAME);
            console.log('✅ QuotePDFGenerator: GCS enabled');
          } catch (error) {
            console.warn('⚠️ QuotePDFGenerator: GCS disabled -', error.message);
          }
        }
    }

    async init() {
        if (this.browser) return;

        try {
            const options = {
                headless: 'new', // Bruk ny headless mode
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox', 
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-software-rasterizer',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-features=TranslateUI',
                    '--disable-ipc-flooding-protection',
                    '--enable-unsafe-swiftshader',
                    '--force-device-scale-factor=1',
                    '--disable-extensions'
                ]
            };

            // I Google Cloud bruker vi Chrome fra container
            if (process.env.NODE_ENV === 'production') {
                options.executablePath = '/usr/bin/chromium';
                console.log('🚀 Using Google Cloud Chrome');
            } else if (process.env.PUPPETEER_EXECUTABLE_PATH) {
                options.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
            }

            console.log('🔄 Starting Puppeteer with options:', JSON.stringify(options, null, 2));
            this.browser = await puppeteer.launch(options);
            console.log('✅ Puppeteer browser initialized successfully.');

            this.browser.on('disconnected', () => {
                console.warn('⚠️ Puppeteer browser disconnected.');
                this.browser = null;
            });
            
        } catch (error) {
            console.error('❌ Failed to initialize Puppeteer browser:', error);
            console.error('Stack:', error.stack);
            throw new Error(`Could not start browser for PDF generation: ${error.message}`);
        }
    }

    async close() {
        if (this.browser) {
            try {
                await this.browser.close();
                console.log('✅ Puppeteer browser closed.');
            } catch (error) {
                console.error('❌ Error closing Puppeteer browser:', error);
            } finally {
                this.browser = null;
            }
        }
    }

    async fetchQuoteData(quoteId, tenantId) {
        console.log(`🔍 [DEBUG] Fetching quote data for ${quoteId}...`);
        
        const pool = await db.getTenantConnection(tenantId);
        
        const query = `
            SELECT 
                q.*,
                o.id as order_full_id,
                o.description as order_description,
                o.customer_name,
                o.customer_data,
                o.customer_id,
                o.scheduled_date
            FROM quotes q
            JOIN orders o ON q.order_id = o.id
            WHERE q.id = $1
        `;
        
        const result = await pool.query(query, [quoteId]);

        if (result.rows.length === 0) {
            throw new Error(`Tilbud med ID ${quoteId} ikke funnet.`);
        }

        const quote = result.rows[0];
        
        // Generer ordre-nummer siden det ikke er en database-kolonne
        const orderIdParts = quote.order_full_id.split('-');
        const orderNumber = `SO-${orderIdParts[1]}-${orderIdParts[2].slice(-6)}`;
        quote.order_number = orderNumber;

        // Parse items data
        const itemsData = typeof quote.items === 'string' 
            ? JSON.parse(quote.items) 
            : quote.items;
        
        // Parse customer data fra orders tabellen
        const customerData = typeof quote.customer_data === 'string'
            ? JSON.parse(quote.customer_data)
            : quote.customer_data || {};
        
        console.log(`✅ [DEBUG] Quote data fetched:`, {
            id: quote.id,
            customer: quote.customer_name,
            orderNumber: quote.order_number,
            itemsCount: itemsData?.products?.length || 0
        });
        
        return {
            ...quote,
            description: itemsData?.description || '',
            estimatedHours: itemsData?.estimatedHours || 0,
            estimatedPrice: quote.total_amount || 0,
            products: itemsData?.products || [],
            items: itemsData?.products || [],
            
            // Kundedata fra orders tabellen
            customer_name: quote.customer_name || 'Ukjent kunde',
            customer_address: customerData.physicalAddress || customerData.address || '',
            customer_email: customerData.email || customerData.invoiceEmail || '',
            customer_phone: customerData.phone || customerData.phoneNumber || '',
            
            // Totalbeløp for kalkulasjoner
            totalAmount: parseFloat(quote.total_amount) || 0
        };
    }

    async loadCompanySettings(tenantId) {
    console.log(`🔧 Loading company settings from JSON for tenant: ${tenantId}`);
    
    try {
        // Bruk SAMME loadTenantSettings funksjon som images.js bruker
        const { Storage } = require('@google-cloud/storage');
        
        const storage = new Storage({
            projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
            keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
        });
        
        // Intelligent bucket selection - never default to prod in test
        let bucketName;
        if (process.env.GCS_BUCKET_NAME) {
            bucketName = process.env.GCS_BUCKET_NAME;
        } else {
            const env = process.env.NODE_ENV || 'development';
            bucketName = (env === 'production') ? 'servfix-files' : 'servfix-files-test';
            console.warn(`⚠️ QuotePDF: GCS_BUCKET_NAME not set, using ${bucketName} (${env})`);
        }
        
        const bucket = storage.bucket(bucketName);
        
        // Last innstillinger fra JSON-fil (samme som images.js)
        const settingsPath = `tenants/${tenantId}/assets/settings.json`;
        const file = bucket.file(settingsPath);
        const [exists] = await file.exists();
        
        let settings = {};
        if (exists) {
            const [contents] = await file.download();
            settings = JSON.parse(contents.toString());
            console.log('✅ Settings loaded from GCS JSON file');
        } else {
            console.log('ℹ️ No settings file found, using defaults');
        }
        
        // Last logo hvis det finnes
        let logoBase64 = null;
        if (settings.logo && settings.logo.url) {
            try {
                // Last logo fra GCS og konverter til base64
                const logoPath = settings.logo.url.replace(`https://storage.googleapis.com/${bucketName}/`, '');
                const logoFile = bucket.file(logoPath);
                const [logoExists] = await logoFile.exists();
                
                if (logoExists) {
                    const [logoBuffer] = await logoFile.download();
                    const logoExtension = logoPath.split('.').pop().toLowerCase();
                    const mimeType = logoExtension === 'png' ? 'image/png' : 'image/jpeg';
                    logoBase64 = `data:${mimeType};base64,${logoBuffer.toString('base64')}`;
                    console.log('✅ Logo loaded and converted to base64');
                }
            } catch (logoError) {
                console.warn('⚠️ Could not load logo:', logoError.message);
            }
        }
        
        // KRITISK FIX: Return innstillingene (KUN DYNAMISKE VERDIER)
        const result = {
            companyInfo: settings.companyInfo || {},
            quoteSettings: settings.quoteSettings || {},
            logo_base64: logoBase64
        };
        
        console.log('🔍 [DEBUG] Company settings loaded:', {
            hasCompanyInfo: Object.keys(result.companyInfo).length > 0,
            companyName: result.companyInfo?.name,
            companyAddress: result.companyInfo?.address,
            hasLogo: !!result.logo_base64
        });
        
        return result;
        
    } catch (error) {
        console.error('❌ Error loading settings from JSON:', error);
        
        // Ved feil: return tomme objekter (IKKE hardkodede verdier)
        return {
            companyInfo: {},
            quoteSettings: {},
            logo_base64: null
        };
    }
}

    async downloadLogoFromGCS(logoUrl) {
        if (!logoUrl || !this.bucket) return null;
        
        try {
            // Parse GCS URL: https://storage.googleapis.com/servfix-files/tenants/airtech/assets/logo_1754527591365.jpg
            const pathMatch = logoUrl.match(/storage\.googleapis\.com\/[^/]+\/(.+)$/);
            if (!pathMatch) {
                console.warn('⚠️ Invalid GCS URL format:', logoUrl);
                return null;
            }
            
            const filePath = pathMatch[1];
            console.log(`📥 [DEBUG] Downloading logo from GCS: ${filePath}`);
            
            const file = this.bucket.file(filePath);
            const [exists] = await file.exists();
            
            if (!exists) {
                console.warn('⚠️ Logo file does not exist in GCS:', filePath);
                return null;
            }
            
            const [buffer] = await file.download();
            const mimeType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
            const base64 = `data:${mimeType};base64,${buffer.toString('base64')}`;
            
            console.log(`✅ Logo downloaded (${Math.round(buffer.length / 1024)}KB)`);
            return base64;
            
        } catch (error) {
            console.error('❌ Error downloading logo from GCS:', error.message);
            return null; // Ikke kast error, bare returner null
        }
    }

    async generateHTML(quoteData, companySettings) {
    console.log('🔧 Generating HTML for quote:', quoteData?.id);
    
    // Parse quote items safely  
    let items = {};
    try {
        items = typeof quoteData.items === 'string' ? JSON.parse(quoteData.items) : (quoteData.items || {});
    } catch (e) {
        console.warn('Could not parse quote items for PDF:', e);
        items = {};
    }

    const products = quoteData.products || items.products || [];
    const hours = parseFloat(items.estimatedHours) || parseFloat(quoteData.estimatedHours) || 0;

    // KRITISK DEBUG: Vis hva vi faktisk har
    console.log('🔍 PDF DEBUG - Raw data:', {
        quoteData_items: quoteData.items,
        parsed_items: items,
        products_array: products,
        products_length: products.length,
        each_product: products.map(p => ({name: p.name, price: p.price, qty: p.quantity}))
    });

    // Fallback om companySettings er null
    if (!companySettings) {
        console.warn('⚠️ companySettings is null, using defaults');
        companySettings = {
            companyInfo: {
                name: 'Air-Tech AS',
                address: 'Adresse ikke satt',
                email: 'post@airtech.no', 
                phone: 'Telefon ikke satt',
                cvr: 'Org.nr ikke satt'
            },
            quoteSettings: {
                forbeholdText: '',
                includeForbehold: false
            }
        };
    }
    
    // Safe destructuring med fallbacks
    const companyInfo = companySettings.companyInfo || {
        name: 'Air-Tech AS',
        address: 'Adresse ikke satt',
        email: 'post@airtech.no',
        phone: 'Telefon ikke satt',
        cvr: 'Org.nr ikke satt'
    };
    
    const quoteSettings = companySettings.quoteSettings || {
        includeForbehold: true,
        forbeholdText: companySettings?.forbeholdText || 
                       'Standard forbehold tekst ikke funnet i innstillinger.'
    };
    
    const logoBase64 = companySettings?.logo_base64;
    
    console.log('✅ HTML generation started with safe settings');

    console.log('PDF Generation - Quote data:', {
        quoteData: quoteData,
        items: items,
        products: products,
        hours: hours
    });

    // KORREKT BEREGNING: total_amount er kun arbeidskostnad
    const arbeidsBelop = parseFloat(quoteData.total_amount) || 0;

    // Materialkostnad fra products array
    const materialCost = products.reduce((sum, product) => {
        const qty = parseFloat(product.quantity) || 1;
        const price = parseFloat(product.price) || 0;
        return sum + (qty * price);
    }, 0);

    // Total eks MVA = arbeid + materialer  
    const totalEksMva = arbeidsBelop + materialCost;

    // MVA og totalt
    const mvaAmount = totalEksMva * 0.25;
    const totalInklMva = totalEksMva + mvaAmount;

    console.log('PDF Price calculation:', {
        arbeidsBelop,
        materialCost,
        totalEksMva,
        mvaAmount,
        totalInklMva
    });

    return `
        <!DOCTYPE html>
        <html lang="no">
        <head>
            <meta charset="UTF-8">
            <title>Tilbud ${quoteData.id}</title>
            <style>
                body { font-family: sans-serif; font-size: 10pt; color: #333; }
                header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #eee; padding-bottom: 10px; margin-bottom: 20px; }
                header img { max-width: 150px; max-height: 70px; }
                .company-details { text-align: right; font-size: 9pt; }
                .company-details p { margin: 0; }
                main { padding: 0; }
                h1 { font-size: 24pt; margin: 0 0 20px 0; color: #000; }
                h3 { font-size: 12pt; margin-top: 15px; margin-bottom: 5px; border-bottom: 1px solid #eee; padding-bottom: 3px; }
                h4 { font-size: 10pt; margin-top: 10px; margin-bottom: 3px; }
                p { margin: 0 0 5px 0; line-height: 1.4; }
                .metadata { background-color: #f9f9f9; padding: 10px; border-radius: 5px; margin-bottom: 15px; display: grid; grid-template-columns: 1fr 1fr; gap: 5px 15px;}
                .metadata p { margin: 0; font-size: 9pt; }
                .work-description { margin-bottom: 15px; }
                table { border-collapse: collapse; width: 100%; font-size: 9pt; }
                th, td { border: 1px solid #ddd; padding: 6px; text-align: left; }
                th { background-color: #f2f2f2; font-weight: bold; }
                tbody tr:nth-child(odd) { background-color: #fdfdfd; }
                .summary { margin-top: 20px; padding-top: 10px; border-top: 2px solid #eee; text-align: right; }
                .summary p { margin: 2px 0; font-size: 11pt; }
                .summary .total { font-weight: bold; font-size: 14pt; color: #000; }
                .terms { margin-top: 20px; font-size: 8pt; color: #666; }
                footer { position: fixed; bottom: 0; left: 20mm; right: 10mm; text-align: center; font-size: 8pt; color: #888; }
                .quote-validity {
                    margin-top: 20px;
                    text-align: center;
                    color: #666;
                    font-size: 12px;
                    border-top: 1px solid #ddd;
                    padding-top: 15px;
                }
            </style>
        </head>
        <body>
            <header>
                ${logoBase64 ? `<img src="${logoBase64}" alt="Logo">` : `<h2>${companyInfo.name}</h2>`}
                <div class="company-details">
                    <p><strong>${companyInfo.name}</strong></p>
                    <p>${companyInfo.address}</p>
                    <p>E-post: ${companyInfo.email}</p>
                    <p>Tlf: ${companyInfo.phone}</p>
                    <p>Org.nr: ${companyInfo.cvr}</p>
                </div>
            </header>
            <main>
                <h1>Tilbud</h1>
                <div class="metadata">
                    <p><strong>Tilbudsnummer:</strong> ${quoteData.id}</p>
                    <p><strong>Dato:</strong> ${new Date(quoteData.created_at).toLocaleDateString('no-NO')}</p>
                    <p><strong>Kunde:</strong> ${quoteData.customer_name}</p>
                    ${quoteData.customer_number ? `<p><strong>Kundenummer:</strong> ${quoteData.customer_number}</p>` : ''}
                    <p><strong>Adresse:</strong> ${quoteData.customer_address}</p>
                </div>
                <div class="work-description">
                    <h3>Prosjektbeskrivelse</h3>
                    <p>${quoteData.description || 'Ingen beskrivelse angitt.'}</p>
                </div>
                
                <div class="pricing-section">
                    <h3>Prisestimat</h3>
                    <table class="pricing-table">
    <thead>
        <tr>
            <th>Beskrivelse</th>
            <th style="text-align: right;">Pris</th>
        </tr>
    </thead>
    <tbody>
        ${hours > 0 ? `
        <tr style="font-weight: 600; background-color: #f8f9fa;">
            <td><strong>Arbeidskostnad, ${hours} timer</strong></td>
            <td style="text-align: right;"><strong>${arbeidsBelop.toLocaleString('nb-NO')} kr</strong></td>
        </tr>` : ''}
        
        ${products.length > 0 ? `
        <tr style="font-weight: 600; background-color: #f8f9fa;">
            <td><strong>Materialer</strong></td>
            <td style="text-align: right;"><strong>${materialCost.toLocaleString('nb-NO')} kr</strong></td>
        </tr>
        ${products.map(product => `
        <tr style="font-size: 0.9em; color: #666;">
            <td style="padding-left: 30px;">• ${product.name} (${product.quantity || 1} stk)</td>
            <td style="text-align: right;">${((product.quantity || 1) * (product.price || 0)).toLocaleString('nb-NO')} kr</td>
        </tr>`).join('')}
        ` : ''}
    </tbody>
    <tfoot>
        <tr class="subtotal-row">
            <td><strong>Totalt eks. MVA</strong></td>
            <td style="text-align: right;"><strong>${totalEksMva.toLocaleString('nb-NO')} kr</strong></td>
        </tr>
        <tr class="total-row">
            <td><strong>MVA (25%)</strong></td>
            <td style="text-align: right;"><strong>${mvaAmount.toLocaleString('nb-NO')} kr</strong></td>
        </tr>
        <tr class="total-row" style="font-size: 1.1em; border-top: 2px solid #333;">
            <td><strong>Totalt inkl. MVA</strong></td>
            <td style="text-align: right;"><strong>${totalInklMva.toLocaleString('nb-NO')} kr</strong></td>
        </tr>
    </tfoot>
</table>
                </div>

                <div class="terms">
    <h4>Forbehold</h4>
    <p>${quoteSettings.forbeholdText || 'Tilbudet er gyldig i 30 dager. Alle priser er eks. mva. Arbeidet utføres i henhold til gjeldende standarder og bestemmelser.'}</p>
</div>
                <div class="quote-validity">
                    <p><em>Tilbudet er gyldig i 30 dager. Alle priser er eks. mva.</em></p>
                </div>
            </main>
            <footer>
            </footer>
        </body>
        </html>
    `;
}

    async generate(quoteId, tenantId) {
    let page = null;
    let quoteData = null; 
    let companySettings = null;
    
    try {
        console.log(`Starting PDF generation for ${quoteId}`);
        
        await this.init();
        
        // Hent data
        quoteData = await this.fetchQuoteData(quoteId, tenantId);
        companySettings = await this.loadCompanySettings(tenantId);
        
        if (!quoteData) {
            throw new Error('Quote data not found');
        }
        
        // Generer HTML
        const html = await this.generateHTML(quoteData, companySettings);
        console.log(`HTML generated: ${html.length} chars`);
        
        // Lag page
        page = await this.browser.newPage();
        
        // Last innhold - BRUK KUN STANDARD PUPPETEER API
        await page.setContent(html, { 
            waitUntil: 'networkidle2',
            timeout: 20000 
        });
        
        // Vent med setTimeout (standard JavaScript)
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Generer PDF - MINIMAL OPTIONS
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { 
                top: '15mm', 
                right: '10mm', 
                bottom: '15mm', 
                left: '10mm' 
            }
        });
        
        console.log(`PDF size: ${pdfBuffer.length} bytes`);
        
        if (!pdfBuffer || pdfBuffer.length < 1000) {
            throw new Error(`PDF too small: ${pdfBuffer?.length || 0} bytes`);
        }
        
        return pdfBuffer;
        
    } catch (error) {
        console.error(`PDF generation error: ${error.message}`);
        throw error;
    } finally {
        if (page) {
            try {
                await page.close();
            } catch (e) {
                console.log('Error closing page:', e.message);
            }
        }
    }
}
}

module.exports = QuotePDFGenerator;
